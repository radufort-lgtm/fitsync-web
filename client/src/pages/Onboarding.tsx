import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useApp } from "@/context/AppContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Dumbbell, User, Ruler, Target, ChevronRight, Check } from "lucide-react";

const GOALS = [
  { id: "Muscle Gain", label: "Muscle Gain", emoji: "💪" },
  { id: "Fat Loss", label: "Fat Loss", emoji: "🔥" },
  { id: "Strength", label: "Strength", emoji: "🏋️" },
  { id: "Performance", label: "Performance", emoji: "⚡" },
  { id: "General Fitness", label: "General Fitness", emoji: "🌟" },
  { id: "Flexibility", label: "Flexibility", emoji: "🧘" },
];

const STEPS = [
  { id: 0, title: "Welcome to FitSync", icon: Dumbbell },
  { id: 1, title: "Your Profile", icon: User },
  { id: 2, title: "Your Body", icon: Ruler },
  { id: 3, title: "Your Goals", icon: Target },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [heightFt, setHeightFt] = useState("5");
  const [heightIn, setHeightIn] = useState("10");
  const [weightLbs, setWeightLbs] = useState("165");
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const { setCurrentUser } = useApp();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleGoalToggle = (id: string) => {
    setSelectedGoals(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const handleNext = async () => {
    if (step === 0) { setStep(1); return; }
    if (step === 1) {
      if (!username.trim() || !displayName.trim()) {
        toast({ title: "Please fill in all fields", variant: "destructive" });
        return;
      }
      setStep(2); return;
    }
    if (step === 2) { setStep(3); return; }
    if (step === 3) {
      if (selectedGoals.length === 0) {
        toast({ title: "Select at least one goal", variant: "destructive" });
        return;
      }
      setLoading(true);
      try {
        // Convert height to cm
        const totalInches = parseInt(heightFt) * 12 + parseInt(heightIn);
        const heightCm = Math.round(totalInches * 2.54);
        const weightKg = Math.round(parseFloat(weightLbs) * 0.453592 * 10) / 10;

        const user = await apiRequest("POST", "/api/users", {
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          heightCm,
          weightKg,
          goals: JSON.stringify(selectedGoals),
        });
        setCurrentUser(user);
        navigate("/dashboard");
      } catch (e: any) {
        toast({ title: e.message || "Something went wrong", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }
  };

  const variants = {
    enter: { x: 40, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: -40, opacity: 0 },
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2">
        <svg aria-label="FitSync" viewBox="0 0 32 32" width="32" height="32" fill="none" className="text-primary">
          <rect x="2" y="10" width="6" height="12" rx="2" fill="currentColor" opacity="0.4"/>
          <rect x="10" y="6" width="12" height="20" rx="2" fill="currentColor"/>
          <rect x="24" y="10" width="6" height="12" rx="2" fill="currentColor" opacity="0.4"/>
          <circle cx="16" cy="16" r="3" fill="hsl(195 40% 8%)"/>
        </svg>
        <span className="text-xl font-bold text-primary" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>FitSync</span>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((s) => (
          <div
            key={s.id}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s.id === step ? "w-8 bg-primary" : s.id < step ? "w-4 bg-primary/60" : "w-4 bg-border"
            }`}
          />
        ))}
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-card rounded-2xl border border-border p-6 shadow-lg">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {step === 0 && (
              <div className="text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <Dumbbell className="w-10 h-10 text-primary" />
                </div>
                <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Welcome to FitSync</h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  AI-powered workouts that adapt to you. Train smarter, track progress, and push together with friends.
                </p>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Your Profile</h2>
                <p className="text-muted-foreground text-sm mb-6">How should we call you?</p>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Username</label>
                    <Input
                      data-testid="input-username"
                      placeholder="e.g. jsmith"
                      value={username}
                      onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      className="bg-background"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Letters, numbers and underscores only</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Display Name</label>
                    <Input
                      data-testid="input-display-name"
                      placeholder="e.g. John Smith"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Your Body</h2>
                <p className="text-muted-foreground text-sm mb-6">This helps personalize your training.</p>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Height</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          data-testid="input-height-ft"
                          type="number"
                          placeholder="5"
                          value={heightFt}
                          onChange={e => setHeightFt(e.target.value)}
                          className="bg-background"
                        />
                        <p className="text-xs text-muted-foreground mt-1 text-center">ft</p>
                      </div>
                      <div className="flex-1">
                        <Input
                          data-testid="input-height-in"
                          type="number"
                          placeholder="10"
                          value={heightIn}
                          onChange={e => setHeightIn(e.target.value)}
                          className="bg-background"
                        />
                        <p className="text-xs text-muted-foreground mt-1 text-center">in</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Weight (lbs)</label>
                    <Input
                      data-testid="input-weight"
                      type="number"
                      placeholder="165"
                      value={weightLbs}
                      onChange={e => setWeightLbs(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Your Goals</h2>
                <p className="text-muted-foreground text-sm mb-4">Select all that apply.</p>
                <div className="grid grid-cols-2 gap-2">
                  {GOALS.map(goal => {
                    const isSelected = selectedGoals.includes(goal.id);
                    return (
                      <button
                        key={goal.id}
                        data-testid={`goal-${goal.id}`}
                        onClick={() => handleGoalToggle(goal.id)}
                        className={`relative p-3 rounded-xl border text-left transition-all duration-150 press-scale ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground hover:border-primary/40"
                        }`}
                      >
                        {isSelected && (
                          <span className="absolute top-2 right-2 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-primary-foreground" />
                          </span>
                        )}
                        <div className="text-lg mb-1">{goal.emoji}</div>
                        <div className="text-xs font-medium">{goal.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <Button
          data-testid="button-next"
          onClick={handleNext}
          disabled={loading}
          className="w-full mt-6 press-scale"
          size="lg"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              Creating profile...
            </span>
          ) : step === STEPS.length - 1 ? (
            <span className="flex items-center gap-2">Let's Go! <Dumbbell className="w-4 h-4" /></span>
          ) : (
            <span className="flex items-center gap-2">Continue <ChevronRight className="w-4 h-4" /></span>
          )}
        </Button>
      </div>


    </div>
  );
}
