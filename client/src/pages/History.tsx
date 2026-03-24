import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { apiRequest } from "@/lib/queryClient";
import { localCache } from "@/lib/localCache";
import { Skeleton } from "@/components/ui/skeleton";
import { Dumbbell, Clock, TrendingUp, ChevronDown, ChevronUp, Users, Brain } from "lucide-react";
import type { WorkoutHistory } from "@shared/schema";

const FILTERS = ["All", "This Week", "This Month"];

export default function History() {
  const { currentUser } = useApp();
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: history = [], isLoading } = useQuery<WorkoutHistory[]>({
    queryKey: ["/api/users", currentUser?.id, "workout-history"],
    queryFn: async () => {
      const data = await apiRequest("GET", `/api/users/${currentUser?.id}/workout-history`);
      localCache.saveWorkoutHistory(data);
      return data;
    },
    enabled: !!currentUser?.id,
  });

  const now = Date.now();
  const filtered = history.filter(h => {
    if (filter === "This Week") {
      return now - new Date(h.completedAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
    }
    if (filter === "This Month") {
      return now - new Date(h.completedAt).getTime() <= 30 * 24 * 60 * 60 * 1000;
    }
    return true;
  });

  const totalVolume = filtered.reduce((s, h) => s + (h.totalVolume || 0), 0);
  const avgDuration = filtered.length ? Math.floor(filtered.reduce((s, h) => s + (h.duration || 0), 0) / filtered.length) : 0;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    return `${m}m`;
  };
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const diff = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const formatVolume = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>History</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Your workout archive</p>
      </header>

      <div className="px-4 space-y-4">
        {/* Filter chips */}
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button
              key={f}
              data-testid={`filter-${f}`}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all press-scale ${
                filter === f ? "bg-primary/15 text-primary border border-primary/30" : "bg-card border border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Summary */}
        {!isLoading && filtered.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4 grid grid-cols-3 gap-3">
            {[
              { label: "Workouts", value: String(filtered.length), icon: Dumbbell },
              { label: "Total Volume", value: `${formatVolume(totalVolume)} lbs`, icon: TrendingUp },
              { label: "Avg Duration", value: formatTime(avgDuration), icon: Clock },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon className="w-4 h-4 text-primary mx-auto mb-1" />
                <div className="font-bold text-base" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>{value}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* History list */}
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Dumbbell className="w-7 h-7 text-primary" />
            </div>
            <div className="font-semibold mb-1">No workouts yet</div>
            <p className="text-sm text-muted-foreground">Complete a workout to see it here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((w, i) => {
              const muscles: string[] = JSON.parse(w.musclesWorked || "[]");
              const isExp = expanded === w.id;
              return (
                <motion.div
                  key={w.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-card border border-border rounded-2xl overflow-hidden"
                >
                  <button
                    data-testid={`workout-history-${w.id}`}
                    className="w-full p-4 text-left"
                    onClick={() => setExpanded(isExp ? null : w.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Dumbbell className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-sm truncate">{w.planName || "Workout"}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{formatDate(w.completedAt)}</span>
                            {isExp ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(w.duration)}</span>
                          <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{formatVolume(w.totalVolume)} lbs</span>
                          {w.wasShared && <span className="flex items-center gap-1"><Users className="w-3 h-3 text-chart-2" />Group</span>}
                        </div>
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {muscles.slice(0, 4).map(m => (
                            <span key={m} className="text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">{m}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExp && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-0 border-t border-border space-y-3">
                          {w.aiReasoning && (
                            <div className="bg-secondary/50 rounded-xl p-3 mt-3">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Brain className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs font-semibold text-primary uppercase tracking-wide">AI Reasoning</span>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{w.aiReasoning}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {[
                              { label: "Duration", value: formatTime(w.duration) },
                              { label: "Volume", value: `${formatVolume(w.totalVolume)} lbs` },
                              { label: "Participants", value: String(w.participantCount) },
                              { label: "Muscles", value: muscles.length ? muscles.join(", ") : "—" },
                            ].map(({ label, value }) => (
                              <div key={label} className="bg-background rounded-xl p-2.5">
                                <div className="text-[10px] text-muted-foreground">{label}</div>
                                <div className="text-sm font-semibold mt-0.5 truncate">{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
