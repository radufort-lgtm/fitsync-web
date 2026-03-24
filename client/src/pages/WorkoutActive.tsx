import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useApp } from "@/context/AppContext";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { localCache } from "@/lib/localCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Pause, Square, SkipForward, Trophy, Check,
  ChevronRight, Timer, X, Wifi, Users, Clock, Loader2,
  UserCheck, UserX, Dumbbell, Repeat, Volume2
} from "lucide-react";
import type { PlannedExercise, SetLog } from "@shared/schema";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/*
 * Rotation Workout Phases:
 *   waiting     → Waiting room for invited friends to join
 *   weighIn     → Everyone enters their weight for their current station
 *   active      → 3 min timed set at the station
 *   transition  → 10 sec transition (after set or after break)
 *   rest        → Break (creator-chosen length), shows what's next
 *   paused      → Creator paused everything
 *   complete    → All rotations done
 */
type WorkoutPhase = "waiting" | "weighIn" | "active" | "transition" | "rest" | "paused" | "complete";

const SET_DURATION = 180; // 3 minutes
const TRANSITION_DURATION = 10; // 10 seconds
const PHASE_STORAGE_KEY = "fitsync_workout_phase";

function savePhaseState(state: {
  phase: string;
  currentRound: number;
  currentRotation: number;
  setSecsLeft: number;
  transitionSecsLeft: number;
  restSecsLeft: number;
  elapsedSecs: number;
  transitionTarget: string;
}) {
  try { localStorage.setItem(PHASE_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadPhaseState(): any | null {
  try {
    const raw = localStorage.getItem(PHASE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function clearPhaseState() {
  try { localStorage.removeItem(PHASE_STORAGE_KEY); } catch {}
}

function formatTime(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

interface InviteStatus {
  username: string;
  status: "pending" | "accepted" | "declined";
}

// Compute which station a user is on given their index in participant list, the current round, and total stations
function getStationIndex(participantIdx: number, roundIdx: number, totalStations: number): number {
  return (participantIdx + roundIdx) % totalStations;
}

// Sound alarm using Web Audio API
function playAlarm() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Play 3 beeps
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880; // A5
      osc.type = "square";
      gain.gain.value = 0.3;
      const start = audioCtx.currentTime + i * 0.3;
      osc.start(start);
      osc.stop(start + 0.15);
    }
  } catch {
    // Audio not supported
  }
}

export default function WorkoutActive() {
  const { currentUser, activeWorkout, setActiveWorkout } = useApp();
  const [, navigate] = useLocation();
  const toastRef = useRef(useToast());

  // Core state — restore from localStorage if available (survives remount/refresh)
  const _saved = useRef(loadPhaseState());
  const [phase, setPhase] = useState<WorkoutPhase>((_saved.current?.phase as WorkoutPhase) || "waiting");
  const [elapsedSecs, setElapsedSecs] = useState(_saved.current?.elapsedSecs ?? 0);
  const [setSecsLeft, setSetSecsLeft] = useState(_saved.current?.setSecsLeft ?? SET_DURATION);
  const [transitionSecsLeft, setTransitionSecsLeft] = useState(_saved.current?.transitionSecsLeft ?? TRANSITION_DURATION);
  const [restSecsLeft, setRestSecsLeft] = useState(_saved.current?.restSecsLeft ?? 0);
  const [currentRound, setCurrentRound] = useState(_saved.current?.currentRound ?? 0);
  const [currentRotation, setCurrentRotation] = useState(_saved.current?.currentRotation ?? 0);
  const [weight, setWeight] = useState("0");
  const [wsConnected, setWsConnected] = useState(false);
  const [inviteStatuses, setInviteStatuses] = useState<InviteStatus[]>([]);
  const [joinedUsers, setJoinedUsers] = useState<string[]>([]);
  const [transitionTarget, setTransitionTarget] = useState<"rest" | "active">((_saved.current?.transitionTarget as "rest" | "active") || "rest");
  // Track all user weights for display: { username: { stationIdx: weight } }
  const [userWeights, setUserWeights] = useState<Record<string, Record<number, string>>>({});

  // Timers
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnectedOnce = useRef(false);
  const wakeLockRef = useRef<any>(null);
  const localTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for stable reads
  const stateRef = useRef({
    phase: "waiting" as WorkoutPhase,
    currentRound: 0,
    currentRotation: 0,
    setSecsLeft: SET_DURATION,
    transitionSecsLeft: TRANSITION_DURATION,
    restSecsLeft: 0,
    elapsedSecs: 0,
    transitionTarget: "rest" as "rest" | "active",
    userWeights: {} as Record<string, Record<number, string>>,
  });
  stateRef.current = { phase, currentRound, currentRotation, setSecsLeft, transitionSecsLeft, restSecsLeft, elapsedSecs, transitionTarget, userWeights };

  // Persist phase state to localStorage so it survives remounts/refreshes
  // Throttle writes to at most once per second to avoid perf issues
  const lastPersistRef = useRef(0);
  useEffect(() => {
    if (phase === "waiting" || phase === "complete") {
      clearPhaseState();
      return;
    }
    const now = Date.now();
    if (now - lastPersistRef.current < 1000) return;
    lastPersistRef.current = now;
    savePhaseState({ phase, currentRound, currentRotation, setSecsLeft, transitionSecsLeft, restSecsLeft, elapsedSecs, transitionTarget });
  }, [phase, currentRound, currentRotation, setSecsLeft, transitionSecsLeft, restSecsLeft, elapsedSecs, transitionTarget]);

  const workoutRef = useRef(activeWorkout);
  workoutRef.current = activeWorkout;
  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  // Track if we've ever had an active workout to avoid premature redirect
  const hadWorkoutRef = useRef(false);
  if (activeWorkout) hadWorkoutRef.current = true;

  // Redirect guard
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (activeWorkout) {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      return;
    }
    if (!hadWorkoutRef.current) {
      redirectTimerRef.current = setTimeout(() => {
        if (!hadWorkoutRef.current) navigate("/dashboard");
      }, 500);
    }
    return () => { if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current); };
  }, [activeWorkout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch invite statuses (once)
  const fetchedInvites = useRef(false);
  useEffect(() => {
    if (!activeWorkout?.isShared || !activeWorkout?.sessionId || fetchedInvites.current) return;
    fetchedInvites.current = true;
    apiRequest("GET", `/api/workout-sessions/${activeWorkout.sessionId}/invites`)
      .then((invites: any[]) => {
        setInviteStatuses(invites.map(inv => ({
          username: inv.toUsername,
          status: inv.status as "pending" | "accepted" | "declined",
        })));
      })
      .catch(() => {});
  }, [activeWorkout?.isShared, activeWorkout?.sessionId]);

  // Single stable WS connection
  useEffect(() => {
    if (!activeWorkout?.isShared || wsConnectedOnce.current) return;
    wsConnectedOnce.current = true;

    const aw = activeWorkout;
    const user = currentUser;
    if (!aw || !user) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: "join", sessionId: aw.sessionId, username: user.username }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const creatorUsername = workoutRef.current?.creatorUsername;
        const isCreatorNow = creatorUsername === userRef.current?.username;

        if (msg.type === "state-sync" && !isCreatorNow) {
          const p = msg.payload;
          setPhase(p.phase);
          setCurrentRound(p.currentRound);
          setCurrentRotation(p.currentRotation);
          setSetSecsLeft(p.setSecsLeft);
          setTransitionSecsLeft(p.transitionSecsLeft ?? TRANSITION_DURATION);
          setRestSecsLeft(p.restSecsLeft);
          setElapsedSecs(p.elapsedSecs);
          setTransitionTarget(p.transitionTarget ?? "rest");
          if (p.userWeights) setUserWeights(p.userWeights);
          // Play alarm on phase transitions
          if (p.playAlarm) playAlarm();
        }

        if (msg.type === "user-joined") {
          setJoinedUsers(prev => prev.includes(msg.username) ? prev : [...prev, msg.username]);
        }
        if (msg.type === "user-left") {
          setJoinedUsers(prev => prev.filter(u => u !== msg.username));
        }
        if (msg.type === "invite-accepted" || msg.type === "participant-joined") {
          setInviteStatuses(prev => prev.map(inv => inv.username === msg.username ? { ...inv, status: "accepted" } : inv));
        }
        if (msg.type === "invite-declined") {
          setInviteStatuses(prev => prev.map(inv => inv.username === msg.username ? { ...inv, status: "declined" } : inv));
        }
        // Weight updates from other users
        if (msg.type === "weight-update") {
          setUserWeights(prev => ({
            ...prev,
            [msg.username]: { ...(prev[msg.username] || {}), [msg.stationIdx]: msg.weight },
          }));
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => setWsConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
      wsConnectedOnce.current = false;
    };
  }, [activeWorkout?.isShared]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable send
  const sendStateUpdate = useCallback((overrides?: Record<string, any>) => {
    const aw = workoutRef.current;
    const user = userRef.current;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!aw || !user || aw.creatorUsername !== user.username) return;
    const s = stateRef.current;
    wsRef.current.send(JSON.stringify({
      type: "state-update",
      sessionId: aw.sessionId,
      payload: {
        phase: s.phase,
        currentRound: s.currentRound,
        currentRotation: s.currentRotation,
        setSecsLeft: s.setSecsLeft,
        transitionSecsLeft: s.transitionSecsLeft,
        restSecsLeft: s.restSecsLeft,
        elapsedSecs: s.elapsedSecs,
        transitionTarget: s.transitionTarget,
        userWeights: s.userWeights,
        ...overrides,
      },
    }));
  }, []);

  // Send weight update to everyone
  const sendWeightUpdate = useCallback((stationIdx: number, w: string) => {
    const aw = workoutRef.current;
    const user = userRef.current;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!aw || !user) return;
    wsRef.current.send(JSON.stringify({
      type: "state-update",
      sessionId: aw.sessionId,
      payload: {
        type: "weight-update",
        username: user.username,
        stationIdx,
        weight: w,
      },
    }));
  }, []);

  // Heartbeat every 3s during active phases
  useEffect(() => {
    if (!activeWorkout?.isShared) return;
    const isCreatorNow = activeWorkout?.creatorUsername === currentUser?.username;
    if (!isCreatorNow) return;

    heartbeatRef.current = setInterval(() => {
      const s = stateRef.current;
      if (s.phase === "waiting" || s.phase === "complete") return;
      sendStateUpdate();
    }, 3000);

    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [activeWorkout?.isShared, activeWorkout?.creatorUsername, currentUser?.username, sendStateUpdate]);

  // Main timer — drives all countdowns for creator (or solo)
  useEffect(() => {
    const isCreatorNow = activeWorkout?.creatorUsername === currentUser?.username;
    const canDrive = isCreatorNow || !activeWorkout?.isShared;
    if (!canDrive) return;

    if (phase === "active") {
      timerRef.current = setInterval(() => {
        setSetSecsLeft(prev => {
          if (prev <= 1) {
            // Time's up! Play alarm and go to transition → rest
            playAlarm();
            setPhase("transition");
            setTransitionTarget("rest");
            setTransitionSecsLeft(TRANSITION_DURATION);
            sendStateUpdate({ phase: "transition", transitionTarget: "rest", transitionSecsLeft: TRANSITION_DURATION, setSecsLeft: 0, playAlarm: true });
            return 0;
          }
          return prev - 1;
        });
        setElapsedSecs(s => s + 1);
      }, 1000);
    } else if (phase === "transition") {
      timerRef.current = setInterval(() => {
        setTransitionSecsLeft(prev => {
          if (prev <= 1) {
            // Transition done — go to target phase
            const target = stateRef.current.transitionTarget;
            if (target === "rest") {
              const breakDur = workoutRef.current?.breakDuration || workoutRef.current?.restBetweenSets || 60;
              setPhase("rest");
              setRestSecsLeft(breakDur);
              sendStateUpdate({ phase: "rest", restSecsLeft: breakDur, transitionSecsLeft: 0 });
            } else {
              // Going back to active (weighIn first)
              setPhase("weighIn");
              sendStateUpdate({ phase: "weighIn", transitionSecsLeft: 0 });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (phase === "rest") {
      timerRef.current = setInterval(() => {
        setRestSecsLeft(prev => {
          if (prev <= 1) {
            // Break done → transition → next round
            playAlarm();
            // Advance round
            const aw = workoutRef.current;
            const exercises = aw?.exercises || [];
            const totalStations = exercises.length;
            const rotationCount = aw?.rotationCount || 1;
            const nextRound = stateRef.current.currentRound + 1;
            const totalRounds = totalStations * rotationCount;

            if (nextRound >= totalRounds) {
              // All done!
              setPhase("complete");
              sendStateUpdate({ phase: "complete", restSecsLeft: 0, playAlarm: true });
              return 0;
            }

            const nextRotation = Math.floor(nextRound / totalStations);
            setCurrentRound(nextRound);
            setCurrentRotation(nextRotation);
            setPhase("transition");
            setTransitionTarget("active");
            setTransitionSecsLeft(TRANSITION_DURATION);
            sendStateUpdate({
              phase: "transition",
              transitionTarget: "active",
              transitionSecsLeft: TRANSITION_DURATION,
              restSecsLeft: 0,
              currentRound: nextRound,
              currentRotation: nextRotation,
              playAlarm: true,
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, activeWorkout?.creatorUsername, activeWorkout?.isShared, currentUser?.username, sendStateUpdate]);

  // Wake Lock — keep screen on during active workout phases
  useEffect(() => {
    const shouldLock = phase === "active" || phase === "transition" || phase === "rest" || phase === "weighIn";
    if (!shouldLock) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const requestLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          const lock = await (navigator as any).wakeLock.request('screen');
          if (cancelled) { lock.release(); return; }
          wakeLockRef.current = lock;
          // Re-acquire on visibility change (iOS releases lock when tab is backgrounded)
          lock.addEventListener('release', () => { wakeLockRef.current = null; });
        }
      } catch { /* wake lock not supported or denied */ }
    };
    requestLock();
    // Re-acquire when page becomes visible again
    const onVisChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current && !cancelled) {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [phase]);

  // Local countdown timer for NON-CREATORS — ticks every 1s between heartbeat syncs
  useEffect(() => {
    const isCreatorNow = activeWorkout?.creatorUsername === currentUser?.username;
    if (!activeWorkout?.isShared || isCreatorNow) {
      if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; }
      return;
    }
    // Only tick during timed phases
    if (phase === "active" || phase === "transition" || phase === "rest") {
      localTimerRef.current = setInterval(() => {
        if (phase === "active") {
          setSetSecsLeft(prev => Math.max(0, prev - 1));
          setElapsedSecs(s => s + 1);
        } else if (phase === "transition") {
          setTransitionSecsLeft(prev => Math.max(0, prev - 1));
        } else if (phase === "rest") {
          setRestSecsLeft(prev => Math.max(0, prev - 1));
        }
      }, 1000);
    } else {
      if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; }
    }
    return () => { if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; } };
  }, [phase, activeWorkout?.isShared, activeWorkout?.creatorUsername, currentUser?.username]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (localTimerRef.current) clearInterval(localTimerRef.current);
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    };
  }, []);

  if (!activeWorkout || !currentUser) return null;

  const exercises: PlannedExercise[] = activeWorkout.exercises;
  const totalStations = exercises.length;
  const rotationCount = activeWorkout.rotationCount || 1;
  const totalRounds = totalStations * rotationCount;
  const breakDuration = activeWorkout.breakDuration || activeWorkout.restBetweenSets || 60;
  const isCreator = activeWorkout.creatorUsername === currentUser.username;
  const isShared = activeWorkout.isShared;
  const participants = activeWorkout.participantUsernames;
  const invitedFriends = participants.filter(u => u !== activeWorkout.creatorUsername);

  // Current user's participant index
  const myParticipantIdx = participants.indexOf(currentUser.username);
  const myStationIdx = getStationIndex(myParticipantIdx >= 0 ? myParticipantIdx : 0, currentRound, totalStations);
  const myExercise = exercises[myStationIdx];
  const nextRoundStationIdx = getStationIndex(myParticipantIdx >= 0 ? myParticipantIdx : 0, currentRound + 1, totalStations);
  const nextExercise = currentRound + 1 < totalRounds ? exercises[nextRoundStationIdx] : null;

  const overallProgress = totalRounds > 0 ? Math.round((currentRound / totalRounds) * 100) : 0;

  // Build the "who's doing what" list
  const stationAssignments = participants.map((username, pIdx) => ({
    username,
    stationIdx: getStationIndex(pIdx, currentRound, totalStations),
    exerciseName: exercises[getStationIndex(pIdx, currentRound, totalStations)]?.exerciseName || "—",
    weight: userWeights[username]?.[getStationIndex(pIdx, currentRound, totalStations)] || "—",
  }));

  const startWorkout = async () => {
    try {
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, {
        status: "active",
        startedAt: new Date().toISOString(),
      });
      setPhase("weighIn");
      setCurrentRound(0);
      setCurrentRotation(0);
      sendStateUpdate({ phase: "weighIn", currentRound: 0, currentRotation: 0 });
    } catch {
      toastRef.current.toast({ title: "Failed to start session", variant: "destructive" });
    }
  };

  const startRound = () => {
    // Creator presses to start the timed 3 min set
    setSetSecsLeft(SET_DURATION);
    setPhase("active");
    sendStateUpdate({ phase: "active", setSecsLeft: SET_DURATION });
  };

  const submitWeight = () => {
    // Save my weight for this station
    const stIdx = myStationIdx;
    setUserWeights(prev => ({
      ...prev,
      [currentUser.username]: { ...(prev[currentUser.username] || {}), [stIdx]: weight },
    }));
    // Broadcast weight to others
    if (isShared) {
      sendWeightUpdate(stIdx, weight);
    }
  };

  const finishWorkout = async () => {
    setPhase("complete");
    if (timerRef.current) clearInterval(timerRef.current);
    sendStateUpdate({ phase: "complete" });
    try {
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      const muscles = Array.from(new Set(exercises.map(e => e.primaryMuscle)));
      const historyEntry = await apiRequest("POST", "/api/workout-history", {
        userId: currentUser.id,
        planId: activeWorkout.planId,
        planName: activeWorkout.planName,
        totalVolume: 0,
        duration: elapsedSecs,
        musclesWorked: JSON.stringify(muscles),
        exerciseLogs: JSON.stringify([]),
        wasShared: activeWorkout.isShared,
        participantCount: activeWorkout.participantUsernames.length,
        aiReasoning: activeWorkout.aiReasoning,
      });
      // Cache locally
      const cached = localCache.getWorkoutHistory();
      cached.push(historyEntry);
      localCache.saveWorkoutHistory(cached);
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "workout-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "workout-history-recent"] });
    } catch (e) {
      console.error("Failed to save workout history", e);
    }
  };

  const togglePause = async () => {
    if (!isCreator) return;
    if (phase === "active" || phase === "rest" || phase === "transition") {
      setPhase("paused");
      sendStateUpdate({ phase: "paused" });
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, { isPaused: true, status: "paused" }).catch(() => {});
    } else if (phase === "paused") {
      // Resume to active for simplicity
      setPhase("active");
      sendStateUpdate({ phase: "active" });
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, { isPaused: false, status: "active" }).catch(() => {});
    }
  };

  const [showEndDialog, setShowEndDialog] = useState(false);

  const handleEnd = () => {
    if (phase === "complete" || phase === "waiting") {
      clearPhaseState();
      setActiveWorkout(null);
      navigate("/dashboard");
    } else {
      setShowEndDialog(true);
    }
  };

  const getInviteStatus = (username: string): "pending" | "accepted" | "declined" | "joined" => {
    if (joinedUsers.includes(username)) return "joined";
    const inv = inviteStatuses.find(i => i.username === username);
    return inv?.status || "pending";
  };

  const circumference = 2 * Math.PI * 54;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <div className="px-4 pt-12 pb-3 flex items-center justify-between">
        <div className="font-mono-time text-xl font-bold tabular-nums tracking-tight text-primary"
             style={{ fontFamily: "'Cabinet Grotesk', monospace" }}>
          {formatTime(elapsedSecs)}
        </div>

        <div className="relative w-10 h-10">
          <svg viewBox="0 0 24 24" className="rotate-[-90deg] w-10 h-10">
            <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="hsl(195 8% 18%)" fill="none" />
            <circle
              cx="12" cy="12" r="10"
              strokeWidth="2"
              stroke="hsl(186 50% 70%)"
              fill="none"
              strokeDasharray={`${2 * Math.PI * 10}`}
              strokeDashoffset={`${2 * Math.PI * 10 * (1 - overallProgress / 100)}`}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-primary">
            {overallProgress}%
          </span>
        </div>

        <div className="flex items-center gap-2">
          {(phase === "active" || phase === "paused" || phase === "rest" || phase === "transition") && isCreator && (
            <button onClick={togglePause}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors press-scale">
              {phase === "paused" ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
          )}
          <button onClick={handleEnd}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors press-scale">
            {phase === "waiting" ? <X className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-border mx-4 rounded-full overflow-hidden">
        <motion.div className="h-full bg-primary rounded-full" animate={{ width: `${overallProgress}%` }} transition={{ duration: 0.5 }} />
      </div>

      {/* Rotation badge */}
      {phase !== "waiting" && phase !== "complete" && (
        <div className="flex items-center justify-center gap-2 py-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Round {currentRound + 1} of {totalRounds} · Rotation {currentRotation + 1}/{rotationCount}
          </span>
        </div>
      )}

      <div className="flex-1 px-4 py-2 overflow-y-auto pb-8">
        <AnimatePresence mode="wait">
          {/* ─── WAITING ROOM ─── */}
          {phase === "waiting" && (
            <motion.div key="waiting" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center text-center">
              <div className="w-full bg-primary/5 border border-primary/15 rounded-2xl p-5 mb-6">
                <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{activeWorkout.planName}</h2>
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Dumbbell className="w-3 h-3" />{totalStations} stations</span>
                  <span className="flex items-center gap-1"><Repeat className="w-3 h-3" />{rotationCount}x rotation</span>
                  {isShared && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{participants.length} people</span>}
                </div>
                <div className="text-[10px] text-muted-foreground mt-2">3 min per station · {breakDuration}s break</div>
              </div>

              {isShared && invitedFriends.length > 0 && (
                <div className="w-full mb-6">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3 text-left">Invited Friends</p>
                  <div className="space-y-2">
                    {invitedFriends.map(username => {
                      const status = getInviteStatus(username);
                      return (
                        <div key={username}
                          className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                            status === "joined" || status === "accepted"
                              ? "border-green-500/30 bg-green-500/5"
                              : status === "declined" ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"
                          }`}>
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                            status === "joined" || status === "accepted" ? "bg-green-500/20" : status === "declined" ? "bg-destructive/10" : "bg-primary/15"
                          }`}>
                            {status === "joined" || status === "accepted" ? <UserCheck className="w-4 h-4 text-green-400" /> :
                             status === "declined" ? <UserX className="w-4 h-4 text-destructive" /> :
                             <span className="text-primary font-bold text-sm">{username[0]?.toUpperCase()}</span>}
                          </div>
                          <div className="flex-1 text-left"><div className="font-medium text-sm">@{username}</div></div>
                          <div className="flex-shrink-0">
                            {status === "joined" ? <span className="text-xs font-medium text-green-400 flex items-center gap-1"><Wifi className="w-3 h-3" /> Joined</span> :
                             status === "accepted" ? <span className="text-xs font-medium text-green-400">Accepted</span> :
                             status === "declined" ? <span className="text-xs font-medium text-destructive">Declined</span> :
                             <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Waiting</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!isShared && (
                <div className="mb-6">
                  <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Play className="w-10 h-10 text-primary ml-1" />
                  </motion.div>
                </div>
              )}

              {isCreator && (
                <Button onClick={startWorkout} size="lg" className="w-full max-w-xs press-scale glow-primary">
                  <Play className="w-5 h-5 mr-2" />
                  {isShared ? "Start for Everyone" : "Begin Workout"}
                </Button>
              )}

              {!isCreator && (
                <div className="text-center">
                  <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                  </div>
                  <p className="text-muted-foreground text-sm">Waiting for @{activeWorkout.creatorUsername} to start...</p>
                </div>
              )}

              {isShared && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-4">
                  <Wifi className={`w-3 h-3 ${wsConnected ? "text-green-400" : "text-red-400"}`} />
                  <span>{wsConnected ? "Connected" : "Connecting..."}</span>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── WEIGH IN ─── */}
          {phase === "weighIn" && myExercise && (
            <motion.div key="weighIn" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="space-y-5">
              <div className="text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Your Station</div>
                <h2 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{myExercise.exerciseName}</h2>
                <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full font-medium">{myExercise.primaryMuscle}</span>
              </div>

              <div className="bg-card border border-border rounded-2xl p-5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 block text-center">
                  Enter your weight (lbs)
                </label>
                <Input
                  type="number"
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  className="bg-background text-center text-3xl font-bold h-20 mb-3"
                  inputMode="numeric"
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground text-center">
                  You'll work out for 3 minutes at this station
                </p>
              </div>

              {/* Who is at which station */}
              {isShared && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Everyone's Station</p>
                  <div className="space-y-1.5">
                    {stationAssignments.map(sa => (
                      <div key={sa.username} className={`flex items-center gap-2 p-2 rounded-lg ${sa.username === currentUser.username ? "bg-primary/10" : ""}`}>
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-primary">{sa.username[0]?.toUpperCase()}</span>
                        </div>
                        <span className="text-xs font-medium flex-1">@{sa.username}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[120px]">{sa.exerciseName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isCreator ? (
                <Button onClick={() => { submitWeight(); startRound(); }} size="lg" className="w-full press-scale glow-primary h-14">
                  <Play className="w-5 h-5 mr-2" />
                  Start Round — 3:00
                </Button>
              ) : (
                <div className="text-center">
                  <Button onClick={submitWeight} size="lg" variant="secondary" className="w-full mb-3">
                    <Check className="w-5 h-5 mr-2" /> Save Weight
                  </Button>
                  <p className="text-xs text-muted-foreground">Waiting for @{activeWorkout.creatorUsername} to start the round...</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── ACTIVE (3 min timer) ─── */}
          {phase === "active" && myExercise && (
            <motion.div key={`active-${currentRound}`} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center min-h-[55vh]">

              <div className="text-center mb-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Your Station</div>
                <h2 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{myExercise.exerciseName}</h2>
                <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full font-medium">{myExercise.primaryMuscle}</span>
                {weight !== "0" && <div className="text-sm text-muted-foreground mt-2">{weight} lbs</div>}
              </div>

              {/* Big countdown */}
              <div className="relative w-44 h-44 mb-6">
                <svg viewBox="0 0 120 120" className="w-44 h-44 rotate-[-90deg]">
                  <circle cx="60" cy="60" r="54" strokeWidth="6" stroke="hsl(195 8% 18%)" fill="none" />
                  <motion.circle
                    cx="60" cy="60" r="54"
                    strokeWidth="6"
                    stroke={setSecsLeft <= 10 ? "hsl(0 80% 60%)" : "hsl(186 50% 70%)"}
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - setSecsLeft / SET_DURATION)}
                    strokeLinecap="round"
                    transition={{ duration: 0.5 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className={`text-5xl font-bold font-mono-time tabular-nums ${setSecsLeft <= 10 ? "text-red-400" : "text-primary"}`}
                       style={{ fontFamily: "'Cabinet Grotesk', monospace" }}>
                    {formatTime(setSecsLeft)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">remaining</div>
                </div>
              </div>

              {/* Who is doing what */}
              {isShared && (
                <div className="w-full bg-card border border-border rounded-xl p-3 mt-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Live Stations</p>
                  <div className="space-y-1.5">
                    {stationAssignments.map(sa => (
                      <div key={sa.username} className={`flex items-center gap-2 p-2 rounded-lg ${sa.username === currentUser.username ? "bg-primary/10" : ""}`}>
                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[9px] font-bold text-primary">{sa.username[0]?.toUpperCase()}</span>
                        </div>
                        <span className="text-xs font-medium flex-1">@{sa.username}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[100px]">{sa.exerciseName}</span>
                        {sa.weight !== "—" && <span className="text-[10px] text-primary font-medium">{sa.weight}lb</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── TRANSITION (10 sec) ─── */}
          {phase === "transition" && (
            <motion.div key="transition" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center min-h-[60vh]">
              <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-6">
                <ChevronRight className="w-10 h-10 text-primary" />
              </div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {transitionTarget === "rest" ? "Transitioning to Break" : "Get Ready"}
              </div>
              <div className="text-5xl font-bold text-primary mb-2 tabular-nums" style={{ fontFamily: "'Cabinet Grotesk', monospace" }}>
                {transitionSecsLeft}
              </div>
              <div className="text-sm text-muted-foreground">seconds</div>
            </motion.div>
          )}

          {/* ─── REST / BREAK ─── */}
          {phase === "rest" && (
            <motion.div key="rest" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center min-h-[55vh]">

              <div className="text-center mb-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Break</div>
                <div className="text-base font-medium">Rest up</div>
              </div>

              {/* Circular countdown */}
              <div className="relative w-36 h-36 mb-6">
                <svg viewBox="0 0 120 120" className="w-36 h-36 rotate-[-90deg]">
                  <circle cx="60" cy="60" r="54" strokeWidth="6" stroke="hsl(195 8% 18%)" fill="none" />
                  <motion.circle
                    cx="60" cy="60" r="54" strokeWidth="6" stroke="hsl(186 50% 70%)" fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - (breakDuration > 0 ? (breakDuration - restSecsLeft) / breakDuration : 0))}
                    strokeLinecap="round" transition={{ duration: 0.5 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-4xl font-bold font-mono-time tabular-nums text-primary" style={{ fontFamily: "'Cabinet Grotesk', monospace" }}>
                    {restSecsLeft}
                  </div>
                  <div className="text-xs text-muted-foreground">seconds</div>
                </div>
              </div>

              {/* Show what's next */}
              {nextExercise ? (
                <div className="w-full max-w-xs bg-card border border-border rounded-xl p-4 text-center mb-4">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Up Next</div>
                  <div className="font-bold text-lg" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{nextExercise.exerciseName}</div>
                  <div className="text-xs text-muted-foreground">{nextExercise.primaryMuscle}</div>
                </div>
              ) : (
                <div className="w-full max-w-xs bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center mb-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wide mb-1">Almost Done</div>
                  <div className="font-bold text-sm text-green-400">Last round!</div>
                </div>
              )}

              {/* Who is doing what */}
              {isShared && (
                <div className="w-full bg-card border border-border rounded-xl p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Next Stations</p>
                  <div className="space-y-1.5">
                    {participants.map((username, pIdx) => {
                      const nextStIdx = getStationIndex(pIdx, currentRound + 1, totalStations);
                      const nextEx = currentRound + 1 < totalRounds ? exercises[nextStIdx]?.exerciseName : "Done";
                      return (
                        <div key={username} className={`flex items-center gap-2 p-2 rounded-lg ${username === currentUser.username ? "bg-primary/10" : ""}`}>
                          <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-primary">{username[0]?.toUpperCase()}</span>
                          </div>
                          <span className="text-xs font-medium flex-1">@{username}</span>
                          <span className="text-xs text-primary font-medium truncate max-w-[120px]">{nextEx}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── PAUSED ─── */}
          {phase === "paused" && (
            <motion.div key="paused" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="w-20 h-20 bg-secondary rounded-3xl flex items-center justify-center mb-6">
                <Pause className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Workout Paused</h2>
              {isCreator ? (
                <>
                  <p className="text-muted-foreground text-sm mb-8">Tap resume to continue.</p>
                  <Button onClick={togglePause} size="lg" className="w-full max-w-xs press-scale">
                    <Play className="w-5 h-5 mr-2" /> Resume Workout
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">Waiting for the creator to resume...</p>
              )}
            </motion.div>
          )}

          {/* ─── COMPLETE ─── */}
          {phase === "complete" && (
            <motion.div key="complete" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
              <motion.div
                animate={{ rotate: [0, -10, 10, -5, 5, 0], scale: [1, 1.1, 1] }}
                transition={{ duration: 1, delay: 0.3 }}
                className="text-6xl mb-6">
                🏆
              </motion.div>
              <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Workout Complete!</h2>
              <p className="text-muted-foreground text-sm mb-8">{activeWorkout.planName}</p>

              <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-8">
                {[
                  { label: "Duration", value: formatTime(elapsedSecs) },
                  { label: "Stations", value: String(totalStations) },
                  { label: "Rotations", value: String(rotationCount) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border rounded-xl p-3 text-center">
                    <div className="text-lg font-bold text-primary" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              <Button onClick={handleEnd} size="lg" className="w-full max-w-xs press-scale">Done</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>End workout early?</AlertDialogTitle>
            <AlertDialogDescription>Your progress so far will be saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Going</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowEndDialog(false); finishWorkout(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              End Workout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
