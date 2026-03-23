import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Trash2, Share2, Users } from "lucide-react";
import type { Friend } from "@shared/schema";

export default function Friends() {
  const { currentUser } = useApp();
  const { toast } = useToast();
  const [newUsername, setNewUsername] = useState("");

  const { data: friends = [], isLoading } = useQuery<Friend[]>({
    queryKey: ["/api/users", currentUser?.id, "friends"],
    queryFn: () => apiRequest("GET", `/api/users/${currentUser?.id}/friends`),
    enabled: !!currentUser?.id,
  });

  const addMutation = useMutation({
    mutationFn: async (username: string) => {
      // Try to find user info
      let displayName = username;
      try {
        const user = await apiRequest("GET", `/api/users/by-username/${username}`);
        displayName = user.displayName || username;
      } catch {}

      return apiRequest("POST", `/api/users/${currentUser?.id}/friends`, {
        userId: currentUser?.id,
        friendUsername: username,
        friendDisplayName: displayName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friends"] });
      setNewUsername("");
      toast({ title: "Friend added!" });
    },
    onError: (e: any) => {
      toast({ title: e.message || "Failed to add friend", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (username: string) =>
      apiRequest("DELETE", `/api/users/${currentUser?.id}/friends/${username}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", currentUser?.id, "friends"] });
      toast({ title: "Friend removed" });
    },
  });

  const handleAdd = () => {
    const u = newUsername.trim().toLowerCase();
    if (!u) return;
    if (u === currentUser?.username) {
      toast({ title: "You can't add yourself", variant: "destructive" });
      return;
    }
    if (friends.some(f => f.friendUsername === u)) {
      toast({ title: "Already in your friends list", variant: "destructive" });
      return;
    }
    addMutation.mutate(u);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>Friends</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Train together</p>
      </header>

      <div className="px-4 space-y-4">
        {/* Add friend */}
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
              onKeyDown={e => e.key === "Enter" && handleAdd()}
            />
            <Button
              data-testid="button-add-friend"
              onClick={handleAdd}
              disabled={addMutation.isPending || !newUsername.trim()}
              className="press-scale"
            >
              {addMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                "Add"
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
            <div className="text-xs text-muted-foreground mt-0.5">Share the app link</div>
          </div>
        </button>

        {/* Friends list */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Your Friends</span>
            {friends.length > 0 && (
              <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">{friends.length}</span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : friends.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-8 text-center">
              <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Users className="w-7 h-7 text-primary" />
              </div>
              <div className="font-semibold mb-1">No friends yet</div>
              <p className="text-sm text-muted-foreground">Add friends to train together.</p>
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
                      <span className="text-primary font-bold">{f.friendDisplayName[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{f.friendDisplayName}</div>
                      <div className="text-xs text-muted-foreground">@{f.friendUsername}</div>
                    </div>
                    <button
                      data-testid={`remove-friend-${f.friendUsername}`}
                      onClick={() => removeMutation.mutate(f.friendUsername)}
                      disabled={removeMutation.isPending}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
