import {
  users, friendRequests, workoutInvites, notifications,
  exercises, workoutPlans, workoutSessions,
  exerciseLogs, workoutHistory,
  type User, type InsertUser,
  type FriendRequest, type InsertFriendRequest,
  type WorkoutInvite, type InsertWorkoutInvite,
  type Notification, type InsertNotification,
  type Exercise, type InsertExercise,
  type WorkoutPlan, type InsertWorkoutPlan,
  type WorkoutSession, type InsertWorkoutSession,
  type ExerciseLog, type InsertExerciseLog,
  type WorkoutHistory, type InsertWorkoutHistory,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, or, gte, desc } from "drizzle-orm";

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

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workout_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    from_username TEXT NOT NULL,
    to_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    related_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  -- Drop old friends table if it exists
  DROP TABLE IF EXISTS friends;
`);

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined>;

  // Friend Requests
  createFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest>;
  getPendingFriendRequests(userId: number): Promise<(FriendRequest & { fromUser?: User; toUser?: User })[]>;
  getSentFriendRequests(userId: number): Promise<(FriendRequest & { toUser?: User })[]>;
  getAcceptedFriends(userId: number): Promise<User[]>;
  updateFriendRequest(id: number, status: string): Promise<FriendRequest | undefined>;
  removeFriendRequest(id: number): Promise<void>;
  findExistingFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest | undefined>;

  // Workout Invites
  createWorkoutInvite(invite: InsertWorkoutInvite): Promise<WorkoutInvite>;
  getWorkoutInvitesForUser(username: string): Promise<WorkoutInvite[]>;
  updateWorkoutInvite(id: number, status: string): Promise<WorkoutInvite | undefined>;
  getWorkoutInvitesBySession(sessionId: number): Promise<WorkoutInvite[]>;

  // Notifications
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotificationsForUser(userId: number): Promise<Notification[]>;
  markNotificationRead(id: number): Promise<void>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  markAllNotificationsRead(userId: number): Promise<void>;

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

  // ── Friend Requests ────────────────────────────────────────────────────────
  async createFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest> {
    return db.insert(friendRequests).values({ fromUserId, toUserId, status: "pending" }).returning().get();
  }

  async getPendingFriendRequests(userId: number): Promise<(FriendRequest & { fromUser?: User })[]> {
    const requests = db.select().from(friendRequests)
      .where(and(eq(friendRequests.toUserId, userId), eq(friendRequests.status, "pending")))
      .orderBy(desc(friendRequests.id)).all();

    // Enrich with sender info
    const enriched = [];
    for (const req of requests) {
      const fromUser = db.select().from(users).where(eq(users.id, req.fromUserId)).get();
      enriched.push({ ...req, fromUser });
    }
    return enriched;
  }

  async getSentFriendRequests(userId: number): Promise<(FriendRequest & { toUser?: User })[]> {
    const requests = db.select().from(friendRequests)
      .where(and(eq(friendRequests.fromUserId, userId), eq(friendRequests.status, "pending")))
      .orderBy(desc(friendRequests.id)).all();

    const enriched = [];
    for (const req of requests) {
      const toUser = db.select().from(users).where(eq(users.id, req.toUserId)).get();
      enriched.push({ ...req, toUser });
    }
    return enriched;
  }

  async getAcceptedFriends(userId: number): Promise<User[]> {
    // Raw SQL for the OR join condition
    const rows = sqlite.prepare(`
      SELECT u.id, u.username, u.display_name, u.height_cm, u.weight_kg, u.goals, u.created_at
      FROM users u
      INNER JOIN friend_requests fr ON
        (fr.from_user_id = ? AND fr.to_user_id = u.id AND fr.status = 'accepted')
        OR (fr.to_user_id = ? AND fr.from_user_id = u.id AND fr.status = 'accepted')
    `).all(userId, userId) as any[];

    return rows.map((r: any) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      heightCm: r.height_cm,
      weightKg: r.weight_kg,
      goals: r.goals,
      createdAt: r.created_at,
    }));
  }

  async updateFriendRequest(id: number, status: string): Promise<FriendRequest | undefined> {
    return db.update(friendRequests).set({ status }).where(eq(friendRequests.id, id)).returning().get();
  }

  async removeFriendRequest(id: number): Promise<void> {
    db.delete(friendRequests).where(eq(friendRequests.id, id)).run();
  }

  async findExistingFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest | undefined> {
    // Check both directions
    return db.select().from(friendRequests)
      .where(
        or(
          and(eq(friendRequests.fromUserId, fromUserId), eq(friendRequests.toUserId, toUserId)),
          and(eq(friendRequests.fromUserId, toUserId), eq(friendRequests.toUserId, fromUserId))
        )
      ).get();
  }

  // ── Workout Invites ────────────────────────────────────────────────────────
  async createWorkoutInvite(invite: InsertWorkoutInvite): Promise<WorkoutInvite> {
    return db.insert(workoutInvites).values(invite).returning().get();
  }

  async getWorkoutInvitesForUser(username: string): Promise<WorkoutInvite[]> {
    return db.select().from(workoutInvites)
      .where(and(eq(workoutInvites.toUsername, username), eq(workoutInvites.status, "pending")))
      .orderBy(desc(workoutInvites.id)).all();
  }

  async updateWorkoutInvite(id: number, status: string): Promise<WorkoutInvite | undefined> {
    return db.update(workoutInvites).set({ status }).where(eq(workoutInvites.id, id)).returning().get();
  }

  async getWorkoutInvitesBySession(sessionId: number): Promise<WorkoutInvite[]> {
    return db.select().from(workoutInvites).where(eq(workoutInvites.sessionId, sessionId)).all();
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  async createNotification(notification: InsertNotification): Promise<Notification> {
    return db.insert(notifications).values(notification).returning().get();
  }

  async getNotificationsForUser(userId: number): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.id)).all();
  }

  async markNotificationRead(id: number): Promise<void> {
    db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id)).run();
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const rows = db.select().from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false))).all();
    return rows.length;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId)).run();
  }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async getAllExercises(): Promise<Exercise[]> {
    return db.select().from(exercises).all();
  }

  async getExercisesByMuscle(muscle: string): Promise<Exercise[]> {
    return db.select().from(exercises).where(eq(exercises.primaryMuscle, muscle)).all();
  }

  async getExercisesByEquipment(_equipment: string[]): Promise<Exercise[]> {
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
