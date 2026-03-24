import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { localCache } from "@/lib/localCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Edit2, Check, Dumbbell, Clock, TrendingUp, Target, LogOut } from "lucide-react";
import type { WorkoutHistory } from "@shared/schema";

const GOALS = ["Strength", "Muscle Gain", "Fat Loss", "Performance", "General Fitness", "Flexibility"];

function cmToFtIn(cm: number) {
  const totalIn = cm / 2.54;
  return { ft: Math.floor(totalIn / 12), inches: Math.round(totalIn % 12) };
}
function kgToLbs(kg: number) { return Math.round(kg * 2.204); }
function ftInToCm(ft: number, inches: number) { return Math.round((ft * 12 + inches) * 2.54); }
function lbsToKg(lbs: number) { return Math.round(lbs * 0.4536 * 10) / 10; }

export default function Profile() {
  const { currentUser, setCurrentUser, logout } = useApp();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editFt, setEditFt] = useState("5");
  const [editIn, setEditIn] = useState("10");
  const [editLbs, setEditLbs] = useState("165");
  const [editGoals, setEditGoals] = useState<string[]>([]);

  const { data: history = [], isLoading: histLoading } = useQuery<WorkoutHistory[]>({
    queryKey: ["/api/users", currentUser?.id, "workout-history"],
    queryFn: async () => {
      const data = await apiRequest("GET", `/api/users/${currentUser?.id}/workout-history`);
      localCache.saveWorkoutHistory(data);
      return data;
    },
    enabled: !!currentUser?.id,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: any) => apiRequest("PATCH", `/api/users/${currentUser?.id}`, updates),
    onSuccess: (updated) => {
      setCurrentUser(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id] });
      setEditing(false);
      toast({ title: "Profile updated!" });
    },
    onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
  });

  const startEdit = () => {
    if (!currentUser) return;
    setEditName(currentUser.displayName);
    const goals: string[] = JSON.parse(currentUser.goals || "[]");
    setEditGoals(goals);
    if (currentUser.heightCm) {
      const { ft, inches } = cmToFtIn(currentUser.heightCm);
      setEditFt(String(ft));
      setEditIn(String(inches));
    }
    if (currentUser.weightKg) setEditLbs(String(kgToLbs(currentUser.weightKg)));
    setEditing(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      displayName: editName,
      heightCm: ftInToCm(parseInt(editFt), parseInt(editIn)),
      weightKg: lbsToKg(parseFloat(editLbs)),
      goals: JSON.stringify(editGoals),
    });
  };

  if (!currentUser) return null;

  const goals: string[] = JSON.parse(currentUser.goals || "[]");
  const totalVolume = history.reduce((s, h) => s + (h.totalVolume || 0), 0);
  const totalTime = history.reduce((s, h) => s + (h.duration || 0), 0);
  const totalSets = history.length * 12; // Approximate

  // Muscle breakdown
  const muscleCounts: Record<string, number> = {};
  const muscleLastTrained: Record<string, Date> = {};
  for (const h of history) {
    const muscles: string[] = JSON.parse(h.musclesWorked || "[]");
    const date = new Date(h.completedAt);
    for (const m of muscles) {
      muscleCounts[m] = (muscleCounts[m] || 0) + 1;
      if (!muscleLastTrained[m] || date > muscleLastTrained[m]) muscleLastTrained[m] = date;
    }
  }
  const muscleEntries = Object.entries(muscleCounts).sort(([, a], [, b]) => b - a);
  const maxCount = Math.max(...Object.values(muscleCounts), 1);

  const daysSince = (m: string) => {
    if (!muscleLastTrained[m]) return null;
    return Math.floor((Date.now() - muscleLastTrained[m].getTime()) / (1000 * 60 * 60 * 24));
  };

  const { ft, inches } = currentUser.heightCm ? cmToFtIn(currentUser.heightCm) : { ft: 0, inches: 0 };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Profile</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Your fitness identity</p>
        </div>
        <button
          data-testid="button-edit-profile"
          onClick={editing ? saveEdit : startEdit}
          disabled={updateMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
        >
          {editing ? <><Check className="w-3.5 h-3.5" />Save</> : <><Edit2 className="w-3.5 h-3.5" />Edit</>}
        </button>
      </header>

      <div className="px-4 space-y-4">
        {/* Avatar + Name */}
        <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
          <div className="w-16 h-16 bg-primary/15 rounded-2xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-primary">{currentUser.displayName[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input
                data-testid="input-display-name"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="bg-background mb-1 font-bold"
              />
            ) : (
              <div className="font-bold text-lg truncate" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{currentUser.displayName}</div>
            )}
            <div className="text-sm text-muted-foreground">@{currentUser.username}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Member since {new Date(currentUser.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
          </div>
        </div>

        {/* Stats */}
        {editing ? (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div className="text-sm font-semibold">Body Measurements</div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Height</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input type="number" value={editFt} onChange={e => setEditFt(e.target.value)} className="bg-background text-center" />
                  <p className="text-xs text-center text-muted-foreground mt-1">ft</p>
                </div>
                <div className="flex-1">
                  <Input type="number" value={editIn} onChange={e => setEditIn(e.target.value)} className="bg-background text-center" />
                  <p className="text-xs text-center text-muted-foreground mt-1">in</p>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Weight (lbs)</label>
              <Input type="number" value={editLbs} onChange={e => setEditLbs(e.target.value)} className="bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Goals</label>
              <div className="flex flex-wrap gap-2">
                {GOALS.map(g => {
                  const sel = editGoals.includes(g);
                  return (
                    <button
                      key={g}
                      onClick={() => setEditGoals(prev => sel ? prev.filter(x => x !== g) : [...prev, g])}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                        sel ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: "Height", value: currentUser.heightCm ? `${ft}'${inches}"` : "—" },
                { label: "Weight", value: currentUser.weightKg ? `${kgToLbs(currentUser.weightKg)} lbs` : "—" },
                { label: "Workouts", value: String(history.length) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-secondary/60 rounded-xl p-3 text-center">
                  <div className="font-bold text-base" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            {goals.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><Target className="w-3 h-3" />Goals</div>
                <div className="flex flex-wrap gap-2">
                  {goals.map(g => (
                    <span key={g} className="px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">{g}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Performance Summary */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="text-sm font-semibold mb-3">Performance Summary</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Volume", value: totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : String(Math.round(totalVolume)), unit: "lbs", icon: TrendingUp },
              { label: "Total Time", value: String(Math.floor(totalTime / 60)), unit: "min", icon: Clock },
              { label: "Total Sets", value: String(totalSets), unit: "sets", icon: Dumbbell },
            ].map(({ label, value, unit, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon className="w-4 h-4 text-primary mx-auto mb-1" />
                <div className="font-bold text-base" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                <div className="text-[9px] text-muted-foreground">{unit}</div>
                <div className="text-[9px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Log Out */}
        <Button
          variant="outline"
          className="w-full border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={() => { logout(); }}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Log Out
        </Button>

        {/* Muscle Breakdown */}
        {muscleEntries.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="text-sm font-semibold mb-3">Muscle Breakdown</div>
            <div className="space-y-3">
              {muscleEntries.slice(0, 8).map(([muscle, count]) => {
                const days = daysSince(muscle);
                return (
                  <div key={muscle}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground font-medium">{muscle}</span>
                      <span className="text-foreground/60">
                        {days !== null ? `${days}d ago` : "never"}
                      </span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / maxCount) * 100}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
