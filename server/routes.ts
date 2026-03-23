import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSchema, type PlannedExercise, type InsertExercise, type Exercise } from "@shared/schema";
import { z } from "zod";
import { sendToUser, broadcastToSession } from "./websocket";
import { SEED_EXERCISES } from "./exercises";

// ── AI Workout Generation ─────────────────────────────────────────────────────
async function generateWorkoutPlan(params: {
  userId: number;
  workoutTypes: string[];
  equipment: string[];
  goal: string;
  duration: number;
  intensity: string;
  restBetweenSets: number;
  participantUsernames?: string[];
}): Promise<{ exercises: PlannedExercise[]; name: string; aiReasoning: string }> {
  const allExercises = await storage.getAllExercises();
  const recentHistory = await storage.getRecentWorkouts(params.userId, 14);

  // Parse muscles worked recently
  const muscleVolume: Record<string, number> = {};
  const muscleLastTrained: Record<string, Date> = {};

  for (const h of recentHistory) {
    const muscles: string[] = JSON.parse(h.musclesWorked || "[]");
    const date = new Date(h.completedAt);
    for (const m of muscles) {
      muscleVolume[m] = (muscleVolume[m] || 0) + h.totalVolume / muscles.length;
      if (!muscleLastTrained[m] || date > muscleLastTrained[m]) {
        muscleLastTrained[m] = date;
      }
    }
  }

  // Find neglected muscles
  const allMuscles = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Core", "Calves"];
  const neglectedMuscles = allMuscles.filter(m => {
    const lastTrained = muscleLastTrained[m];
    if (!lastTrained) return true;
    const daysSince = (Date.now() - lastTrained.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= 3;
  });

  // Filter exercises by workout type and equipment
  let filteredExercises = allExercises.filter(ex => {
    const exTypes: string[] = JSON.parse(ex.workoutTypes || "[]");
    const exEquip: string[] = JSON.parse(ex.equipment || "[]");
    const typeMatch = params.workoutTypes.some(t => exTypes.includes(t));
    const equipMatch = exEquip.length === 0 || params.equipment.length === 0 ||
      exEquip.some(e => params.equipment.includes(e));
    return typeMatch && equipMatch;
  });

  if (filteredExercises.length === 0) filteredExercises = allExercises;

  // Determine sets/reps based on goal
  const goalParams: Record<string, { sets: number; reps: number }> = {
    "Strength": { sets: 4, reps: 5 },
    "Muscle Gain": { sets: 3, reps: 10 },
    "Fat Loss": { sets: 3, reps: 13 },
    "Performance": { sets: 3, reps: 8 },
    "General Fitness": { sets: 3, reps: 10 },
  };
  const { sets, reps } = goalParams[params.goal] || { sets: 3, reps: 10 };

  // Determine number of exercises based on duration
  const exerciseCount = Math.floor(params.duration / (sets * 3)); // ~3 min per set
  const targetCount = Math.min(Math.max(exerciseCount, 4), 10);

  // Sort: compound first, then by neglected muscle priority
  const sorted = filteredExercises.sort((a, b) => {
    const aNeglected = neglectedMuscles.includes(a.primaryMuscle) ? 1 : 0;
    const bNeglected = neglectedMuscles.includes(b.primaryMuscle) ? 1 : 0;
    const aCompound = a.isCompound ? 1 : 0;
    const bCompound = b.isCompound ? 1 : 0;
    return (bNeglected + bCompound) - (aNeglected + aCompound);
  });

  // Pick diverse exercises (max 2 per muscle group)
  const muscleCounts: Record<string, number> = {};
  const selected: Exercise[] = [];
  for (const ex of sorted) {
    if (selected.length >= targetCount) break;
    const count = muscleCounts[ex.primaryMuscle] || 0;
    if (count < 2) {
      selected.push(ex);
      muscleCounts[ex.primaryMuscle] = count + 1;
    }
  }

  const plannedExercises: PlannedExercise[] = selected.map(ex => ({
    exerciseId: ex.id,
    exerciseName: ex.name,
    primaryMuscle: ex.primaryMuscle,
    sets,
    reps,
    weight: 0,
    restSeconds: params.restBetweenSets,
  }));

  // Generate workout name
  const intensityWords: Record<string, string> = {
    "Light": "Active Recovery",
    "Moderate": "Balanced",
    "Intense": "Power",
    "Extreme": "Elite",
  };
  const primaryMusclesList = Array.from(new Set(selected.slice(0, 3).map(e => e.primaryMuscle)));
  const workoutName = `${intensityWords[params.intensity] || "Power"} ${primaryMusclesList.join(" & ")} Workout`;

  // Generate AI reasoning
  const neglectedStr = neglectedMuscles.slice(0, 3).join(", ") || "all muscle groups";
  const pushVolume = muscleVolume["Chest"] || 0;
  const pullVolume = muscleVolume["Back"] || 0;
  const ratioProblem = pushVolume > pullVolume * 1.3 ? " Your pushing volume is ahead of pulling — I've added extra back work." :
    pullVolume > pushVolume * 1.3 ? " Your pulling volume is ahead — I've balanced with more chest work." : "";

  const aiReasoning = `Based on your last ${recentHistory.length} workouts, I've targeted ${neglectedStr} — muscles that need attention.${ratioProblem} This ${params.goal.toLowerCase()} focus uses ${sets} sets × ${reps} reps with ${params.restBetweenSets}s rest, optimized for ${params.intensity.toLowerCase()} intensity. The compound movements lead the session for maximum stimulus, followed by isolation work.`;

  return {
    exercises: plannedExercises,
    name: workoutName,
    aiReasoning,
  };
}

// ── Register Routes ───────────────────────────────────────────────────────────
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Seed exercises on startup
  const exerciseCount = await storage.getExerciseCount();
  if (exerciseCount === 0) {
    await storage.seedExercises(SEED_EXERCISES);
    console.log(`✅ Seeded ${SEED_EXERCISES.length} exercises`);
  }

  // ── Auth / Login ──────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: "Phone number is required" });

      // Normalize phone: strip everything except digits
      const normalized = phone.replace(/\D/g, "");
      if (normalized.length < 7) return res.status(400).json({ error: "Invalid phone number" });

      const user = await storage.getUserByPhone(normalized);
      if (!user) return res.status(404).json({ error: "No account found with that phone number" });

      return res.json(user);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  app.post("/api/users", async (req, res) => {
    try {
      const body = insertUserSchema.parse(req.body);
      const existing = await storage.getUserByUsername(body.username);
      if (existing) {
        return res.status(409).json({ error: "Username already taken" });
      }
      const user = await storage.createUser(body);
      return res.json(user);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  });

  app.get("/api/users/by-username/:username", async (req, res) => {
    const user = await storage.getUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  });

  app.patch("/api/users/:id", async (req, res) => {
    try {
      const user = await storage.updateUser(Number(req.params.id), req.body);
      if (!user) return res.status(404).json({ error: "User not found" });
      return res.json(user);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ── Friend Requests ────────────────────────────────────────────────────────
  // Send a friend request
  app.post("/api/friend-requests", async (req, res) => {
    try {
      const { fromUserId, toUsername } = req.body;
      if (!fromUserId || !toUsername) return res.status(400).json({ error: "Missing fromUserId or toUsername" });

      const toUser = await storage.getUserByUsername(toUsername);
      if (!toUser) return res.status(404).json({ error: "User not found" });

      const fromUser = await storage.getUser(fromUserId);
      if (!fromUser) return res.status(404).json({ error: "Sender not found" });

      if (fromUserId === toUser.id) return res.status(400).json({ error: "You can't friend yourself" });

      // Check for existing request in either direction
      const existing = await storage.findExistingFriendRequest(fromUserId, toUser.id);
      if (existing) {
        if (existing.status === "accepted") return res.status(409).json({ error: "Already friends" });
        if (existing.status === "pending") return res.status(409).json({ error: "Request already pending" });
        // If declined, allow re-request by creating new one
      }

      const request = await storage.createFriendRequest(fromUserId, toUser.id);

      // Create notification for recipient
      await storage.createNotification({
        userId: toUser.id,
        type: "friend_request",
        title: "Friend Request",
        body: `${fromUser.displayName} (@${fromUser.username}) wants to be friends`,
        relatedId: request.id,
        isRead: false,
      });

      // Push via WebSocket
      sendToUser(toUsername, {
        type: "friend-request",
        fromUsername: fromUser.username,
        fromDisplayName: fromUser.displayName,
        requestId: request.id,
      });

      return res.json(request);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Get pending incoming friend requests
  app.get("/api/users/:userId/friend-requests", async (req, res) => {
    const requests = await storage.getPendingFriendRequests(Number(req.params.userId));
    return res.json(requests);
  });

  // Get sent (outgoing) friend requests
  app.get("/api/users/:userId/friend-requests/sent", async (req, res) => {
    const requests = await storage.getSentFriendRequests(Number(req.params.userId));
    return res.json(requests);
  });

  // Get accepted friends (returns User[])
  app.get("/api/users/:userId/friends", async (req, res) => {
    const friends = await storage.getAcceptedFriends(Number(req.params.userId));
    return res.json(friends);
  });

  // Accept or decline a friend request
  app.patch("/api/friend-requests/:id", async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ error: "Status must be 'accepted' or 'declined'" });
      }

      const request = await storage.updateFriendRequest(Number(req.params.id), status);
      if (!request) return res.status(404).json({ error: "Request not found" });

      if (status === "accepted") {
        // Notify the original sender
        const fromUser = await storage.getUser(request.fromUserId);
        const toUser = await storage.getUser(request.toUserId);
        if (fromUser && toUser) {
          await storage.createNotification({
            userId: request.fromUserId,
            type: "friend_accepted",
            title: "Friend Request Accepted",
            body: `${toUser.displayName} (@${toUser.username}) accepted your friend request`,
            relatedId: request.id,
            isRead: false,
          });

          sendToUser(fromUser.username, {
            type: "friend-accepted",
            username: toUser.username,
            displayName: toUser.displayName,
          });
        }
      }

      return res.json(request);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Remove a friend (delete the request)
  app.delete("/api/friend-requests/:id", async (req, res) => {
    await storage.removeFriendRequest(Number(req.params.id));
    return res.json({ success: true });
  });

  // ── Workout Invites ────────────────────────────────────────────────────────
  // Send a workout invite
  app.post("/api/workout-invites", async (req, res) => {
    try {
      const { sessionId, fromUsername, toUsername } = req.body;
      if (!sessionId || !fromUsername || !toUsername) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const toUser = await storage.getUserByUsername(toUsername);
      if (!toUser) return res.status(404).json({ error: "User not found" });

      const session = await storage.getWorkoutSession(sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      const plan = await storage.getWorkoutPlan(session.planId);

      const invite = await storage.createWorkoutInvite({
        sessionId,
        fromUsername,
        toUsername,
        status: "pending",
      });

      // Create notification
      await storage.createNotification({
        userId: toUser.id,
        type: "workout_invite",
        title: "Workout Invite",
        body: `@${fromUsername} invited you to ${plan?.name || "a workout"}`,
        relatedId: invite.id,
        isRead: false,
      });

      // Push via WebSocket
      sendToUser(toUsername, {
        type: "workout-invite",
        sessionId,
        fromUsername,
        planName: plan?.name || "Workout",
        inviteId: invite.id,
      });

      return res.json(invite);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Get pending workout invites for a user
  app.get("/api/users/:username/workout-invites", async (req, res) => {
    const invites = await storage.getWorkoutInvitesForUser(req.params.username);
    return res.json(invites);
  });

  // Accept or decline a workout invite
  app.patch("/api/workout-invites/:id", async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ error: "Status must be 'accepted' or 'declined'" });
      }

      const invite = await storage.updateWorkoutInvite(Number(req.params.id), status);
      if (!invite) return res.status(404).json({ error: "Invite not found" });

      if (status === "accepted") {
        // Add participant to session
        const session = await storage.getWorkoutSession(invite.sessionId);
        if (session) {
          const participants: string[] = JSON.parse(session.participantUsernames || "[]");
          if (!participants.includes(invite.toUsername)) {
            participants.push(invite.toUsername);
            await storage.updateWorkoutSession(invite.sessionId, {
              participantUsernames: JSON.stringify(participants),
            } as any);
          }

          // Notify creator via WebSocket
          sendToUser(invite.fromUsername, {
            type: "invite-accepted",
            sessionId: invite.sessionId,
            username: invite.toUsername,
          });

          // Broadcast to session
          broadcastToSession(invite.sessionId, {
            type: "participant-joined",
            username: invite.toUsername,
          });
        }
      } else {
        // Notify creator of decline
        sendToUser(invite.fromUsername, {
          type: "invite-declined",
          sessionId: invite.sessionId,
          username: invite.toUsername,
        });
      }

      return res.json(invite);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Get invites for a session
  app.get("/api/workout-sessions/:sessionId/invites", async (req, res) => {
    const invites = await storage.getWorkoutInvitesBySession(Number(req.params.sessionId));
    return res.json(invites);
  });

  // ── Notifications ──────────────────────────────────────────────────────────
  app.get("/api/users/:userId/notifications", async (req, res) => {
    const notifs = await storage.getNotificationsForUser(Number(req.params.userId));
    return res.json(notifs);
  });

  app.get("/api/users/:userId/notifications/unread-count", async (req, res) => {
    const count = await storage.getUnreadNotificationCount(Number(req.params.userId));
    return res.json({ count });
  });

  app.patch("/api/notifications/:id/read", async (req, res) => {
    await storage.markNotificationRead(Number(req.params.id));
    return res.json({ success: true });
  });

  app.post("/api/users/:userId/notifications/read-all", async (req, res) => {
    await storage.markAllNotificationsRead(Number(req.params.userId));
    return res.json({ success: true });
  });

  // ── Exercises ──────────────────────────────────────────────────────────────
  app.get("/api/exercises", async (_req, res) => {
    const all = await storage.getAllExercises();
    return res.json(all);
  });

  // ── Workout Generation ─────────────────────────────────────────────────────
  app.post("/api/workouts/generate", async (req, res) => {
    try {
      const schema = z.object({
        userId: z.number(),
        workoutTypes: z.array(z.string()),
        equipment: z.array(z.string()),
        goal: z.string(),
        duration: z.number(),
        intensity: z.string(),
        restBetweenSets: z.number(),
        participantUsernames: z.array(z.string()).optional(),
      });
      const body = schema.parse(req.body);
      const result = await generateWorkoutPlan(body);
      return res.json(result);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ── Workout Plans ──────────────────────────────────────────────────────────
  app.post("/api/workout-plans", async (req, res) => {
    try {
      const plan = await storage.createWorkoutPlan(req.body);
      return res.json(plan);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/workout-plans/:id", async (req, res) => {
    const plan = await storage.getWorkoutPlan(Number(req.params.id));
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    return res.json(plan);
  });

  app.get("/api/users/:userId/workout-plans", async (req, res) => {
    const plans = await storage.getWorkoutPlansByUser(Number(req.params.userId));
    return res.json(plans);
  });

  // ── Workout Sessions ───────────────────────────────────────────────────────
  app.post("/api/workout-sessions", async (req, res) => {
    try {
      const session = await storage.createWorkoutSession(req.body);
      return res.json(session);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/workout-sessions/:id", async (req, res) => {
    const session = await storage.getWorkoutSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json(session);
  });

  app.patch("/api/workout-sessions/:id", async (req, res) => {
    try {
      const session = await storage.updateWorkoutSession(Number(req.params.id), req.body);
      if (!session) return res.status(404).json({ error: "Session not found" });
      return res.json(session);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ── Exercise Logs ──────────────────────────────────────────────────────────
  app.post("/api/exercise-logs", async (req, res) => {
    try {
      const log = await storage.createExerciseLog(req.body);
      return res.json(log);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/workout-sessions/:sessionId/exercise-logs", async (req, res) => {
    const logs = await storage.getExerciseLogsBySession(Number(req.params.sessionId));
    return res.json(logs);
  });

  app.patch("/api/exercise-logs/:id", async (req, res) => {
    try {
      const log = await storage.updateExerciseLog(Number(req.params.id), req.body);
      if (!log) return res.status(404).json({ error: "Log not found" });
      return res.json(log);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ── Workout History ────────────────────────────────────────────────────────
  app.post("/api/workout-history", async (req, res) => {
    try {
      const history = await storage.createWorkoutHistory(req.body);
      return res.json(history);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/users/:userId/workout-history", async (req, res) => {
    const history = await storage.getWorkoutHistory(Number(req.params.userId));
    return res.json(history);
  });

  app.get("/api/users/:userId/workout-history/recent", async (req, res) => {
    const days = Number(req.query.days) || 7;
    const history = await storage.getRecentWorkouts(Number(req.params.userId), days);
    return res.json(history);
  });

  return httpServer;
}
