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
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, or, gte, desc, sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required. Set it to your Neon PostgreSQL connection string.");
  process.exit(1);
}

const queryClient = neon(DATABASE_URL);
export const db = drizzle(queryClient);

// ── Initialize tables (idempotent) ──────────────────────────────────────────
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    height_cm REAL,
    weight_kg REAL,
    goals TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (now()::text)
  )`,
  `CREATE TABLE IF NOT EXISTS friend_requests (
    id SERIAL PRIMARY KEY,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (now()::text)
  )`,
  `CREATE TABLE IF NOT EXISTS workout_invites (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL,
    from_username TEXT NOT NULL,
    to_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (now()::text)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    related_id INTEGER,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TEXT NOT NULL DEFAULT (now()::text)
  )`,
  `CREATE TABLE IF NOT EXISTS exercises (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    primary_muscle TEXT NOT NULL,
    secondary_muscles TEXT NOT NULL DEFAULT '[]',
    equipment TEXT NOT NULL DEFAULT '[]',
    workout_types TEXT NOT NULL DEFAULT '[]',
    is_compound BOOLEAN NOT NULL DEFAULT false,
    instructions TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS workout_plans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    exercises TEXT NOT NULL DEFAULT '[]',
    workout_types TEXT NOT NULL DEFAULT '[]',
    goal TEXT NOT NULL DEFAULT 'Muscle Gain',
    estimated_duration INTEGER NOT NULL DEFAULT 45,
    intensity TEXT NOT NULL DEFAULT 'Moderate',
    rest_between_sets INTEGER NOT NULL DEFAULT 90,
    ai_reasoning TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (now()::text)
  )`,
  `CREATE TABLE IF NOT EXISTS workout_sessions (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    participant_usernames TEXT NOT NULL DEFAULT '[]',
    creator_username TEXT NOT NULL,
    is_shared BOOLEAN NOT NULL DEFAULT false,
    started_at TEXT,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    is_paused BOOLEAN NOT NULL DEFAULT false,
    current_rotation_index INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS exercise_logs (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    username TEXT NOT NULL,
    sets TEXT NOT NULL DEFAULT '[]',
    timestamp TEXT NOT NULL DEFAULT (now()::text)
  )`,
  `CREATE TABLE IF NOT EXISTS workout_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    plan_name TEXT NOT NULL DEFAULT '',
    total_volume REAL NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    muscles_worked TEXT NOT NULL DEFAULT '[]',
    exercise_logs TEXT NOT NULL DEFAULT '[]',
    was_shared BOOLEAN NOT NULL DEFAULT false,
    participant_count INTEGER NOT NULL DEFAULT 1,
    ai_reasoning TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT (now()::text)
  )`,
];

export async function initDatabase() {
  for (const stmt of TABLE_STATEMENTS) {
    await queryClient(stmt);
  }
}

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
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
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return rows[0];
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.phone, phone));
    return rows[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(insertUser).returning();
    return rows[0];
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    const rows = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return rows[0];
  }

  // ── Friend Requests ────────────────────────────────────────────────────────
  async createFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest> {
    const rows = await db.insert(friendRequests).values({ fromUserId, toUserId, status: "pending" }).returning();
    return rows[0];
  }

  async getPendingFriendRequests(userId: number): Promise<(FriendRequest & { fromUser?: User })[]> {
    const requests = await db.select().from(friendRequests)
      .where(and(eq(friendRequests.toUserId, userId), eq(friendRequests.status, "pending")))
      .orderBy(desc(friendRequests.id));

    const enriched = [];
    for (const req of requests) {
      const fromRows = await db.select().from(users).where(eq(users.id, req.fromUserId));
      enriched.push({ ...req, fromUser: fromRows[0] });
    }
    return enriched;
  }

  async getSentFriendRequests(userId: number): Promise<(FriendRequest & { toUser?: User })[]> {
    const requests = await db.select().from(friendRequests)
      .where(and(eq(friendRequests.fromUserId, userId), eq(friendRequests.status, "pending")))
      .orderBy(desc(friendRequests.id));

    const enriched = [];
    for (const req of requests) {
      const toRows = await db.select().from(users).where(eq(users.id, req.toUserId));
      enriched.push({ ...req, toUser: toRows[0] });
    }
    return enriched;
  }

  async getAcceptedFriends(userId: number): Promise<User[]> {
    const rows = await queryClient(`
      SELECT u.id, u.username, u.display_name, u.phone, u.height_cm, u.weight_kg, u.goals, u.created_at
      FROM users u
      INNER JOIN friend_requests fr ON
        (fr.from_user_id = $1 AND fr.to_user_id = u.id AND fr.status = 'accepted')
        OR (fr.to_user_id = $1 AND fr.from_user_id = u.id AND fr.status = 'accepted')
    `, [userId]);

    return rows.map((r: any) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      phone: r.phone || "",
      heightCm: r.height_cm,
      weightKg: r.weight_kg,
      goals: r.goals,
      createdAt: r.created_at,
    }));
  }

  async updateFriendRequest(id: number, status: string): Promise<FriendRequest | undefined> {
    const rows = await db.update(friendRequests).set({ status }).where(eq(friendRequests.id, id)).returning();
    return rows[0];
  }

  async removeFriendRequest(id: number): Promise<void> {
    await db.delete(friendRequests).where(eq(friendRequests.id, id));
  }

  async findExistingFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest | undefined> {
    const rows = await db.select().from(friendRequests)
      .where(
        or(
          and(eq(friendRequests.fromUserId, fromUserId), eq(friendRequests.toUserId, toUserId)),
          and(eq(friendRequests.fromUserId, toUserId), eq(friendRequests.toUserId, fromUserId))
        )
      );
    return rows[0];
  }

  // ── Workout Invites ────────────────────────────────────────────────────────
  async createWorkoutInvite(invite: InsertWorkoutInvite): Promise<WorkoutInvite> {
    const rows = await db.insert(workoutInvites).values(invite).returning();
    return rows[0];
  }

  async getWorkoutInvitesForUser(username: string): Promise<WorkoutInvite[]> {
    return db.select().from(workoutInvites)
      .where(and(eq(workoutInvites.toUsername, username), eq(workoutInvites.status, "pending")))
      .orderBy(desc(workoutInvites.id));
  }

  async updateWorkoutInvite(id: number, status: string): Promise<WorkoutInvite | undefined> {
    const rows = await db.update(workoutInvites).set({ status }).where(eq(workoutInvites.id, id)).returning();
    return rows[0];
  }

  async getWorkoutInvitesBySession(sessionId: number): Promise<WorkoutInvite[]> {
    return db.select().from(workoutInvites).where(eq(workoutInvites.sessionId, sessionId));
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  async createNotification(notification: InsertNotification): Promise<Notification> {
    const rows = await db.insert(notifications).values(notification).returning();
    return rows[0];
  }

  async getNotificationsForUser(userId: number): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.id));
  }

  async markNotificationRead(id: number): Promise<void> {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const rows = await db.select().from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return rows.length;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
  }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async getAllExercises(): Promise<Exercise[]> {
    return db.select().from(exercises);
  }

  async getExercisesByMuscle(muscle: string): Promise<Exercise[]> {
    return db.select().from(exercises).where(eq(exercises.primaryMuscle, muscle));
  }

  async getExercisesByEquipment(_equipment: string[]): Promise<Exercise[]> {
    return db.select().from(exercises);
  }

  async seedExercises(exerciseList: InsertExercise[]): Promise<void> {
    // Insert in batches of 50 to avoid hitting query size limits
    for (let i = 0; i < exerciseList.length; i += 50) {
      const batch = exerciseList.slice(i, i + 50);
      await db.insert(exercises).values(batch);
    }
  }

  async getExerciseCount(): Promise<number> {
    const result = await db.select().from(exercises);
    return result.length;
  }

  // ── Workout Plans ──────────────────────────────────────────────────────────
  async createWorkoutPlan(plan: InsertWorkoutPlan): Promise<WorkoutPlan> {
    const rows = await db.insert(workoutPlans).values(plan).returning();
    return rows[0];
  }

  async getWorkoutPlan(id: number): Promise<WorkoutPlan | undefined> {
    const rows = await db.select().from(workoutPlans).where(eq(workoutPlans.id, id));
    return rows[0];
  }

  async getWorkoutPlansByUser(userId: number): Promise<WorkoutPlan[]> {
    return db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId))
      .orderBy(desc(workoutPlans.id));
  }

  // ── Workout Sessions ───────────────────────────────────────────────────────
  async createWorkoutSession(session: InsertWorkoutSession): Promise<WorkoutSession> {
    const rows = await db.insert(workoutSessions).values(session).returning();
    return rows[0];
  }

  async getWorkoutSession(id: number): Promise<WorkoutSession | undefined> {
    const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.id, id));
    return rows[0];
  }

  async updateWorkoutSession(id: number, updates: Partial<InsertWorkoutSession>): Promise<WorkoutSession | undefined> {
    const rows = await db.update(workoutSessions).set(updates).where(eq(workoutSessions.id, id)).returning();
    return rows[0];
  }

  async getActiveSessionForUser(userId: number): Promise<WorkoutSession | undefined> {
    const rows = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.status, "active")));
    return rows[0];
  }

  // ── Exercise Logs ──────────────────────────────────────────────────────────
  async createExerciseLog(log: InsertExerciseLog): Promise<ExerciseLog> {
    const rows = await db.insert(exerciseLogs).values(log).returning();
    return rows[0];
  }

  async getExerciseLogsBySession(sessionId: number): Promise<ExerciseLog[]> {
    return db.select().from(exerciseLogs).where(eq(exerciseLogs.sessionId, sessionId));
  }

  async updateExerciseLog(id: number, updates: Partial<InsertExerciseLog>): Promise<ExerciseLog | undefined> {
    const rows = await db.update(exerciseLogs).set(updates).where(eq(exerciseLogs.id, id)).returning();
    return rows[0];
  }

  // ── Workout History ────────────────────────────────────────────────────────
  async createWorkoutHistory(history: InsertWorkoutHistory): Promise<WorkoutHistory> {
    const rows = await db.insert(workoutHistory).values(history).returning();
    return rows[0];
  }

  async getWorkoutHistory(userId: number): Promise<WorkoutHistory[]> {
    return db.select().from(workoutHistory).where(eq(workoutHistory.userId, userId))
      .orderBy(desc(workoutHistory.id));
  }

  async getRecentWorkouts(userId: number, days: number): Promise<WorkoutHistory[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return db.select().from(workoutHistory)
      .where(and(eq(workoutHistory.userId, userId), gte(workoutHistory.completedAt, since)))
      .orderBy(desc(workoutHistory.id));
  }
}

export const storage = new DatabaseStorage();
