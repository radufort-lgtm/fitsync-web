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
