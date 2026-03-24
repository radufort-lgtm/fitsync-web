import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useApp } from "@/context/AppContext";
import { apiRequest } from "@/lib/queryClient";
import { localCache } from "@/lib/localCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Users, Dumbbell, Zap, Settings,
  ClipboardList, Plus, Minus, RefreshCw, X, Check, Loader2,
  Brain, Clock, Flame, Target, Search, ListChecks, Repeat
} from "lucide-react";
import type { PlannedExercise, User, Exercise } from "@shared/schema";

const WORKOUT_TYPES = [
  { id: "Weight Training", label: "Weight Training", emoji: "🏋️", desc: "Barbells, dumbbells & machines" },
  { id: "Bodyweight", label: "Bodyweight", emoji: "🤸", desc: "No equipment needed" },
  { id: "Performance", label: "Performance", emoji: "⚡", desc: "Speed, power & agility" },
];

const EQUIPMENT = [
  "Barbell", "Dumbbells", "Kettlebells", "Cable Machine", "Pull-up Bar", "Bench", "Squat Rack", "Bands", "None"
];

const GOALS = ["Strength", "Muscle Gain", "Fat Loss", "Performance", "General Fitness"];
const DURATIONS = [30, 45, 60, 90];
const INTENSITIES = ["Light", "Moderate", "Intense", "Extreme"];
const BREAK_OPTIONS = [30, 60, 90, 120, 180];
const ROTATION_OPTIONS = [1, 2, 3, 4, 5];

const intensityColors: Record<string, string> = {
  Light: "text-chart-3 border-chart-3/40 bg-chart-3/10",
  Moderate: "text-chart-1 border-chart-1/40 bg-chart-1/10",
  Intense: "text-chart-4 border-chart-4/40 bg-chart-4/10",
  Extreme: "text-chart-5 border-chart-5/40 bg-chart-5/10",
};

const MUSCLE_GROUPS = [
  "All", "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Quads", "Hamstrings", "Glutes", "Core", "Calves", "Forearms"
];

const STEP_LABELS = ["Group", "Friends", "Type", "Equipment", "Settings", "Exercises", "Review"];

interface WorkoutConfig {
  groupSize: number;
  participants: string[];
  workoutTypes: string[];
  equipment: string[];
  goal: string;
  duration: number;
  intensity: string;
  breakDuration: number;
  rotationCount: number;
}

interface GeneratedPlan {
  name: string;
  exercises: PlannedExercise[];
  aiReasoning: string;
}

