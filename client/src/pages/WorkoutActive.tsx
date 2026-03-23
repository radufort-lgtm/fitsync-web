import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useApp } from "@/context/AppContext";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Pause, Square, SkipForward, Trophy, Check,
  ChevronRight, Timer, X, Wifi, Users, Clock, Loader2, UserCheck, UserX
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

type WorkoutPhase = "waiting" | "active" | "rest" | "paused" | "complete";

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

export default function WorkoutActive() {
  const { currentUser, activeWorkout, setActiveWorkout } = useApp();
  const [, navigate] = useLocation();
  const toastRef = useRef(useToast());

  const [phase, setPhase] = useState<WorkoutPhase>("waiting");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [restSecs, setRestSecs] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [weight, setWeight] = useState("0");
  const [reps, setReps] = useState("10");
  const [completedSets, setCompletedSets] = useState<Record<string, SetLog[]>>({});
  const [totalVolume, setTotalVolume] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [inviteStatuses, setInviteStatuses] = useState<InviteStatus[]>([]);
  const [joinedUsers, setJoinedUsers] = useState<string[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnectedOnce = useRef(false);

  // Use refs for state values that the heartbeat reads
  const stateRef = useRef({ phase: "waiting" as WorkoutPhase, exerciseIndex: 0, currentSetIndex: 0, restSecs: 0, totalVolume: 0, elapsedSecs: 0 });
  stateRef.current = { phase, exerciseIndex, currentSetIndex, restSecs, totalVolume, elapsedSecs };

  // Stable refs for workout data so effects don't re-run
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
        if (!hadWorkoutRef.current) {
          navigate("/dashboard");
        }
      }, 500);
    }
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, [activeWorkout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch invite statuses for the waiting room (only for shared workouts, only once)
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

  // Single stable WebSocket connection for shared workouts — connect ONCE
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
      ws.send(JSON.stringify({
        type: "join",
        sessionId: aw.sessionId,
        username: user.username,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const creatorUsername = workoutRef.current?.creatorUsername;
        const isCreatorNow = creatorUsername === userRef.current?.username;

        if (msg.type === "state-sync" && !isCreatorNow) {
          const p = msg.payload;
          setPhase(p.phase);
          setExerciseIndex(p.exerciseIndex);
          setCurrentSetIndex(p.currentSetIndex);
          setRestSecs(p.restSecsRemaining);
          setTotalVolume(p.totalVolume);
          setElapsedSecs(p.elapsedSecs);
        }

        if (msg.type === "user-joined") {
          setJoinedUsers(prev => {
            if (prev.includes(msg.username)) return prev;
            return [...prev, msg.username];
          });
        }

        if (msg.type === "user-left") {
          setJoinedUsers(prev => prev.filter(u => u !== msg.username));
        }

        // Update invite statuses from WS messages
        if (msg.type === "invite-accepted" || msg.type === "participant-joined") {
          const u = msg.username;
          setInviteStatuses(prev =>
            prev.map(inv => inv.username === u ? { ...inv, status: "accepted" } : inv)
          );
        }
        if (msg.type === "invite-declined") {
          const u = msg.username;
          setInviteStatuses(prev =>
            prev.map(inv => inv.username === u ? { ...inv, status: "declined" } : inv)
          );
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
      wsConnectedOnce.current = false;
    };
  }, [activeWorkout?.isShared]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable send function
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
        exerciseIndex: s.exerciseIndex,
        currentSetIndex: s.currentSetIndex,
        restSecsRemaining: s.restSecs,
        totalVolume: s.totalVolume,
        elapsedSecs: s.elapsedSecs,
        ...overrides,
      },
    }));
  }, []); // truly stable — reads everything from refs

  // Creator heartbeat: send state every 3 seconds
  useEffect(() => {
    if (!activeWorkout?.isShared) return;
    const isCreatorNow = activeWorkout?.creatorUsername === currentUser?.username;
    if (!isCreatorNow) return;

    heartbeatRef.current = setInterval(() => {
      const s = stateRef.current;
      if (s.phase === "waiting" || s.phase === "complete") return;
      sendStateUpdate();
    }, 3000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [activeWorkout?.isShared, activeWorkout?.creatorUsername, currentUser?.username, sendStateUpdate]);

  // Elapsed timer
  useEffect(() => {
    const isCreatorNow = activeWorkout?.creatorUsername === currentUser?.username;
    if (phase === "active" && (isCreatorNow || !activeWorkout?.isShared)) {
      timerRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, activeWorkout?.creatorUsername, activeWorkout?.isShared, currentUser?.username]);

  // Rest countdown
  useEffect(() => {
    const isCreatorNow = activeWorkout?.creatorUsername === currentUser?.username;
    if (phase === "rest" && (isCreatorNow || !activeWorkout?.isShared)) {
      restTimerRef.current = setInterval(() => {
        setRestSecs(s => {
          if (s <= 1) {
            if (restTimerRef.current) clearInterval(restTimerRef.current);
            setPhase("active");
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => { if (restTimerRef.current) clearInterval(restTimerRef.current); };
  }, [phase, activeWorkout?.creatorUsername, activeWorkout?.isShared, currentUser?.username]);

  if (!activeWorkout || !currentUser) {
    return null;
  }

  const exercises: PlannedExercise[] = activeWorkout.exercises;
  const currentExercise = exercises[exerciseIndex];
  const nextExercise = exercises[exerciseIndex + 1];
  const totalExercises = exercises.length;
  const overallProgress = Math.round((exerciseIndex / totalExercises) * 100);
  const restDuration = activeWorkout.restBetweenSets;
  const isCreator = activeWorkout.creatorUsername === currentUser.username;
  const isShared = activeWorkout.isShared;
  // Invited friends (everyone except the creator)
  const invitedFriends = activeWorkout.participantUsernames.filter(u => u !== activeWorkout.creatorUsername);

  const startWorkout = async () => {
    try {
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, {
        status: "active",
        startedAt: new Date().toISOString(),
      });
      setPhase("active");
      if (currentExercise) {
        setReps(String(currentExercise.reps));
      }
      sendStateUpdate({ phase: "active" });
    } catch (e) {
      toastRef.current.toast({ title: "Failed to start session", variant: "destructive" });
    }
  };

  const completeSet = () => {
    const w = parseFloat(weight) || 0;
    const r = parseInt(reps) || currentExercise.reps;
    const key = String(currentExercise.exerciseId);
    const setLog: SetLog = {
      setNumber: currentSetIndex + 1,
      reps: r,
      weight: w,
      completed: true,
    };

    setCompletedSets(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), setLog],
    }));
    const newVolume = totalVolume + w * r;
    setTotalVolume(newVolume);

    const setsLeft = currentExercise.sets - (currentSetIndex + 1);
    if (setsLeft > 0) {
      const newSetIndex = currentSetIndex + 1;
      setCurrentSetIndex(newSetIndex);
      setRestSecs(restDuration);
      setPhase("rest");
      sendStateUpdate({ phase: "rest", currentSetIndex: newSetIndex, restSecsRemaining: restDuration, totalVolume: newVolume });
    } else {
      if (exerciseIndex + 1 < totalExercises) {
        const newExIdx = exerciseIndex + 1;
        setExerciseIndex(newExIdx);
        setCurrentSetIndex(0);
        const nextEx = exercises[newExIdx];
        if (nextEx) setReps(String(nextEx.reps));
        setWeight("0");
        setRestSecs(restDuration);
        setPhase("rest");
        sendStateUpdate({ phase: "rest", exerciseIndex: newExIdx, currentSetIndex: 0, restSecsRemaining: restDuration, totalVolume: newVolume });
      } else {
        finishWorkout();
      }
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

      await apiRequest("POST", "/api/workout-history", {
        userId: currentUser.id,
        planId: activeWorkout.planId,
        planName: activeWorkout.planName,
        totalVolume,
        duration: elapsedSecs,
        musclesWorked: JSON.stringify(muscles),
        exerciseLogs: JSON.stringify([]),
        wasShared: activeWorkout.isShared,
        participantCount: activeWorkout.participantUsernames.length,
        aiReasoning: activeWorkout.aiReasoning,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "workout-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "workout-history-recent"] });
    } catch (e) {
      console.error("Failed to save workout history", e);
    }
  };

  const togglePause = async () => {
    if (!isCreator) return;
    if (phase === "active") {
      setPhase("paused");
      sendStateUpdate({ phase: "paused" });
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, { isPaused: true, status: "paused" });
    } else if (phase === "paused") {
      setPhase("active");
      sendStateUpdate({ phase: "active" });
      await apiRequest("PATCH", `/api/workout-sessions/${activeWorkout.sessionId}`, { isPaused: false, status: "active" });
    }
  };

  const [showEndDialog, setShowEndDialog] = useState(false);

  const handleEnd = () => {
    if (phase === "complete") {
      setActiveWorkout(null);
      navigate("/dashboard");
    } else if (phase === "waiting") {
      setActiveWorkout(null);
      navigate("/dashboard");
    } else {
      setShowEndDialog(true);
    }
  };

  const skipRest = () => {
    if (restTimerRef.current) clearInterval(restTimerRef.current);
    setPhase("active");
    setRestSecs(0);
  };

  const restPct = restDuration > 0 ? ((restDuration - restSecs) / restDuration) * 100 : 0;
  const circumference = 2 * Math.PI * 54;

  // Helper to get invite status for a friend
  const getInviteStatus = (username: string): "pending" | "accepted" | "declined" | "joined" => {
    if (joinedUsers.includes(username)) return "joined";
    const inv = inviteStatuses.find(i => i.username === username);
    return inv?.status || "pending";
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <div className="px-4 pt-12 pb-3 flex items-center justify-between">
        {/* Elapsed time */}
        <div className="font-mono-time text-xl font-bold tabular-nums tracking-tight text-primary"
             style={{ fontFamily: "'Cabinet Grotesk', monospace" }}>
          {formatTime(elapsedSecs)}
        </div>

        {/* Progress ring */}
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

        {/* Controls */}
        <div className="flex items-center gap-2">
          {(phase === "active" || phase === "paused") && isCreator && (
            <button
              data-testid="button-pause"
              onClick={togglePause}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors press-scale"
            >
              {phase === "paused" ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
          )}
          <button
            data-testid="button-end"
            onClick={handleEnd}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors press-scale"
          >
            {phase === "waiting" ? <X className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-border mx-4 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          animate={{ width: `${overallProgress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <div className="flex-1 px-4 py-4 overflow-y-auto pb-8">
        <AnimatePresence mode="wait">
          {/* WAITING ROOM */}
          {phase === "waiting" && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center text-center"
            >
              {/* Workout info header */}
              <div className="w-full bg-primary/5 border border-primary/15 rounded-2xl p-5 mb-6">
                <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                  {activeWorkout.planName}
                </h2>
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{totalExercises} exercises</span>
                  {isShared && (
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{activeWorkout.participantUsernames.length} people</span>
                  )}
                </div>
              </div>

              {/* Waiting room for shared workouts */}
              {isShared && invitedFriends.length > 0 && (
                <div className="w-full mb-6">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3 text-left">
                    Invited Friends
                  </p>
                  <div className="space-y-2">
                    {invitedFriends.map(username => {
                      const status = getInviteStatus(username);
                      return (
                        <div
                          key={username}
                          className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                            status === "joined" || status === "accepted"
                              ? "border-green-500/30 bg-green-500/5"
                              : status === "declined"
                              ? "border-destructive/20 bg-destructive/5"
                              : "border-border bg-card"
                          }`}
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                            status === "joined" || status === "accepted"
                              ? "bg-green-500/20"
                              : status === "declined"
                              ? "bg-destructive/10"
                              : "bg-primary/15"
                          }`}>
                            {status === "joined" || status === "accepted" ? (
                              <UserCheck className="w-4 h-4 text-green-400" />
                            ) : status === "declined" ? (
                              <UserX className="w-4 h-4 text-destructive" />
                            ) : (
                              <span className="text-primary font-bold text-sm">
                                {username[0]?.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">@{username}</div>
                          </div>
                          <div className="flex-shrink-0">
                            {status === "joined" ? (
                              <span className="text-xs font-medium text-green-400 flex items-center gap-1">
                                <Wifi className="w-3 h-3" /> Joined
                              </span>
                            ) : status === "accepted" ? (
                              <span className="text-xs font-medium text-green-400">Accepted</span>
                            ) : status === "declined" ? (
                              <span className="text-xs font-medium text-destructive">Declined</span>
                            ) : (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> Waiting
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Solo or ready to start */}
              {!isShared && (
                <div className="mb-6">
                  <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-4"
                  >
                    <Play className="w-10 h-10 text-primary ml-1" />
                  </motion.div>
                </div>
              )}

              {/* Begin button */}
              {isCreator && (
                <Button
                  data-testid="button-begin"
                  onClick={startWorkout}
                  size="lg"
                  className="w-full max-w-xs press-scale glow-primary"
                >
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

              {/* Connection status for shared */}
              {isShared && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-4">
                  <Wifi className={`w-3 h-3 ${wsConnected ? "text-green-400" : "text-red-400"}`} />
                  <span>{wsConnected ? "Connected" : "Connecting..."}</span>
                </div>
              )}
            </motion.div>
          )}

          {/* ACTIVE */}
          {phase === "active" && currentExercise && (
            <motion.div
              key={`active-${exerciseIndex}-${currentSetIndex}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {/* Exercise card */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                      Exercise {exerciseIndex + 1} of {totalExercises}
                    </div>
                    <h2 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                      {currentExercise.exerciseName}
                    </h2>
                  </div>
                  <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full font-medium">
                    {currentExercise.primaryMuscle}
                  </span>
                </div>

                {/* Set dots */}
                <div className="flex gap-1.5 mb-3">
                  {Array.from({ length: currentExercise.sets }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                        i < currentSetIndex ? "bg-primary" :
                        i === currentSetIndex ? "bg-primary/60 animate-pulse" :
                        "bg-border"
                      }`}
                    />
                  ))}
                </div>

                <div className="text-sm text-muted-foreground">
                  Set <span className="text-foreground font-bold">{currentSetIndex + 1}</span> of <span className="text-foreground font-bold">{currentExercise.sets}</span>
                  {" · "}<span className="text-primary font-medium">{currentExercise.reps} reps target</span>
                </div>
              </div>

              {/* Weight & Reps inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Weight (lbs)</label>
                  <Input
                    data-testid="input-weight"
                    type="number"
                    value={weight}
                    onChange={e => setWeight(e.target.value)}
                    className="bg-card text-center text-2xl font-bold h-16"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Reps</label>
                  <Input
                    data-testid="input-reps"
                    type="number"
                    value={reps}
                    onChange={e => setReps(e.target.value)}
                    className="bg-card text-center text-2xl font-bold h-16"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Volume so far */}
              <div className="flex justify-center">
                <div className="text-xs text-muted-foreground">
                  Total volume: <span className="text-foreground font-semibold">{Math.round(totalVolume).toLocaleString()} lbs</span>
                </div>
              </div>

              {/* Complete Set Button */}
              <Button
                data-testid="button-complete-set"
                onClick={completeSet}
                size="lg"
                className="w-full press-scale glow-primary h-14"
              >
                <Check className="w-5 h-5 mr-2" />
                Complete Set {currentSetIndex + 1}
              </Button>

              {/* Next exercise preview */}
              {nextExercise && (
                <div className="flex items-center gap-3 p-3 bg-secondary/40 rounded-xl border border-border">
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Up next</div>
                    <div className="text-sm font-medium">{nextExercise.exerciseName}</div>
                  </div>
                </div>
              )}

              {/* Group rotation info */}
              {isShared && (
                <div className="bg-chart-2/10 border border-chart-2/20 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs text-chart-2">
                    <Trophy className="w-3.5 h-3.5" />
                    <span>Group workout · {activeWorkout.participantUsernames.join(", ")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1.5">
                    <Wifi className={`w-3 h-3 ${wsConnected ? "text-green-400" : "text-red-400"}`} />
                    <span>{wsConnected ? "Live sync active" : "Connecting..."}</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* REST */}
          {phase === "rest" && (
            <motion.div
              key="rest"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center min-h-[60vh]"
            >
              <div className="text-center mb-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Rest</div>
                <div className="text-base font-medium">Great set! 💪</div>
              </div>

              {/* Circular countdown */}
              <div className="relative w-36 h-36 mb-6">
                <svg viewBox="0 0 120 120" className="w-36 h-36 rotate-[-90deg]">
                  <circle cx="60" cy="60" r="54" strokeWidth="6" stroke="hsl(195 8% 18%)" fill="none" />
                  <motion.circle
                    cx="60" cy="60" r="54"
                    strokeWidth="6"
                    stroke="hsl(186 50% 70%)"
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - restPct / 100)}
                    strokeLinecap="round"
                    transition={{ duration: 0.5 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-4xl font-bold font-mono-time tabular-nums text-primary" style={{ fontFamily: "'Cabinet Grotesk', monospace" }}>
                    {restSecs}
                  </div>
                  <div className="text-xs text-muted-foreground">seconds</div>
                </div>
              </div>

              {/* Next exercise info */}
              {nextExercise && (
                <div className="text-center mb-6">
                  <div className="text-xs text-muted-foreground mb-1">Coming up</div>
                  <div className="font-semibold">{exercises[exerciseIndex + (currentSetIndex === currentExercise?.sets - 1 ? 1 : 0)]?.exerciseName || nextExercise.exerciseName}</div>
                </div>
              )}

              <button
                data-testid="button-skip-rest"
                onClick={skipRest}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <SkipForward className="w-4 h-4" />
                Skip rest
              </button>
            </motion.div>
          )}

          {/* PAUSED */}
          {phase === "paused" && (
            <motion.div
              key="paused"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center"
            >
              <div className="w-20 h-20 bg-secondary rounded-3xl flex items-center justify-center mb-6">
                <Pause className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Workout Paused</h2>
              {isCreator ? (
                <>
                  <p className="text-muted-foreground text-sm mb-8">Tap resume to continue.</p>
                  <Button onClick={togglePause} size="lg" className="w-full max-w-xs press-scale">
                    <Play className="w-5 h-5 mr-2" />
                    Resume Workout
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">Waiting for the creator to resume...</p>
              )}
            </motion.div>
          )}

          {/* COMPLETE */}
          {phase === "complete" && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4"
            >
              <motion.div
                animate={{ rotate: [0, -10, 10, -5, 5, 0], scale: [1, 1.1, 1] }}
                transition={{ duration: 1, delay: 0.3 }}
                className="text-6xl mb-6"
              >
                🏆
              </motion.div>
              <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Workout Complete!</h2>
              <p className="text-muted-foreground text-sm mb-8">{activeWorkout.planName}</p>

              <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-8">
                {[
                  { label: "Duration", value: formatTime(elapsedSecs) },
                  { label: "Volume", value: `${Math.round(totalVolume).toLocaleString()}` },
                  { label: "Exercises", value: String(totalExercises) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border rounded-xl p-3 text-center">
                    <div className="text-lg font-bold text-primary" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              <Button
                data-testid="button-done"
                onClick={handleEnd}
                size="lg"
                className="w-full max-w-xs press-scale"
              >
                Done
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>End workout early?</AlertDialogTitle>
            <AlertDialogDescription>
              Your progress so far will be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Going</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowEndDialog(false); finishWorkout(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End Workout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
