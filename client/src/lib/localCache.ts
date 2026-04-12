/**
 * Local cache layer — stores all user data to localStorage so the app
 * can fully restore after a server restart (SQLite data loss).
 */

const PREFIX = "fitsync_cache_";

function setItem(key: string, data: any) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    // localStorage full — silently ignore
  }
}

function getItem<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return null;
}

function removeItem(key: string) {
  localStorage.removeItem(PREFIX + key);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const localCache = {
  // Friends list (User[])
  saveFriends(friends: any[]) {
    setItem("friends", friends);
  },
  getFriends(): any[] {
    return getItem<any[]>("friends") || [];
  },

  // Workout history (WorkoutHistory[])
  saveWorkoutHistory(history: any[]) {
    setItem("workout_history", history);
  },
  getWorkoutHistory(): any[] {
    return getItem<any[]>("workout_history") || [];
  },

  // Workout plans (WorkoutPlan[])
  saveWorkoutPlans(plans: any[]) {
    setItem("workout_plans", plans);
  },
  getWorkoutPlans(): any[] {
    return getItem<any[]>("workout_plans") || [];
  },

  // Custom exercises (device-local, merged with server exercises)
  getCustomExercises(): any[] {
    return getItem<any[]>("custom_exercises") || [];
  },
  saveCustomExercise(ex: { id: string; name: string; primaryMuscle: string; equipment: string; isCustom: boolean }) {
    const all = this.getCustomExercises();
    all.unshift(ex);
    setItem("custom_exercises", all);
  },
  deleteCustomExercise(id: string) {
    setItem("custom_exercises", this.getCustomExercises().filter((e: any) => e.id !== id));
  },

  // Workout templates (device-local)
  saveTemplate(template: { id: string; name: string; exercises: any[]; goal: string; restBetweenSets: number; savedAt: string }) {
    const all = this.getTemplates();
    const idx = all.findIndex((t: any) => t.id === template.id);
    if (idx >= 0) all[idx] = template;
    else all.unshift(template);
    setItem("templates", all.slice(0, 10)); // keep last 10
  },
  getTemplates(): any[] {
    return getItem<any[]>("templates") || [];
  },
  deleteTemplate(id: string) {
    setItem("templates", this.getTemplates().filter((t: any) => t.id !== id));
  },

  // Clear everything (on logout)
  clearAll() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  },

  // Get full restore payload for POST /api/restore
  getRestorePayload(user: any) {
    return {
      user,
      friends: this.getFriends(),
      workoutHistory: this.getWorkoutHistory(),
      workoutPlans: this.getWorkoutPlans(),
    };
  },
};