export default function WorkoutNew() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<WorkoutConfig>({
    groupSize: 1,
    participants: [],
    workoutTypes: ["Weight Training"],
    equipment: ["Barbell", "Dumbbells", "Bench"],
    goal: "Muscle Gain",
    duration: 45,
    intensity: "Moderate",
    breakDuration: 60,
    rotationCount: 1,
  });
  const [newParticipant, setNewParticipant] = useState("");
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [muscleFilter, setMuscleFilter] = useState("All");

  const { currentUser, setActiveWorkout } = useApp();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: friends = [] } = useQuery<User[]>({
    queryKey: ["/api/users", currentUser?.id, "friends"],
    queryFn: async () => {
      const data = await apiRequest("GET", `/api/users/${currentUser?.id}/friends`);
      localCache.saveFriends(data);
      return data;
    },
    enabled: !!currentUser?.id,
  });

  // Fetch all available exercises from the database
  const { data: allExercises = [] } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
    queryFn: () => apiRequest("GET", "/api/exercises"),
  });

  // Skip friends step if solo
  const totalSteps = config.groupSize === 1 ? STEP_LABELS.length - 1 : STEP_LABELS.length;
  const stepLabels = config.groupSize === 1
    ? STEP_LABELS.filter(s => s !== "Friends")
    : STEP_LABELS;

  // Map display step to actual step
  const getActualStep = (displayStep: number) => {
    if (config.groupSize === 1 && displayStep >= 1) return displayStep + 1;
    return displayStep;
  };

  // Filtered exercises for the picker
  const filteredExercises = useMemo(() => {
    let list = allExercises;

    if (muscleFilter !== "All") {
      list = list.filter(ex => ex.primaryMuscle === muscleFilter);
    }

    if (exerciseSearch.trim()) {
      const q = exerciseSearch.toLowerCase();
      list = list.filter(ex =>
        ex.name.toLowerCase().includes(q) ||
        ex.primaryMuscle.toLowerCase().includes(q)
      );
    }

    return list;
  }, [allExercises, muscleFilter, exerciseSearch]);

  const generatePlan = async () => {
    if (!currentUser) return;
    setGenerating(true);
    try {
      const result = await apiRequest("POST", "/api/workouts/generate", {
        userId: currentUser.id,
        workoutTypes: config.workoutTypes,
        equipment: config.equipment,
        goal: config.goal,
        duration: config.duration,
        intensity: config.intensity,
        restBetweenSets: config.breakDuration,
        participantUsernames: config.participants,
      });
      setGeneratedPlan(result);
    } catch (e: any) {
      toast({ title: "Failed to generate workout", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const isExerciseInPlan = (exerciseId: number) => {
    return generatedPlan?.exercises.some(e => e.exerciseId === exerciseId) ?? false;
  };

  const addExerciseToPlan = (exercise: Exercise) => {
    if (!generatedPlan) return;
    const newEx: PlannedExercise = {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      primaryMuscle: exercise.primaryMuscle,
      sets: 1,
      reps: 0, // not used in rotation mode
      weight: 0,
      restSeconds: config.breakDuration,
    };
    setGeneratedPlan({
      ...generatedPlan,
      exercises: [...generatedPlan.exercises, newEx],
    });
  };

  const removeExerciseFromPlan = (exerciseId: number) => {
    if (!generatedPlan) return;
    setGeneratedPlan({
      ...generatedPlan,
      exercises: generatedPlan.exercises.filter(e => e.exerciseId !== exerciseId),
    });
  };

  const handleNext = async () => {
    const isSettingsStep = stepLabels[step] === "Settings";
    if (isSettingsStep && !generatedPlan) {
      await generatePlan();
    }
    if (step < stepLabels.length - 1) {
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (step === 0) { navigate("/dashboard"); return; }
    setStep(s => s - 1);
  };

  const handleStartWorkout = async () => {
    if (!currentUser || !generatedPlan) return;
    if (generatedPlan.exercises.length === 0) {
      toast({ title: "Add at least one exercise", variant: "destructive" });
      return;
    }
    setStarting(true);
    try {
      // Save plan
      const plan = await apiRequest("POST", "/api/workout-plans", {
        name: generatedPlan.name,
        userId: currentUser.id,
        exercises: JSON.stringify(generatedPlan.exercises),
        workoutTypes: JSON.stringify(config.workoutTypes),
        goal: config.goal,
        estimatedDuration: config.duration,
        intensity: config.intensity,
        restBetweenSets: config.breakDuration,
        aiReasoning: generatedPlan.aiReasoning,
      });

      // Cache workout plan locally
      const cachedPlans = localCache.getWorkoutPlans();
      cachedPlans.push(plan);
      localCache.saveWorkoutPlans(cachedPlans);

      // Create session
      const session = await apiRequest("POST", "/api/workout-sessions", {
        planId: plan.id,
        userId: currentUser.id,
        participantUsernames: JSON.stringify([currentUser.username, ...config.participants]),
        creatorUsername: currentUser.username,
        isShared: config.participants.length > 0,
        status: "pending",
        isPaused: false,
        currentRotationIndex: 0,
      });

      // Send workout invites for group workouts
      if (config.participants.length > 0) {
        for (const participant of config.participants) {
          try {
            await apiRequest("POST", "/api/workout-invites", {
              sessionId: session.id,
              fromUsername: currentUser.username,
              toUsername: participant,
            });
          } catch (e) {
            console.error(`Failed to invite ${participant}`, e);
          }
        }
      }

      // Set active workout in context
      setActiveWorkout({
        sessionId: session.id,
        planId: plan.id,
        planName: generatedPlan.name,
        exercises: generatedPlan.exercises,
        creatorUsername: currentUser.username,
        isShared: config.participants.length > 0,
        participantUsernames: [currentUser.username, ...config.participants],
        restBetweenSets: config.breakDuration,
        aiReasoning: generatedPlan.aiReasoning,
        breakDuration: config.breakDuration,
        rotationCount: config.rotationCount,
      });

      navigate("/workout/active");
    } catch (e: any) {
      toast({ title: "Failed to start workout", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const variants = {
    enter: (dir: number) => ({ x: dir * 40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir * -40, opacity: 0 }),
  };

  const actual = getActualStep(step);
  const currentStepLabel = stepLabels[step];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 pt-12 pb-3 flex items-center gap-3">
        <button
          data-testid="button-back"
          onClick={handleBack}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>New Workout</h1>
          <p className="text-xs text-muted-foreground">{stepLabels[step]}</p>
        </div>
        {/* Step dots */}
        <div className="flex gap-1">
          {stepLabels.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === step ? "w-5 h-1.5 bg-primary" :
                i < step ? "w-1.5 h-1.5 bg-primary/60" :
                "w-1.5 h-1.5 bg-border"
              }`}
            />
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={step}
            custom={1}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: "easeInOut" }}
          >
            {/* Step 0: Group Size */}
            {actual === 0 && (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Who's training?</h2>
                  <p className="text-muted-foreground text-sm">Training solo or with friends?</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      data-testid={`group-size-${n}`}
                      onClick={() => setConfig(c => ({ ...c, groupSize: n, participants: n === 1 ? [] : c.participants }))}
                      className={`relative p-5 rounded-2xl border text-center transition-all duration-150 press-scale ${
                        config.groupSize === n
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      {config.groupSize === n && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                      )}
                      <div className="text-3xl mb-2">
                        {n === 1 ? "🧍" : n === 2 ? "👥" : n === 3 ? "👨‍👩‍👦" : "👨‍👩‍👧‍👦"}
                      </div>
                      <div className="font-bold text-sm">{n === 1 ? "Solo" : `${n} People`}</div>
                      <div className="text-xs text-muted-foreground mt-1">{n === 1 ? "Just me" : `${n - 1} friend${n > 2 ? "s" : ""}`}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Add Friends */}
            {actual === 1 && config.groupSize > 1 && (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Add Friends</h2>
                  <p className="text-muted-foreground text-sm">Add up to {config.groupSize - 1} friend{config.groupSize > 2 ? "s" : ""}.</p>
                </div>

                <div className="flex gap-2 mb-4">
                  <Input
                    data-testid="input-friend-username"
                    placeholder="Enter username"
                    value={newParticipant}
                    onChange={e => setNewParticipant(e.target.value)}
                    className="flex-1 bg-card"
                    onKeyDown={e => {
                      if (e.key === "Enter" && newParticipant.trim()) {
                        const u = newParticipant.trim().toLowerCase();
                        if (config.participants.length < config.groupSize - 1 && !config.participants.includes(u)) {
                          setConfig(c => ({ ...c, participants: [...c.participants, u] }));
                        }
                        setNewParticipant("");
                      }
                    }}
                  />
                  <Button
                    onClick={() => {
                      const u = newParticipant.trim().toLowerCase();
                      if (u && config.participants.length < config.groupSize - 1 && !config.participants.includes(u)) {
                        setConfig(c => ({ ...c, participants: [...c.participants, u] }));
                      }
                      setNewParticipant("");
                    }}
                    size="icon"
                    variant="secondary"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                {/* Select from accepted friends */}
                {friends.length > 0 ? (
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-medium">Your Friends</p>
                    <div className="space-y-2">
                      {friends.map(f => {
                        const isAdded = config.participants.includes(f.username);
                        return (
                          <button
                            key={f.id}
                            data-testid={`friend-${f.username}`}
                            onClick={() => {
                              if (isAdded) {
                                setConfig(c => ({ ...c, participants: c.participants.filter(p => p !== f.username) }));
                              } else if (config.participants.length < config.groupSize - 1) {
                                setConfig(c => ({ ...c, participants: [...c.participants, f.username] }));
                              }
                            }}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all press-scale ${
                              isAdded ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                            }`}
                          >
                            <div className="w-9 h-9 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-primary font-bold text-sm">{f.displayName[0]?.toUpperCase()}</span>
                            </div>
                            <div className="flex-1 text-left">
                              <div className="font-medium text-sm">{f.displayName}</div>
                              <div className="text-xs text-muted-foreground">@{f.username}</div>
                            </div>
                            {isAdded && <Check className="w-4 h-4 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-card border border-border rounded-2xl p-6 text-center mb-4">
                    <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">No friends yet. Add friends from the Friends tab first.</p>
                  </div>
                )}

                {/* Added participants */}
                {config.participants.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-medium">Added ({config.participants.length}/{config.groupSize - 1})</p>
                    <div className="flex flex-wrap gap-2">
                      {config.participants.map(p => (
                        <div key={p} className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 bg-primary/10 rounded-full border border-primary/30">
                          <span className="text-primary text-xs font-medium">@{p}</span>
                          <button
                            onClick={() => setConfig(c => ({ ...c, participants: c.participants.filter(x => x !== p) }))}
                            className="w-4 h-4 flex items-center justify-center rounded-full bg-primary/20 hover:bg-primary/30 transition-colors"
                          >
                            <X className="w-2.5 h-2.5 text-primary" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Workout Type */}
            {actual === 2 && (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Workout Type</h2>
                  <p className="text-muted-foreground text-sm">Select all that apply.</p>
                </div>
                <div className="space-y-3">
                  {WORKOUT_TYPES.map(wt => {
                    const isSelected = config.workoutTypes.includes(wt.id);
                    return (
                      <button
                        key={wt.id}
                        data-testid={`workout-type-${wt.id}`}
                        onClick={() => {
                          setConfig(c => ({
                            ...c,
                            workoutTypes: isSelected
                              ? c.workoutTypes.filter(t => t !== wt.id)
                              : [...c.workoutTypes, wt.id],
                          }));
                        }}
                        className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all duration-150 press-scale ${
                          isSelected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${isSelected ? "bg-primary/20" : "bg-secondary"}`}>
                          {wt.emoji}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-sm">{wt.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{wt.desc}</div>
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 3: Equipment */}
            {actual === 3 && (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Equipment Available</h2>
                  <p className="text-muted-foreground text-sm">What do you have access to?</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT.map(eq => {
                    const isSelected = config.equipment.includes(eq);
                    return (
                      <button
                        key={eq}
                        data-testid={`equipment-${eq}`}
                        onClick={() => {
                          if (eq === "None") {
                            setConfig(c => ({ ...c, equipment: isSelected ? [] : ["None"] }));
                            return;
                          }
                          setConfig(c => ({
                            ...c,
                            equipment: isSelected
                              ? c.equipment.filter(e => e !== eq)
                              : [...c.equipment.filter(e => e !== "None"), eq],
                          }));
                        }}
                        className={`px-4 py-2 rounded-full border text-sm font-medium transition-all duration-150 press-scale ${
                          isSelected
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        {eq}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 4: Settings */}
            {actual === 4 && (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Settings</h2>
                  <p className="text-muted-foreground text-sm">Customize your session.</p>
                </div>
                <div className="space-y-5">
                  {/* Goal */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Goal</label>
                    <div className="flex flex-wrap gap-2">
                      {GOALS.map(g => (
                        <button
                          key={g}
                          data-testid={`goal-${g}`}
                          onClick={() => setConfig(c => ({ ...c, goal: g }))}
                          className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all press-scale ${
                            config.goal === g ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Duration (minutes)
                    </label>
                    <div className="flex gap-2">
                      {DURATIONS.map(d => (
                        <button
                          key={d}
                          data-testid={`duration-${d}`}
                          onClick={() => setConfig(c => ({ ...c, duration: d }))}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-all press-scale ${
                            config.duration === d ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Intensity */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Flame className="w-3 h-3" /> Intensity
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {INTENSITIES.map(int => (
                        <button
                          key={int}
                          data-testid={`intensity-${int}`}
                          onClick={() => setConfig(c => ({ ...c, intensity: int }))}
                          className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-all press-scale ${
                            config.intensity === int
                              ? intensityColors[int]
                              : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {int}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Break Duration */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Target className="w-3 h-3" /> Break between stations
                    </label>
                    <div className="flex gap-2">
                      {BREAK_OPTIONS.map(r => (
                        <button
                          key={r}
                          data-testid={`break-${r}`}
                          onClick={() => setConfig(c => ({ ...c, breakDuration: r }))}
                          className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all press-scale ${
                            config.breakDuration === r ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {r}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation Count */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Repeat className="w-3 h-3" /> Full rotations
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">How many times everyone does all stations</p>
                    <div className="flex gap-2">
                      {ROTATION_OPTIONS.map(r => (
                        <button
                          key={r}
                          data-testid={`rotation-${r}`}
                          onClick={() => setConfig(c => ({ ...c, rotationCount: r }))}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-all press-scale ${
                            config.rotationCount === r ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {r}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Exercise Picker */}
            {actual === 5 && (
              <div>
                <div className="mb-4">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Pick Stations</h2>
                  <p className="text-muted-foreground text-sm">
                    {generating ? "Generating your workout..." :
                     generatedPlan ? `${generatedPlan.exercises.length} stations — each station = 3 min of work.` :
                     "Loading..."}
                  </p>
                </div>

                {generating ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
                      <Brain className="w-8 h-8 text-primary animate-pulse" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold mb-1">Generating suggestions...</div>
                      <p className="text-sm text-muted-foreground">Building your optimal workout</p>
                    </div>
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 bg-primary rounded-full"
                          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  </div>
                ) : generatedPlan ? (
                  <div className="space-y-3">
                    {/* Current selection summary */}
                    {generatedPlan.exercises.length > 0 && (
                      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <ListChecks className="w-4 h-4 text-primary" />
                          <span className="text-xs font-semibold text-primary uppercase tracking-wide">Stations ({generatedPlan.exercises.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {generatedPlan.exercises.map((ex, i) => (
                            <button
                              key={`selected-${ex.exerciseId}-${i}`}
                              onClick={() => removeExerciseFromPlan(ex.exerciseId)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 rounded-full text-xs font-medium text-primary border border-primary/20 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-colors"
                            >
                              {ex.exerciseName}
                              <X className="w-3 h-3 ml-0.5" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Search */}
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search exercises..."
                        value={exerciseSearch}
                        onChange={e => setExerciseSearch(e.target.value)}
                        className="pl-9 bg-card"
                      />
                    </div>

                    {/* Muscle group filter */}
                    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
                      {MUSCLE_GROUPS.map(mg => (
                        <button
                          key={mg}
                          onClick={() => setMuscleFilter(mg)}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-all ${
                            muscleFilter === mg
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {mg}
                        </button>
                      ))}
                    </div>

                    {/* Exercise list */}
                    <div className="space-y-1.5">
                      {filteredExercises.map(ex => {
                        const inPlan = isExerciseInPlan(ex.id);
                        return (
                          <button
                            key={ex.id}
                            onClick={() => inPlan ? removeExerciseFromPlan(ex.id) : addExerciseToPlan(ex)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                              inPlan
                                ? "border-primary bg-primary/10"
                                : "border-border bg-card hover:border-primary/30"
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              inPlan ? "bg-primary" : "bg-secondary"
                            }`}>
                              {inPlan ? (
                                <Check className="w-4 h-4 text-primary-foreground" />
                              ) : (
                                <Plus className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{ex.name}</div>
                              <div className="text-xs text-muted-foreground">{ex.primaryMuscle}{ex.isCompound ? " · Compound" : ""}</div>
                            </div>
                          </button>
                        );
                      })}

                      {filteredExercises.length === 0 && (
                        <div className="py-8 text-center text-muted-foreground text-sm">
                          No exercises match your search.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Step 6: Review */}
            {actual === 6 && (
              <div>
                <div className="mb-4">
                  <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Your Workout</h2>
                  <p className="text-muted-foreground text-sm">Review and start.</p>
                </div>

                {generatedPlan ? (
                  <div className="space-y-4">
                    {/* Plan header */}
                    <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4">
                      <div className="font-bold text-lg mb-2" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{generatedPlan.name}</div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground"><Clock className="w-3 h-3" />{config.duration} min</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Flame className="w-3 h-3" />{config.intensity}</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Dumbbell className="w-3 h-3" />{generatedPlan.exercises.length} stations</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Target className="w-3 h-3" />{config.goal}</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Repeat className="w-3 h-3" />{config.rotationCount}x rotation</span>
                      </div>
                    </div>

                    {/* Rotation info */}
                    <div className="bg-card border border-border rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Repeat className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Rotation Format</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        3 min per station · {config.breakDuration}s break · {config.rotationCount} full rotation{config.rotationCount > 1 ? "s" : ""} · Everyone starts at a different station
                      </p>
                    </div>

                    {/* AI Reasoning */}
                    <div className="bg-card border border-border rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Why this workout</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{generatedPlan.aiReasoning}</p>
                    </div>

                    {/* Exercise list */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold">Stations</span>
                      </div>
                      <div className="space-y-2">
                        {generatedPlan.exercises.map((ex, i) => (
                          <motion.div
                            key={`${ex.exerciseId}-${i}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="bg-card border border-border rounded-xl p-3 flex items-center gap-3"
                          >
                            <div className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{ex.exerciseName}</div>
                              <div className="text-xs text-muted-foreground">{ex.primaryMuscle} · 3 min</div>
                            </div>
                            <button
                              onClick={() => removeExerciseFromPlan(ex.exerciseId)}
                              className="w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 transition-colors"
                            >
                              <X className="w-3 h-3 text-destructive" />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border p-4">
        {actual === 6 && generatedPlan ? (
          <Button
            data-testid="button-start-workout"
            onClick={handleStartWorkout}
            disabled={starting || generatedPlan.exercises.length === 0}
            size="lg"
            className="w-full press-scale glow-primary"
          >
            {starting ? (
              <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Starting...</span>
            ) : (
              <span className="flex items-center gap-2"><Zap className="w-4 h-4" />Start Workout</span>
            )}
          </Button>
        ) : (
          <Button
            data-testid="button-continue"
            onClick={handleNext}
            disabled={generating || (actual === 2 && config.workoutTypes.length === 0)}
            size="lg"
            className="w-full press-scale"
          >
            {generating ? (
              <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Generating...</span>
            ) : (
              <span className="flex items-center gap-2">
                {currentStepLabel === "Settings" ? "Generate Workout" : "Continue"}
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
