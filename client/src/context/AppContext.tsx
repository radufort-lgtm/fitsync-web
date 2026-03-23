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
}

const AppContext = createContext<AppContextValue | null>(null);

function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();

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
      // Register for notifications
      ws.send(JSON.stringify({ type: "register", username: currentUser.username }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "friend-request") {
          toast({ title: "Friend Request", description: `@${msg.fromUsername} wants to be friends` });
          refreshNotifications();
          queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "friend-requests"] });
        }

        if (msg.type === "friend-accepted") {
          toast({ title: "Friend Accepted", description: `@${msg.username} accepted your request` });
          refreshNotifications();
          queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "friends"] });
          queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.id, "friend-requests-sent"] });
        }

        if (msg.type === "workout-invite") {
          toast({ title: "Workout Invite", description: `@${msg.fromUsername} invited you to ${msg.planName}` });
          refreshNotifications();
          queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser.username, "workout-invites"] });
        }

        if (msg.type === "invite-accepted") {
          toast({ title: "Invite Accepted", description: `@${msg.username} joined your workout` });
          queryClient.invalidateQueries({ queryKey: ["/api/workout-sessions", msg.sessionId, "invites"] });
        }

        if (msg.type === "invite-declined") {
          toast({ title: "Invite Declined", description: `@${msg.username} declined your workout invite` });
          queryClient.invalidateQueries({ queryKey: ["/api/workout-sessions", msg.sessionId, "invites"] });
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    ws.onerror = () => {};

    // Fetch initial unread count
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
