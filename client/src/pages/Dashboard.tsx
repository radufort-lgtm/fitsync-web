import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { useApp } from "@/context/AppContext";
import { apiRequest } from "@/lib/queryClient";
import { localCache } from "@/lib/localCache";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import FitSyncLogo from "@/components/FitSyncLogo";
import NotificationBell from "@/components/NotificationBell";
import { useToast } from "@/hooks/use-toast";
import {
  Dumbbell, Flame, TrendingUp, Clock, Users, ChevronRight,
  Zap, Brain, Moon, Sun, RotateCcw, Award, Target, Bookmark, Trash2
} from "lucide-react";
import type { WorkoutHistory } from "@shared/schema";

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getStreak(history: WorkoutHistory[]): number {
  if (history.length === 0) return 0;
  const workoutDays = new Set<string>();
  for (const h of history) {
    workoutDays.add(dateKey(new Date(h.completedAt)));
  }
  let streak = 0;
  const checkDate = new Date();
  // If today has no workout yet, start checking from yesterday (streak may still be live)
  if (!workoutDays.has(dateKey(checkDate))) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  while (workoutDays.has(dateKey(checkDate))) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }
  return streak;
}

function getWeakestMuscle(history: WorkoutHistory[]): { muscle: string; daysSince: number } | null {
  const muscleLastTrained: Record<string, Date> = {};
  for (const h of history) {
    const muscles: string[] = JSON.parse(h.musclesWorked || "[]");
    const date = new Date(h.completedAt);
    for (const m of muscles) {
      if (!muscleLastTrained[m] || date > muscleLastTrained[m]) muscleLastTrained[m] = date;
    }
  }
  const allMuscles = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Core", "Calves"];
  let weakest: { muscle: string; daysSince: number } | null = null;
  for (const muscle of allMuscles) {
    const last = muscleLastTrained[muscle];
    const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : 999;
    if (daysSince >= 4 && (!weakest || daysSince > weakest.daysSince)) {
      weakest = { muscle, daysSince };
    }
  }
  return weakest;
}

function getPersonalBest(history: WorkoutHistory[]): WorkoutHistory | null {
  if (history.length === 0) return null;
  return history.reduce((best, h) => (h.totalVolume || 0) > (best.totalVolume || 0) ? h : best);
}

