import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "@shared/schema";

interface ActiveWorkout {
  sessionId: number;
  planId: number;
  planName: string;
  exercises: any[];
  creatorUsername: string;
  isShared: boolean;
  participantUsernames: string[];
  restBetweenSets: number;
  aiReasoning: string;
}

interface AppContextValue {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  activeWorkout: ActiveWorkout | null;
  setActiveWorkout: (workout: ActiveWorkout | null) => void;
  isDark: boolean;
  toggleDark: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);
  const [isDark, setIsDark] = useState(true);

  // Apply dark class on mount — dark is default for FitSync
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", isDark);
  }

  const toggleDark = () => {
    setIsDark(prev => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      setCurrentUser,
      activeWorkout,
      setActiveWorkout,
      isDark,
      toggleDark,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
