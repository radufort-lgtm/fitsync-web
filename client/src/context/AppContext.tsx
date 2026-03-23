import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import type { User, Notification as AppNotification } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  breakDuration?: number;
  rotationCount?: number;
}

interface PendingInvite {
  inviteId: number;
  sessionId: number;
  fromUsername: string;
  planName: string;
}

interface AppContextValue {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  activeWorkout: ActiveWorkout | null;
  setActiveWorkout: (workout: ActiveWorkout | null) => void;
  isDark: boolean;
  toggleDark: () => void;
  unreadCount: number;
  refreshNotifications: () => void;
  pendingInvite: PendingInvite | null;
  setPendingInvite: (invite: PendingInvite | null) => void;
  wsConnected: boolean;
  logout: () => void;
  authLoading: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

// Persist / restore user from localStorage
const STORAGE_KEY = "fitsync_user";

function saveUserToStorage(user: User | null) {
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function loadUserFromStorage(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserRaw] = useState<User | null>(loadUserFromStorage());
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [authLoading, setAuthLoading] = useState(!!loadUserFromStorage()); // true if we need to validate
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();

  // Wrapped setter that also persists
  const setCurrentUser = useCallback((user: User | null) => {
    setCurrentUserRaw(user);
    saveUserToStorage(user);
  }, []);

  const logout = useCallback(() => {
    setCurrentUserRaw(null);
    saveUserToStorage(null);
    setActiveWorkout(null);
  }, []);

  // On mount, if we have a cached user, re-fetch from server to confirm they still exist
  useEffect(() => {
    const cached = loadUserFromStorage();
    if (!cached) { setAuthLoading(false); return; }

    apiRequest("GET", `/api/users/${cached.id}`)
      .then((freshUser: User) => {
        setCurrentUserRaw(freshUser);
        saveUserToStorage(freshUser);
      })
      .catch(() => {
        // User no longer exists on this server, clear
        setCurrentUserRaw(null);
        saveUserToStorage(null);
      })
      .finally(() => setAuthLoading(false));
  }, []); // run once on mount

  // Apply dark class on mount
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

  const refreshNotifications = useCallback(async () => {
    if (!currentUser) return;
    try {
      const data = await apiRequest("GET", `/api/users/${currentUser.id}/notifications/unread-count`);
      setUnreadCount(data.count || 0);
    } catch {
      // ignore
    }
  }, [currentUser]);

  // Global WebSocket connection
  useEffect(() => {
    if (!currentUser) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setWsConnected(false);
      }
      return;
    }

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: "register", username: currentUser.username }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "friend-request") {
          toast({ title: "Friend Request", description: `@${msg.fromUsername} wants to be friends` });
          refreshNotifications();
        }

        if (msg.type === "friend-accepted") {
          toast({ title: "Friend Accepted", description: `@${msg.username} accepted your request` });
          refreshNotifications();
        }

        if (msg.type === "workout-invite") {
          toast({ title: "Workout Invite", description: `@${msg.fromUsername} invited you to ${msg.planName}` });
          refreshNotifications();
        }

        if (msg.type === "invite-accepted") {
          toast({ title: "Invite Accepted", description: `@${msg.username} joined your workout` });
        }

        if (msg.type === "invite-declined") {
          toast({ title: "Invite Declined", description: `@${msg.username} declined your workout invite` });
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    ws.onerror = () => {};

    refreshNotifications();

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppContext.Provider value={{
      currentUser,
      setCurrentUser,
      activeWorkout,
      setActiveWorkout,
      isDark,
      toggleDark,
      unreadCount,
      refreshNotifications,
      pendingInvite,
      setPendingInvite,
      wsConnected,
      logout,
      authLoading,
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