function getGreeting(name: string) {
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${greeting}, ${name.split(" ")[0]}`;
}

function getMuscleBalance(history: WorkoutHistory[]) {
  const groups: Record<string, number> = {
    Push: 0, Pull: 0, Legs: 0, Core: 0,
  };
  const pushMuscles = ["Chest", "Shoulders", "Triceps"];
  const pullMuscles = ["Back", "Biceps"];
  const legMuscles = ["Quads", "Hamstrings", "Glutes", "Calves"];

  for (const h of history) {
    const muscles: string[] = JSON.parse(h.musclesWorked || "[]");
    const vol = h.totalVolume || 1;
    for (const m of muscles) {
      if (pushMuscles.includes(m)) groups.Push += vol / muscles.length;
      else if (pullMuscles.includes(m)) groups.Pull += vol / muscles.length;
      else if (legMuscles.includes(m)) groups.Legs += vol / muscles.length;
      else if (m === "Core") groups.Core += vol / muscles.length;
    }
  }

  const max = Math.max(...Object.values(groups), 1);
  return Object.entries(groups).map(([name, vol]) => ({
    name,
    pct: Math.round((vol / max) * 100),
    vol,
  }));
}

function getAIRecommendations(history: WorkoutHistory[]) {
  const recommendations: { icon: any; text: string; type: "info" | "warning" | "success" }[] = [];

  if (history.length === 0) {
    recommendations.push({ icon: Dumbbell, text: "Ready to start your first workout? Let's go!", type: "info" });
    return recommendations;
  }

  const now = Date.now();
  const muscleLastTrained: Record<string, Date> = {};
  const muscleVolume: Record<string, number> = {};

  for (const h of history) {
    const muscles: string[] = JSON.parse(h.musclesWorked || "[]");
    const date = new Date(h.completedAt);
    for (const m of muscles) {
      if (!muscleLastTrained[m] || date > muscleLastTrained[m]) muscleLastTrained[m] = date;
      muscleVolume[m] = (muscleVolume[m] || 0) + (h.totalVolume || 0) / muscles.length;
    }
  }

  const daysSince = (m: string) => {
    if (!muscleLastTrained[m]) return 99;
    return (now - muscleLastTrained[m].getTime()) / (1000 * 60 * 60 * 24);
  };

  const legDays = daysSince("Quads");
  if (legDays > 5) {
    recommendations.push({ icon: Flame, text: `You haven't trained legs in ${Math.floor(legDays)} days — time to squat!`, type: "warning" });
  }

  const pushVol = (muscleVolume["Chest"] || 0) + (muscleVolume["Shoulders"] || 0);
  const pullVol = (muscleVolume["Back"] || 0) + (muscleVolume["Biceps"] || 0);
  if (pushVol > pullVol * 1.4) {
    recommendations.push({ icon: TrendingUp, text: "Your pushing volume is ahead of pulling — add back work.", type: "warning" });
  } else if (pullVol > pushVol * 1.4) {
    recommendations.push({ icon: TrendingUp, text: "Your pulling volume is ahead — balance with chest work.", type: "info" });
  }

  const recentWorkouts = history.filter(h => {
    const d = (now - new Date(h.completedAt).getTime()) / (1000 * 60 * 60 * 24);
    return d <= 7;
  });
  if (recentWorkouts.length >= 5) {
    recommendations.push({ icon: Moon, text: "You've trained 5+ times this week — rest day recommended.", type: "success" });
  } else if (recentWorkouts.length === 0) {
    recommendations.push({ icon: Zap, text: "Get back on track — start your first workout this week!", type: "info" });
  } else {
    recommendations.push({ icon: Brain, text: `Great consistency! ${recentWorkouts.length} workout${recentWorkouts.length > 1 ? "s" : ""} this week.`, type: "success" });
  }

  return recommendations.slice(0, 3);
}

const groupColors: Record<string, string> = {
  Push: "bg-chart-1",
  Pull: "bg-chart-2",
  Legs: "bg-chart-3",
  Core: "bg-chart-4",
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.3, ease: "easeOut" },
  }),
};

