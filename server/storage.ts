import {
  users, friends, exercises, workoutPlans, workoutSessions,
  exerciseLogs, workoutHistory,
  type User, type InsertUser,
  type Friend, type InsertFriend,
  type Exercise, type InsertExercise,
  type WorkoutPlan, type InsertWorkoutPlan,
  type WorkoutSession, type InsertWorkoutSession,
  type ExerciseLog, type InsertExerciseLog,
  type WorkoutHistory, type InsertWorkoutHistory,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, gte, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// ── Initialize tables ─────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    height_cm REAL,
    weight_kg REAL,
    goals TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_username TEXT NOT NULL,
    friend_display_name TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    primary_muscle TEXT NOT NULL,
    secondary_muscles TEXT NOT NULL DEFAULT '[]',
    equipment TEXT NOT NULL DEFAULT '[]',
    workout_types TEXT NOT NULL DEFAULT '[]',
    is_compound INTEGER NOT NULL DEFAULT 0,
    instructions TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS workout_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    exercises TEXT NOT NULL DEFAULT '[]',
    workout_types TEXT NOT NULL DEFAULT '[]',
    goal TEXT NOT NULL DEFAULT 'Muscle Gain',
    estimated_duration INTEGER NOT NULL DEFAULT 45,
    intensity TEXT NOT NULL DEFAULT 'Moderate',
    rest_between_sets INTEGER NOT NULL DEFAULT 90,
    ai_reasoning TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workout_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    participant_usernames TEXT NOT NULL DEFAULT '[]',
    creator_username TEXT NOT NULL,
    is_shared INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    is_paused INTEGER NOT NULL DEFAULT 0,
    current_rotation_index INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS exercise_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    username TEXT NOT NULL,
    sets TEXT NOT NULL DEFAULT '[]',
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workout_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    plan_name TEXT NOT NULL DEFAULT '',
    total_volume REAL NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    muscles_worked TEXT NOT NULL DEFAULT '[]',
    exercise_logs TEXT NOT NULL DEFAULT '[]',
    was_shared INTEGER NOT NULL DEFAULT 0,
    participant_count INTEGER NOT NULL DEFAULT 1,
    ai_reasoning TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined>;

  // Friends
  getFriends(userId: number): Promise<Friend[]>;
  addFriend(friend: InsertFriend): Promise<Friend>;
  removeFriend(userId: number, friendUsername: string): Promise<void>;

  // Exercises
  getAllExercises(): Promise<Exercise[]>;
  getExercisesByMuscle(muscle: string): Promise<Exercise[]>;
  getExercisesByEquipment(equipment: string[]): Promise<Exercise[]>;
  seedExercises(exerciseList: InsertExercise[]): Promise<void>;
  getExerciseCount(): Promise<number>;

  // Workout Plans
  createWorkoutPlan(plan: InsertWorkoutPlan): Promise<WorkoutPlan>;
  getWorkoutPlan(id: number): Promise<WorkoutPlan | undefined>;
  getWorkoutPlansByUser(userId: number): Promise<WorkoutPlan[]>;

  // Workout Sessions
  createWorkoutSession(session: InsertWorkoutSession): Promise<WorkoutSession>;
  getWorkoutSession(id: number): Promise<WorkoutSession | undefined>;
  updateWorkoutSession(id: number, updates: Partial<InsertWorkoutSession>): Promise<WorkoutSession | undefined>;
  getActiveSessionForUser(userId: number): Promise<WorkoutSession | undefined>;

  // Exercise Logs
  createExerciseLog(log: InsertExerciseLog): Promise<ExerciseLog>;
  getExerciseLogsBySession(sessionId: number): Promise<ExerciseLog[]>;
  updateExerciseLog(id: number, updates: Partial<InsertExerciseLog>): Promise<ExerciseLog | undefined>;

  // Workout History
  createWorkoutHistory(history: InsertWorkoutHistory): Promise<WorkoutHistory>;
  getWorkoutHistory(userId: number): Promise<WorkoutHistory[]>;
  getRecentWorkouts(userId: number, days: number): Promise<WorkoutHistory[]>;
}

