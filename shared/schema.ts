import { pgTable, text, integer, serial, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull().default(""),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  goals: text("goals").notNull().default("[]"), // JSON string[]
  createdAt: text("created_at").notNull().default("now()"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Friend Requests ──────────────────────────────────────────────────────────
export const friendRequests = pgTable("friend_requests", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull(),
  toUserId: integer("to_user_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  createdAt: text("created_at").notNull().default("now()"),
});

export const insertFriendRequestSchema = createInsertSchema(friendRequests).omit({ id: true, createdAt: true });
export type InsertFriendRequest = z.infer<typeof insertFriendRequestSchema>;
export type FriendRequest = typeof friendRequests.$inferSelect;

// ── Workout Invites ──────────────────────────────────────────────────────────
export const workoutInvites = pgTable("workout_invites", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  fromUsername: text("from_username").notNull(),
  toUsername: text("to_username").notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  createdAt: text("created_at").notNull().default("now()"),
});

export const insertWorkoutInviteSchema = createInsertSchema(workoutInvites).omit({ id: true, createdAt: true });
export type InsertWorkoutInvite = z.infer<typeof insertWorkoutInviteSchema>;
export type WorkoutInvite = typeof workoutInvites.$inferSelect;

// ── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // friend_request | workout_invite | friend_accepted
  title: text("title").notNull(),
  body: text("body").notNull(),
  relatedId: integer("related_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: text("created_at").notNull().default("now()"),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ── Exercises ────────────────────────────────────────────────────────────────
export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  primaryMuscle: text("primary_muscle").notNull(),
  secondaryMuscles: text("secondary_muscles").notNull().default("[]"), // JSON string[]
  equipment: text("equipment").notNull().default("[]"), // JSON string[]
  workoutTypes: text("workout_types").notNull().default("[]"), // JSON string[]
  isCompound: boolean("is_compound").notNull().default(false),
  instructions: text("instructions").notNull().default(""),
});

export const insertExerciseSchema = createInsertSchema(exercises).omit({ id: true });
export type InsertExercise = z.infer<typeof insertExerciseSchema>;
export type Exercise = typeof exercises.$inferSelect;

// ── Workout Plans ─────────────────────────────────────────────────────────────
export const workoutPlans = pgTable("workout_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id").notNull(),
  exercises: text("exercises").notNull().default("[]"), // JSON PlannedExercise[]
  workoutTypes: text("workout_types").notNull().default("[]"), // JSON string[]
  goal: text("goal").notNull().default("Muscle Gain"),
  estimatedDuration: integer("estimated_duration").notNull().default(45),
  intensity: text("intensity").notNull().default("Moderate"),
  restBetweenSets: integer("rest_between_sets").notNull().default(90),
  aiReasoning: text("ai_reasoning").notNull().default(""),
  createdAt: text("created_at").notNull().default("now()"),
});

export const insertWorkoutPlanSchema = createInsertSchema(workoutPlans).omit({ id: true, createdAt: true });
export type InsertWorkoutPlan = z.infer<typeof insertWorkoutPlanSchema>;
export type WorkoutPlan = typeof workoutPlans.$inferSelect;

// ── Workout Sessions ──────────────────────────────────────────────────────────
export const workoutSessions = pgTable("workout_sessions", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  userId: integer("user_id").notNull(),
  participantUsernames: text("participant_usernames").notNull().default("[]"), // JSON string[]
  creatorUsername: text("creator_username").notNull(),
  isShared: boolean("is_shared").notNull().default(false),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  status: text("status").notNull().default("pending"), // pending | waiting | active | paused | completed
  isPaused: boolean("is_paused").notNull().default(false),
  currentRotationIndex: integer("current_rotation_index").notNull().default(0),
});

export const insertWorkoutSessionSchema = createInsertSchema(workoutSessions).omit({ id: true });
export type InsertWorkoutSession = z.infer<typeof insertWorkoutSessionSchema>;
export type WorkoutSession = typeof workoutSessions.$inferSelect;

// ── Exercise Logs ─────────────────────────────────────────────────────────────
export const exerciseLogs = pgTable("exercise_logs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  exerciseId: integer("exercise_id").notNull(),
  exerciseName: text("exercise_name").notNull(),
  username: text("username").notNull(),
  sets: text("sets").notNull().default("[]"), // JSON SetLog[]
  timestamp: text("timestamp").notNull().default("now()"),
});

export const insertExerciseLogSchema = createInsertSchema(exerciseLogs).omit({ id: true, timestamp: true });
export type InsertExerciseLog = z.infer<typeof insertExerciseLogSchema>;
export type ExerciseLog = typeof exerciseLogs.$inferSelect;

// ── Workout History ───────────────────────────────────────────────────────────
export const workoutHistory = pgTable("workout_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  planId: integer("plan_id").notNull(),
  planName: text("plan_name").notNull().default(""),
  totalVolume: real("total_volume").notNull().default(0),
  duration: integer("duration").notNull().default(0), // seconds
  musclesWorked: text("muscles_worked").notNull().default("[]"), // JSON string[]
  exerciseLogs: text("exercise_logs").notNull().default("[]"), // JSON ExerciseLog[]
  wasShared: boolean("was_shared").notNull().default(false),
  participantCount: integer("participant_count").notNull().default(1),
  aiReasoning: text("ai_reasoning").notNull().default(""),
  completedAt: text("completed_at").notNull().default("now()"),
});

export const insertWorkoutHistorySchema = createInsertSchema(workoutHistory).omit({ id: true, completedAt: true });
export type InsertWorkoutHistory = z.infer<typeof insertWorkoutHistorySchema>;
export type WorkoutHistory = typeof workoutHistory.$inferSelect;

// ── Shared Types ──────────────────────────────────────────────────────────────
export interface PlannedExercise {
  exerciseId: number;
  exerciseName: string;
  primaryMuscle: string;
  sets: number;
  reps: number;
  weight?: number;
  restSeconds: number;
}

export interface SetLog {
  setNumber: number;
  reps: number;
  weight: number;
  completed: boolean;
}

export interface GenerateWorkoutRequest {
  userId: number;
  workoutTypes: string[];
  equipment: string[];
  goal: string;
  duration: number;
  intensity: string;
  restBetweenSets: number;
  participantUsernames?: string[];
}