export default function Dashboard() {
  const { currentUser, isDark, toggleDark, setActiveWorkout } = useApp();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<any[]>(() => localCache.getTemplates());

  const { data: historyData, isLoading: historyLoading } = useQuery<WorkoutHistory[]>({
    queryKey: ["/api/users", currentUser?.id, "workout-history"],
    queryFn: async () => {
      const data = await apiRequest("GET", `/api/users/${currentUser?.id}/workout-history`);
      localCache.saveWorkoutHistory(data);
      return data;
    },
    enabled: !!currentUser?.id,
  });

  const { data: weekData, isLoading: weekLoading } = useQuery<WorkoutHistory[]>({
    queryKey: ["/api/users", currentUser?.id, "workout-history-recent"],
    queryFn: () => apiRequest("GET", `/api/users/${currentUser?.id}/workout-history/recent?days=7`),
    enabled: !!currentUser?.id,
  });

  const history = historyData || [];
  const weekHistory = weekData || [];

  const weekVolume = weekHistory.reduce((sum, h) => sum + (h.totalVolume || 0), 0);
  const weekWorkouts = weekHistory.length;

  const muscleBalance = getMuscleBalance(history);
  const recommendations = getAIRecommendations(history);
  const recentWorkouts = history.slice(0, 3);
  const streak = getStreak(history);
  const weakestMuscle = getWeakestMuscle(history);
  const personalBest = getPersonalBest(history);

  const quickStartTemplate = async (tpl: any) => {
    if (!currentUser) return;
    try {
      const newPlan = await apiRequest("POST", "/api/workout-plans", {
        name: tpl.name,
        userId: currentUser.id,
        exercises: JSON.stringify(tpl.exercises),
        workoutTypes: "[]",
        goal: tpl.goal || "Muscle Gain",
        estimatedDuration: 45,
        intensity: "Moderate",
        restBetweenSets: tpl.restBetweenSets || 90,
        aiReasoning: "",
      });
      const session = await apiRequest("POST", "/api/workout-sessions", {
        planId: newPlan.id,
        userId: currentUser.id,
        participantUsernames: JSON.stringify([currentUser.username]),
        creatorUsername: currentUser.username,
        isShared: false,
        status: "pending",
        isPaused: false,
        currentRotationIndex: 0,
      });
      setActiveWorkout({
        sessionId: session.id,
        planId: newPlan.id,
        planName: newPlan.name,
        exercises: tpl.exercises,
        creatorUsername: currentUser.username,
        isShared: false,
        participantUsernames: [currentUser.username],
        restBetweenSets: tpl.restBetweenSets || 90,
        aiReasoning: "",
        breakDuration: tpl.restBetweenSets || 90,
        rotationCount: 1,
        targetDuration: 45,
      });
      navigate("/workout/active");
    } catch {
      toast({ title: "Failed to start template", variant: "destructive" });
    }
  };

  const formatVolume = (v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    return `${m}m`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const diff = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-12 pb-4 flex items-center justify-between">
        <FitSyncLogo />
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            data-testid="button-theme-toggle"
            onClick={toggleDark}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="px-4 space-y-4">
        {/* Greeting */}
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                {currentUser ? getGreeting(currentUser.displayName) : "Welcome back"}
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">Ready to crush your workout?</p>
            </div>
            {streak > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex flex-col items-center px-3 py-1.5 bg-chart-4/10 rounded-xl border border-chart-4/20"
              >
                <Flame className="w-4 h-4 text-chart-4" />
                <span className="text-sm font-bold text-chart-4 leading-none mt-0.5">{streak}</span>
                <span className="text-[9px] text-chart-4/70">streak</span>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3">
          <Button
            data-testid="button-start-workout"
            size="lg"
            className="h-14 text-base font-bold press-scale glow-primary col-span-2"
            onClick={() => navigate("/workout/new")}
          >
            <Dumbbell className="w-5 h-5 mr-2" />
            Start Workout
          </Button>
          {recentWorkouts.length > 0 && (
            <Button
              data-testid="button-repeat-workout"
              variant="secondary"
              size="lg"
              className="h-12 text-sm col-span-2 press-scale"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Repeat: {recentWorkouts[0]?.planName || "Last Workout"}
            </Button>
          )}
        </motion.div>

        {/* Saved Templates */}
        {templates.length > 0 && (
          <motion.div custom={1.5} variants={cardVariants} initial="hidden" animate="visible">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Templates</span>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {templates.map((tpl: any) => (
                <div key={tpl.id} className="flex-shrink-0 bg-card border border-border rounded-xl p-3 w-44">
                  <div className="font-medium text-sm truncate mb-1">{tpl.name}</div>
                  <div className="text-xs text-muted-foreground mb-3">{tpl.exercises?.length || 0} exercises</div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs press-scale"
                      onClick={() => quickStartTemplate(tpl)}
                    >
                      <Dumbbell className="w-3 h-3 mr-1" />Start
                    </Button>
                    <button
                      onClick={() => {
                        localCache.deleteTemplate(tpl.id);
                        setTemplates(localCache.getTemplates());
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Weekly Stats */}
        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">This Week</span>
              <span className="text-xs text-primary font-medium">{new Date().toLocaleDateString("en-US", { weekday: "long" })}</span>
            </div>
            {weekLoading ? (
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Workouts", value: weekWorkouts.toString(), icon: Dumbbell },
                  { label: "Volume", value: `${formatVolume(weekVolume)} lbs`, icon: TrendingUp },
                  { label: "Avg Duration", value: weekHistory.length ? formatDuration(weekHistory.reduce((s, h) => s + h.duration, 0) / weekHistory.length) : "—", icon: Clock },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="bg-secondary/60 rounded-xl p-3 text-center">
                    <Icon className="w-4 h-4 text-primary mx-auto mb-1" />
                    <div className="text-lg font-bold font-mono-time" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Weakest Muscle Callout */}
        {weakestMuscle && (
          <motion.div custom={2.5} variants={cardVariants} initial="hidden" animate="visible">
            <div className="bg-card border border-chart-4/30 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-chart-4/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <Target className="w-5 h-5 text-chart-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{weakestMuscle.muscle} needs attention</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {weakestMuscle.daysSince === 999 ? "Never trained" : `${weakestMuscle.daysSince} days since last session`}
                </div>
              </div>
              <Button size="sm" onClick={() => navigate("/workout/new")} className="press-scale flex-shrink-0 text-xs h-8">
                Train Now
              </Button>
            </div>
          </motion.div>
        )}

        {/* Personal Best */}
        {personalBest && personalBest.totalVolume > 0 && (
          <motion.div custom={2.7} variants={cardVariants} initial="hidden" animate="visible">
            <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <Award className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">Personal Best</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {personalBest.planName} — {formatVolume(personalBest.totalVolume)} lbs total volume
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* AI Recommendations */}
        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">AI Insights</span>
          </div>
          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className={`flex items-start gap-3 p-3 rounded-xl border ${
                  rec.type === "warning" ? "border-chart-4/30 bg-chart-4/5" :
                  rec.type === "success" ? "border-chart-3/30 bg-chart-3/5" :
                  "border-primary/20 bg-primary/5"
                }`}
              >
                <rec.icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                  rec.type === "warning" ? "text-chart-4" :
                  rec.type === "success" ? "text-chart-3" :
                  "text-primary"
                }`} />
                <span className="text-sm text-foreground/90">{rec.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Muscle Balance */}
        <motion.div custom={4} variants={cardVariants} initial="hidden" animate="visible">
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Muscle Balance</span>
              <span className="text-xs text-muted-foreground">Last 14 days</span>
            </div>
            <div className="space-y-3">
              {muscleBalance.map(({ name, pct }) => (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground font-medium">{name}</span>
                    <span className="text-foreground font-semibold">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${
                        name === "Push" ? "bg-chart-1" :
                        name === "Pull" ? "bg-chart-2" :
                        name === "Legs" ? "bg-chart-3" : "bg-chart-4"
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut", delay: 0.4 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Recent Workouts */}
        {(historyLoading || recentWorkouts.length > 0) && (
          <motion.div custom={5} variants={cardVariants} initial="hidden" animate="visible">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Recent Workouts</span>
              <Link href="/history">
                <button className="text-xs text-primary flex items-center gap-1 hover:opacity-80 transition-opacity">
                  See all <ChevronRight className="w-3 h-3" />
                </button>
              </Link>
            </div>
            {historyLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {recentWorkouts.map((w, i) => {
                  const muscles: string[] = JSON.parse(w.musclesWorked || "[]");
                  return (
                    <motion.div
                      key={w.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + i * 0.07 }}
                      className="bg-card border border-border rounded-xl p-3 flex items-center gap-3"
                    >
                      <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Dumbbell className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{w.planName || "Workout"}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(w.duration)}</span>
                          <span>·</span>
                          <span>{formatVolume(w.totalVolume)} lbs</span>
                        </div>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {muscles.slice(0, 3).map(m => (
                            <span key={m} className="text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">{m}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-muted-foreground">{formatDate(w.completedAt)}</div>
                        {w.wasShared && (
                          <div className="flex items-center gap-1 mt-1 justify-end">
                            <Users className="w-3 h-3 text-chart-2" />
                            <span className="text-[10px] text-chart-2">{w.participantCount}</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* Empty state */}
        {!historyLoading && history.length === 0 && (
          <motion.div custom={5} variants={cardVariants} initial="hidden" animate="visible">
            <div className="bg-card border border-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Dumbbell className="w-8 h-8 text-primary" />
              </div>
              <div className="font-semibold text-base mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>No workouts yet</div>
              <p className="text-sm text-muted-foreground mb-4">Start your first workout to see your progress here.</p>
              <Button onClick={() => navigate("/workout/new")} size="sm" className="press-scale">
                Start First Workout
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
