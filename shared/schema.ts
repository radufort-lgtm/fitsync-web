import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users ────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  goals: text("goals").notNull().default("[]"), // JSON string[]
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Friends ──────────────────────────────────────────────────────────────────
export const friends = sqliteTable("friends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  friendUsername: text("friend_username").notNull(),
  friendDisplayName: text("friend_display_name").notNull(),
  addedAt: text("added_at").notNull().default(new Date().toISOString()),
});

export const insertFriendSchema = createInsertSchema(friends).omit({ id: true, addedAt: true });
export type InsertFriend = z.infer<typeof insertFriendSchema>;
export type Friend = typeof friends.$inferSelect;

// ── Exercises ────────────────────────────────────────────────────────────────
export const exercises = sqliteTable("exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  primaryMuscle: text("primary_muscle").notNull(),
  secondaryMuscles: text("secondary_muscles").notNull().default("[]"), // JSON string[]
  equipment: text("equipment").notNull().default("[]"), // JSON string[]
  workoutTypes: text("workout_types").notNull().default("[]"), // JSON string[]
  isCompound: integer("is_compound", { mode: "boolean" }).notNull().default(false),
  instructions: text("instructions").notNull().default(""),
});

export const insertExerciseSchema = createInsertSchema(exercises).omit({ id: true });
export type InsertExercise = z.infer<typeof insertExerciseSchema>;
export type Exercise = typeof exercises.$inferSelect;

// ── Workout Plans ─────────────────────────────────────────────────────────────
export const workoutPlans = sqliteTable("workout_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  userId: integer("user_id").notNull(),
  exercises: text("exercises").notNull().default("[]"), // JSON PlannedExercise[]
  workoutTypes: text("workout_types").notNull().default("[]"), // JSON string[]
  goal: text("goal").notNull().default("Muscle Gain"),
  estimatedDuration: integer("estimated_duration").notNull().default(45),
  intensity: text("intensity").notNull().default("Moderate"),
  restBetweenSets: integer("rest_between_sets").notNull().default(90),
  aiReasoning: text("ai_reasoning").notNull().default(""),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertWorkoutPlanSchema = createInsertSchema(workoutPlans).omit({ id: true, createdAt: true });
export type InsertWorkoutPlan = z.infer<typeof insertWorkoutPlanSchema>;
export type WorkoutPlan = typeof workoutPlans.$inferSelect;

// ── Workout Sessions ──────────────────────────────────────────────────────────
export const workoutSessions = sqliteTable("workout_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull(),
  userId: integer("user_id").notNull(),
  participantUsernames: text("participant_usernames").notNull().default("[]"), // JSON string[]
  creatorUsername: text("creator_username").notNull(),
  isShared: integer("is_shared", { mode: "boolean" }).notNull().default(false),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  status: text("status").notNull().default("pending"), // pending | active | paused | completed
  isPaused: integer("is_paused", { mode: "boolean" }).notNull().default(false),
  currentRotationIndex: integer("current_rotation_index").notNull().default(0),
});

export const insertWorkoutSessionSchema = createInsertSchema(workoutSessions).omit({ id: true });
export type InsertWorkoutSession = z.infer<typeof insertWorkoutSessionSchema>;
export type WorkoutSession = typeof workoutSessions.$inferSelect;

// ── Exercise Logs ─────────────────────────────────────────────────────────────
export const exerciseLogs = sqliteTable("exercise_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  exerciseId: integer("exercise_id").notNull(),
  exerciseName: text("exercise_name").notNull(),
  username: text("username").notNull(),
  sets: text("sets").notNull().default("[]"), // JSON SetLog[]
  timestamp: text("timestamp").notNull().default(new Date().toISOString()),
});

export const insertExerciseLogSchema = createInsertSchema(exerciseLogs).omit({ id: true, timestamp: true });
export type InsertExerciseLog = z.infer<typeof insertExerciseLogSchema>;
export type ExerciseLog = typeof exerciseLogs.$inferSelect;

// ── Workout History ───────────────────────────────────────────────────────────
export const workoutHistory = sqliteTable("workout_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  planId: integer("plan_id").notNull(),
  planName: text("plan_name").notNull().default(""),
  totalVolume: real("total_volume").notNull().default(0),
  duration: integer("duration").notNull().default(0), // seconds
  musclesWorked: text("muscles_worked").notNull().default("[]"), // JSON string[]
  exerciseLogs: text("exercise_logs").notNull().default("[]"), // JSON ExerciseLog[]
  wasShared: integer("was_shared", { mode: "boolean" }).notNull().default(false),
  participantCount: integer("participant_count").notNull().default(1),
  aiReasoning: text("ai_reasoning").notNull().default(""),
  completedAt: text("completed_at").notNull().default(new Date().toISOString()),
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
