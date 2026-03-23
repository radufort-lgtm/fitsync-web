import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Bell, UserPlus, Dumbbell, UserCheck, Check, X } from "lucide-react";
import type { Notification as AppNotification } from "@shared/schema";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell() {
  const { currentUser, unreadCount, refreshNotifications, setPendingInvite, setActiveWorkout } = useApp();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery<AppNotification[]>({
    queryKey: ["/api/users", currentUser?.id, "notifications"],
    queryFn: () => apiRequest("GET", `/api/users/${currentUser?.id}/notifications`),
    enabled: !!currentUser?.id && open,
    refetchInterval: open ? 5000 : false,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/users/${currentUser?.id}/notifications/read-all`),
    onSuccess: () => {
      refreshNotifications();
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "notifications"] });
    },
  });

  const acceptFriendMutation = useMutation({
    mutationFn: (requestId: number) =>
      apiRequest("PATCH", `/api/friend-requests/${requestId}`, { status: "accepted" }),
    onSuccess: () => {
      toast({ title: "Friend request accepted" });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friend-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "notifications"] });
      refreshNotifications();
    },
  });

  const declineFriendMutation = useMutation({
    mutationFn: (requestId: number) =>
      apiRequest("PATCH", `/api/friend-requests/${requestId}`, { status: "declined" }),
    onSuccess: () => {
      toast({ title: "Friend request declined" });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friend-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "notifications"] });
      refreshNotifications();
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      const invite = await apiRequest("PATCH", `/api/workout-invites/${inviteId}`, { status: "accepted" });
      return invite;
    },
    onSuccess: async (invite: any) => {
      toast({ title: "Workout invite accepted" });
      // Fetch session and plan data, then navigate
      try {
        const session = await apiRequest("GET", `/api/workout-sessions/${invite.sessionId}`);
        const plan = await apiRequest("GET", `/api/workout-plans/${session.planId}`);
        setActiveWorkout({
          sessionId: session.id,
          planId: session.planId,
          planName: plan.name,
          exercises: JSON.parse(plan.exercises || "[]"),
          creatorUsername: session.creatorUsername,
          isShared: true,
          participantUsernames: JSON.parse(session.participantUsernames || "[]"),
          restBetweenSets: plan.restBetweenSets,
          aiReasoning: plan.aiReasoning,
        });
        setOpen(false);
        navigate("/workout/active");
      } catch (e) {
        toast({ title: "Failed to join workout", variant: "destructive" });
      }
      refreshNotifications();
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: (inviteId: number) =>
      apiRequest("PATCH", `/api/workout-invites/${inviteId}`, { status: "declined" }),
    onSuccess: () => {
      toast({ title: "Workout invite declined" });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "notifications"] });
      refreshNotifications();
    },
  });

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      markAllReadMutation.mutate();
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "friend_request": return <UserPlus className="w-4 h-4 text-primary" />;
      case "friend_accepted": return <UserCheck className="w-4 h-4 text-green-400" />;
      case "workout_invite": return <Dumbbell className="w-4 h-4 text-primary" />;
      default: return <Bell className="w-4 h-4 text-muted-foreground" />;
    }
  };

  if (!currentUser) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <button
          data-testid="button-notifications"
          className="relative w-9 h-9 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors press-scale"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="bg-background border-border rounded-t-3xl max-h-[70vh]">
        <SheetHeader className="pb-3">
          <SheetTitle className="text-left" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
            Notifications
          </SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto max-h-[55vh] space-y-2 pb-4">
          {notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <AnimatePresence>
              {notifications.map((notif, i) => (
                <motion.div
                  key={notif.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`p-3 rounded-xl border ${
                    !notif.isRead ? "bg-primary/5 border-primary/20" : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                      {getIcon(notif.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{notif.title}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeAgo(notif.createdAt)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{notif.body}</p>

                      {/* Action buttons for friend requests */}
                      {notif.type === "friend_request" && notif.relatedId && (
                        <div className="flex gap-2 mt-2">
                          <Button
                            data-testid={`accept-friend-${notif.relatedId}`}
                            size="sm"
                            onClick={() => acceptFriendMutation.mutate(notif.relatedId!)}
                            disabled={acceptFriendMutation.isPending}
                            className="h-7 text-xs px-3"
                          >
                            <Check className="w-3 h-3 mr-1" /> Accept
                          </Button>
                          <Button
                            data-testid={`decline-friend-${notif.relatedId}`}
                            size="sm"
                            variant="outline"
                            onClick={() => declineFriendMutation.mutate(notif.relatedId!)}
                            disabled={declineFriendMutation.isPending}
                            className="h-7 text-xs px-3"
                          >
                            <X className="w-3 h-3 mr-1" /> Decline
                          </Button>
                        </div>
                      )}

                      {/* Action buttons for workout invites */}
                      {notif.type === "workout_invite" && notif.relatedId && (
                        <div className="flex gap-2 mt-2">
                          <Button
                            data-testid={`accept-invite-${notif.relatedId}`}
                            size="sm"
                            onClick={() => acceptInviteMutation.mutate(notif.relatedId!)}
                            disabled={acceptInviteMutation.isPending}
                            className="h-7 text-xs px-3"
                          >
                            <Check className="w-3 h-3 mr-1" /> Join
                          </Button>
                          <Button
                            data-testid={`decline-invite-${notif.relatedId}`}
                            size="sm"
                            variant="outline"
                            onClick={() => declineInviteMutation.mutate(notif.relatedId!)}
                            disabled={declineInviteMutation.isPending}
                            className="h-7 text-xs px-3"
                          >
                            <X className="w-3 h-3 mr-1" /> Decline
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