export class DatabaseStorage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────────────
  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    return db.update(users).set(updates).where(eq(users.id, id)).returning().get();
  }

  // ── Friends ────────────────────────────────────────────────────────────────
  async getFriends(userId: number): Promise<Friend[]> {
    return db.select().from(friends).where(eq(friends.userId, userId)).all();
  }

  async addFriend(friend: InsertFriend): Promise<Friend> {
    return db.insert(friends).values(friend).returning().get();
  }

  async removeFriend(userId: number, friendUsername: string): Promise<void> {
    db.delete(friends)
      .where(and(eq(friends.userId, userId), eq(friends.friendUsername, friendUsername)))
      .run();
  }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async getAllExercises(): Promise<Exercise[]> {
    return db.select().from(exercises).all();
  }

  async getExercisesByMuscle(muscle: string): Promise<Exercise[]> {
    return db.select().from(exercises).where(eq(exercises.primaryMuscle, muscle)).all();
  }

  async getExercisesByEquipment(_equipment: string[]): Promise<Exercise[]> {
    // Return all — filter in app code since SQLite JSON filtering is complex
    return db.select().from(exercises).all();
  }

  async seedExercises(exerciseList: InsertExercise[]): Promise<void> {
    for (const ex of exerciseList) {
      db.insert(exercises).values(ex).run();
    }
  }

  async getExerciseCount(): Promise<number> {
    const result = db.select().from(exercises).all();
    return result.length;
  }

  // ── Workout Plans ──────────────────────────────────────────────────────────
  async createWorkoutPlan(plan: InsertWorkoutPlan): Promise<WorkoutPlan> {
    return db.insert(workoutPlans).values(plan).returning().get();
  }

  async getWorkoutPlan(id: number): Promise<WorkoutPlan | undefined> {
    return db.select().from(workoutPlans).where(eq(workoutPlans.id, id)).get();
  }

  async getWorkoutPlansByUser(userId: number): Promise<WorkoutPlan[]> {
    return db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId))
      .orderBy(desc(workoutPlans.id)).all();
  }

  // ── Workout Sessions ───────────────────────────────────────────────────────
  async createWorkoutSession(session: InsertWorkoutSession): Promise<WorkoutSession> {
    return db.insert(workoutSessions).values(session).returning().get();
  }

  async getWorkoutSession(id: number): Promise<WorkoutSession | undefined> {
    return db.select().from(workoutSessions).where(eq(workoutSessions.id, id)).get();
  }

  async updateWorkoutSession(id: number, updates: Partial<InsertWorkoutSession>): Promise<WorkoutSession | undefined> {
    return db.update(workoutSessions).set(updates).where(eq(workoutSessions.id, id)).returning().get();
  }

  async getActiveSessionForUser(userId: number): Promise<WorkoutSession | undefined> {
    return db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.status, "active")))
      .get();
  }

  // ── Exercise Logs ──────────────────────────────────────────────────────────
  async createExerciseLog(log: InsertExerciseLog): Promise<ExerciseLog> {
    return db.insert(exerciseLogs).values(log).returning().get();
  }

  async getExerciseLogsBySession(sessionId: number): Promise<ExerciseLog[]> {
    return db.select().from(exerciseLogs).where(eq(exerciseLogs.sessionId, sessionId)).all();
  }

  async updateExerciseLog(id: number, updates: Partial<InsertExerciseLog>): Promise<ExerciseLog | undefined> {
    return db.update(exerciseLogs).set(updates).where(eq(exerciseLogs.id, id)).returning().get();
  }

  // ── Workout History ────────────────────────────────────────────────────────
  async createWorkoutHistory(history: InsertWorkoutHistory): Promise<WorkoutHistory> {
    return db.insert(workoutHistory).values(history).returning().get();
  }

  async getWorkoutHistory(userId: number): Promise<WorkoutHistory[]> {
    return db.select().from(workoutHistory).where(eq(workoutHistory.userId, userId))
      .orderBy(desc(workoutHistory.id)).all();
  }

  async getRecentWorkouts(userId: number, days: number): Promise<WorkoutHistory[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return db.select().from(workoutHistory)
      .where(and(eq(workoutHistory.userId, userId), gte(workoutHistory.completedAt, since)))
      .orderBy(desc(workoutHistory.id)).all();
  }
}

export const storage = new DatabaseStorage();
