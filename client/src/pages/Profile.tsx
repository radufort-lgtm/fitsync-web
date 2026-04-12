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
import { Edit2, Check, Dumbbell, Clock, TrendingUp, Target, LogOut, CalendarDays, Plus, Trash2, Library } from "lucide-react";
import type { WorkoutHistory } from "@shared/schema";

const GOALS = ["Strength", "Muscle Gain", "Fat Loss", "Performance", "General Fitness", "Flexibility"];

function buildActivityCalendar(history: WorkoutHistory[]) {
  const dayMap: Record<string, number> = {};
  for (const h of history) {
    const d = new Date(h.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dayMap[key] = (dayMap[key] || 0) + 1;
  }
  // Build 15 weeks (today's week + 14 prior), each column = a week, rows = Mon-Sun
  const today = new Date();
  // Align to the start of this week (Monday)
  const dow = today.getDay(); // 0=Sun
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysSinceMonday);

  const weeks: { date: Date; count: number; isFuture: boolean }[][] = [];
  for (let w = 14; w >= 0; w--) {
    const week: { date: Date; count: number; isFuture: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(thisMonday);
      date.setDate(thisMonday.getDate() - w * 7 + d);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      week.push({ date, count: dayMap[key] || 0, isFuture: date > today });
    }
    weeks.push(week);
  }
  return weeks;
}

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
  const [customExercises, setCustomExercises] = useState<any[]>(() => localCache.getCustomExercises());
  const [showAddEx, setShowAddEx] = useState(false);
  const [newExName, setNewExName] = useState("");
  const [newExMuscle, setNewExMuscle] = useState("Chest");
  const [newExEquipment, setNewExEquipment] = useState("Barbell");

  const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Core", "Calves"];
  const EQUIPMENT_OPTIONS = ["Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight", "Kettlebell", "Resistance Band"];

  const addCustomExercise = () => {
    if (!newExName.trim()) return;
    const ex = {
      id: `custom_${Date.now()}`,
      name: newExName.trim(),
      primaryMuscle: newExMuscle,
      equipment: newExEquipment,
      isCustom: true,
    };
    localCache.saveCustomExercise(ex);
    setCustomExercises(localCache.getCustomExercises());
    setNewExName("");
    setShowAddEx(false);
    toast({ title: "Custom exercise added!" });
  };

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
  const favMuscle = muscleEntries[0]?.[0] || null;
  const activityCalendar = buildActivityCalendar(history);
  const totalSetsReal = history.reduce((s, h) => {
    try {
      const logs = JSON.parse(h.exerciseLogs || "[]");
      return s + logs.reduce((a: number, l: any) => a + (l.setsCompleted || 0), 0);
    } catch { return s; }
  }, 0);

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
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Workouts", value: String(history.length), unit: "total", icon: Dumbbell },
              { label: "Volume", value: totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : String(Math.round(totalVolume)), unit: "lbs", icon: TrendingUp },
              { label: "Time", value: String(Math.floor(totalTime / 60)), unit: "min", icon: Clock },
              { label: "Fav Muscle", value: favMuscle || "—", unit: "group", icon: Target },
            ].map(({ label, value, unit, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon className="w-4 h-4 text-primary mx-auto mb-1" />
                <div className="font-bold text-sm truncate" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                <div className="text-[9px] text-muted-foreground">{unit}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Calendar */}
        {history.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Activity</span>
              <span className="text-xs text-muted-foreground ml-auto">15 weeks</span>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {activityCalendar.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1 flex-shrink-0">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      title={day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      className={`w-3.5 h-3.5 rounded-sm transition-colors ${
                        day.isFuture ? "bg-border/20" :
                        day.count === 0 ? "bg-secondary" :
                        day.count === 1 ? "bg-primary/40" :
                        "bg-primary"
                      }`}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[10px] text-muted-foreground">Less</span>
              {["bg-secondary", "bg-primary/40", "bg-primary"].map((c, i) => (
                <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
              ))}
              <span className="text-[10px] text-muted-foreground">More</span>
            </div>
          </div>
        )}

        {/* Custom Exercise Library */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Library className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">My Exercises</span>
            </div>
            <button
              onClick={() => setShowAddEx(!showAddEx)}
              className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>

          {showAddEx && (
            <div className="bg-background rounded-xl p-3 mb-3 space-y-3 border border-border">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block">Exercise Name</label>
                <Input
                  placeholder="e.g. Incline Dumbbell Curl"
                  value={newExName}
                  onChange={e => setNewExName(e.target.value)}
                  className="bg-card h-9 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block">Muscle</label>
                  <select
                    value={newExMuscle}
                    onChange={e => setNewExMuscle(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-card text-sm px-2"
                  >
                    {MUSCLES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block">Equipment</label>
                  <select
                    value={newExEquipment}
                    onChange={e => setNewExEquipment(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-card text-sm px-2"
                  >
                    {EQUIPMENT_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              </div>
              <Button onClick={addCustomExercise} size="sm" className="w-full h-8">
                <Check className="w-3.5 h-3.5 mr-1" /> Save Exercise
              </Button>
            </div>
          )}

          {customExercises.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              No custom exercises yet. Add your own movements!
            </p>
          ) : (
            <div className="space-y-2">
              {customExercises.map((ex: any) => (
                <div key={ex.id} className="flex items-center gap-3 p-2 bg-secondary/50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{ex.name}</div>
                    <div className="text-[10px] text-muted-foreground">{ex.primaryMuscle} · {ex.equipment}</div>
                  </div>
                  <button
                    onClick={() => {
                      localCache.deleteCustomExercise(ex.id);
                      setCustomExercises(localCache.getCustomExercises());
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
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
