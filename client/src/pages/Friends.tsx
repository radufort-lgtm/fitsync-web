import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { localCache } from "@/lib/localCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, UserMinus, Share2, Users, Check, X, Clock, Send } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import type { User, FriendRequest } from "@shared/schema";

export default function Friends() {
  const { currentUser, refreshNotifications } = useApp();
  const { toast } = useToast();
  const [newUsername, setNewUsername] = useState("");

  // Accepted friends
  const { data: friends = [], isLoading: friendsLoading } = useQuery<User[]>({
    queryKey: ["/api/users", currentUser?.id, "friends"],
    queryFn: async () => {
      const data = await apiRequest("GET", `/api/users/${currentUser?.id}/friends`);
      localCache.saveFriends(data);
      return data;
    },
    enabled: !!currentUser?.id,
  });

  // Pending incoming requests
  const { data: incomingRequests = [], isLoading: incomingLoading } = useQuery<(FriendRequest & { fromUser?: User })[]>({
    queryKey: ["/api/users", currentUser?.id, "friend-requests"],
    queryFn: () => apiRequest("GET", `/api/users/${currentUser?.id}/friend-requests`),
    enabled: !!currentUser?.id,
    refetchInterval: 5000,
  });

  // Sent outgoing requests
  const { data: sentRequests = [] } = useQuery<(FriendRequest & { toUser?: User })[]>({
    queryKey: ["/api/users", currentUser?.id, "friend-requests-sent"],
    queryFn: () => apiRequest("GET", `/api/users/${currentUser?.id}/friend-requests/sent`),
    enabled: !!currentUser?.id,
    refetchInterval: 10000,
  });

  // Send friend request
  const sendRequestMutation = useMutation({
    mutationFn: (toUsername: string) =>
      apiRequest("POST", "/api/friend-requests", {
        fromUserId: currentUser?.id,
        toUsername,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friend-requests-sent"] });
      setNewUsername("");
      toast({ title: "Friend request sent" });
    },
    onError: (e: any) => {
      toast({ title: e.message || "Failed to send request", variant: "destructive" });
    },
  });

  // Accept friend request
  const acceptMutation = useMutation({
    mutationFn: (requestId: number) =>
      apiRequest("PATCH", `/api/friend-requests/${requestId}`, { status: "accepted" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friend-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friends"] });
      refreshNotifications();
      toast({ title: "Friend request accepted" });
    },
  });

  // Decline friend request
  const declineMutation = useMutation({
    mutationFn: (requestId: number) =>
      apiRequest("PATCH", `/api/friend-requests/${requestId}`, { status: "declined" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friend-requests"] });
      refreshNotifications();
      toast({ title: "Friend request declined" });
    },
  });

  // Remove friend
  const removeMutation = useMutation({
    mutationFn: async (friendUserId: number) => {
      return apiRequest("DELETE", `/api/friends/${currentUser?.id}/${friendUserId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friends"] });
      toast({ title: "Friend removed" });
    },
  });

  const handleSendRequest = () => {
    const u = newUsername.trim().toLowerCase();
    if (!u) return;
    if (u === currentUser?.username) {
      toast({ title: "You can't add yourself", variant: "destructive" });
      return;
    }
    sendRequestMutation.mutate(u);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Friends</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Train together</p>
        </div>
        <NotificationBell />
      </header>

      <div className="px-4 space-y-4">
        {/* Send friend request */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            Add Friend
          </div>
          <div className="flex gap-2">
            <Input
              data-testid="input-friend-username"
              placeholder="Enter username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              className="flex-1 bg-background"
              onKeyDown={e => e.key === "Enter" && handleSendRequest()}
            />
            <Button
              data-testid="button-send-request"
              onClick={handleSendRequest}
              disabled={sendRequestMutation.isPending || !newUsername.trim()}
              className="press-scale"
            >
              {sendRequestMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <><Send className="w-4 h-4 mr-1" /> Send</>
              )}
            </Button>
          </div>
        </div>

        {/* Share link */}
        <button
          data-testid="button-share-link"
          onClick={() => {
            const url = `${window.location.origin}${window.location.pathname}`;
            navigator.clipboard.writeText(url).then(() => {
              toast({ title: "Link copied to clipboard!" });
            }).catch(() => {
              toast({ title: `Share this link: ${url}` });
            });
          }}
          className="w-full flex items-center gap-3 p-4 bg-card border border-border rounded-2xl text-left hover:border-primary/40 transition-colors press-scale"
        >
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Share2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="font-medium text-sm">Invite a friend</div>
            <div className="text-xs text-muted-foreground mt-0.5">Share the app link so they can sign up</div>
          </div>
        </button>

        {/* Pending incoming requests */}
        {incomingRequests.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Friend Requests</span>
              <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">{incomingRequests.length}</span>
            </div>
            <div className="space-y-2">
              <AnimatePresence>
                {incomingRequests.map((req, i) => (
                  <motion.div
                    key={req.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-card border border-primary/20 rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary font-bold">{req.fromUser?.displayName?.[0]?.toUpperCase() || "?"}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{req.fromUser?.displayName || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">@{req.fromUser?.username || "unknown"}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        data-testid={`accept-request-${req.id}`}
                        onClick={() => acceptMutation.mutate(req.id)}
                        disabled={acceptMutation.isPending}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        data-testid={`decline-request-${req.id}`}
                        onClick={() => declineMutation.mutate(req.id)}
                        disabled={declineMutation.isPending}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Sent requests */}
        {sentRequests.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Sent Requests</span>
            </div>
            <div className="space-y-2">
              {sentRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-card border border-border rounded-xl p-3 flex items-center gap-3"
                >
                  <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-muted-foreground font-bold">{req.toUser?.displayName?.[0]?.toUpperCase() || "?"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{req.toUser?.displayName || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">@{req.toUser?.username || "unknown"}</div>
                  </div>
                  <span className="text-xs px-2 py-1 bg-secondary rounded-full text-muted-foreground">Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends list */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Your Friends</span>
            {friends.length > 0 && (
              <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">{friends.length}</span>
            )}
          </div>

          {friendsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : friends.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-8 text-center">
              <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Users className="w-7 h-7 text-primary" />
              </div>
              <div className="font-semibold mb-1">No friends yet</div>
              <p className="text-sm text-muted-foreground">Send a friend request to start training together.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {friends.map((f, i) => (
                  <motion.div
                    key={f.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-card border border-border rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary font-bold">{f.displayName[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{f.displayName}</div>
                      <div className="text-xs text-muted-foreground">@{f.username}</div>
                    </div>
                    <button
                      data-testid={`remove-friend-${f.username}`}
                      onClick={() => removeMutation.mutate(f.id)}
                      disabled={removeMutation.isPending}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
