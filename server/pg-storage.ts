/**
 * PostgreSQL storage implementation using raw `pg` queries.
 * Used when DATABASE_URL is set (e.g. on Render with a free Postgres DB).
 * Falls back to SQLite (storage.ts) when DATABASE_URL is not set.
 */
import pg from "pg";
import type {
  User, InsertUser,
  FriendRequest, InsertFriendRequest,
  WorkoutInvite, InsertWorkoutInvite,
  Notification, InsertNotification,
  Exercise, InsertExercise,
  WorkoutPlan, InsertWorkoutPlan,
  WorkoutSession, InsertWorkoutSession,
  ExerciseLog, InsertExerciseLog,
  WorkoutHistory, InsertWorkoutHistory,
} from "@shared/schema";
import type { IStorage } from "./storage";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper to map snake_case DB rows to camelCase objects
function mapUser(r: any): User {
  return { id: r.id, username: r.username, displayName: r.display_name, phone: r.phone || "", heightCm: r.height_cm, weightKg: r.weight_kg, goals: r.goals, createdAt: r.created_at };
}
function mapFriendRequest(r: any): FriendRequest {
  return { id: r.id, fromUserId: r.from_user_id, toUserId: r.to_user_id, status: r.status, createdAt: r.created_at };
}
function mapWorkoutInvite(r: any): WorkoutInvite {
  return { id: r.id, sessionId: r.session_id, fromUsername: r.from_username, toUsername: r.to_username, status: r.status, createdAt: r.created_at };
}
function mapNotification(r: any): Notification {
  return { id: r.id, userId: r.user_id, type: r.type, title: r.title, body: r.body, relatedId: r.related_id, isRead: r.is_read, createdAt: r.created_at };
}
function mapExercise(r: any): Exercise {
  return { id: r.id, name: r.name, primaryMuscle: r.primary_muscle, secondaryMuscles: r.secondary_muscles, equipment: r.equipment, workoutTypes: r.workout_types, isCompound: r.is_compound, instructions: r.instructions };
}
function mapWorkoutPlan(r: any): WorkoutPlan {
  return { id: r.id, name: r.name, userId: r.user_id, exercises: r.exercises, workoutTypes: r.workout_types, goal: r.goal, estimatedDuration: r.estimated_duration, intensity: r.intensity, restBetweenSets: r.rest_between_sets, aiReasoning: r.ai_reasoning, createdAt: r.created_at };
}
function mapWorkoutSession(r: any): WorkoutSession {
  return { id: r.id, planId: r.plan_id, userId: r.user_id, participantUsernames: r.participant_usernames, creatorUsername: r.creator_username, isShared: r.is_shared, startedAt: r.started_at, completedAt: r.completed_at, status: r.status, isPaused: r.is_paused, currentRotationIndex: r.current_rotation_index };
}
function mapExerciseLog(r: any): ExerciseLog {
  return { id: r.id, sessionId: r.session_id, exerciseId: r.exercise_id, exerciseName: r.exercise_name, username: r.username, sets: r.sets, timestamp: r.timestamp };
}
function mapWorkoutHistory(r: any): WorkoutHistory {
  return { id: r.id, userId: r.user_id, planId: r.plan_id, planName: r.plan_name, totalVolume: r.total_volume, duration: r.duration, musclesWorked: r.muscles_worked, exerciseLogs: r.exercise_logs, wasShared: r.was_shared, participantCount: r.participant_count, aiReasoning: r.ai_reasoning, completedAt: r.completed_at };
}

export async function initPostgres() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', height_cm REAL, weight_kg REAL,
      goals TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (now()::text))`,
    `CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY, from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (now()::text))`,
    `CREATE TABLE IF NOT EXISTS workout_invites (
      id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL, from_username TEXT NOT NULL,
      to_username TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (now()::text))`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, related_id INTEGER,
      is_read BOOLEAN NOT NULL DEFAULT false, created_at TEXT NOT NULL DEFAULT (now()::text))`,
    `CREATE TABLE IF NOT EXISTS exercises (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, primary_muscle TEXT NOT NULL,
      secondary_muscles TEXT NOT NULL DEFAULT '[]', equipment TEXT NOT NULL DEFAULT '[]',
      workout_types TEXT NOT NULL DEFAULT '[]', is_compound BOOLEAN NOT NULL DEFAULT false,
      instructions TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS workout_plans (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, user_id INTEGER NOT NULL,
      exercises TEXT NOT NULL DEFAULT '[]', workout_types TEXT NOT NULL DEFAULT '[]',
      goal TEXT NOT NULL DEFAULT 'Muscle Gain', estimated_duration INTEGER NOT NULL DEFAULT 45,
      intensity TEXT NOT NULL DEFAULT 'Moderate', rest_between_sets INTEGER NOT NULL DEFAULT 90,
      ai_reasoning TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (now()::text))`,
    `CREATE TABLE IF NOT EXISTS workout_sessions (
      id SERIAL PRIMARY KEY, plan_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      participant_usernames TEXT NOT NULL DEFAULT '[]', creator_username TEXT NOT NULL,
      is_shared BOOLEAN NOT NULL DEFAULT false, started_at TEXT, completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending', is_paused BOOLEAN NOT NULL DEFAULT false,
      current_rotation_index INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS exercise_logs (
      id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL,
      exercise_name TEXT NOT NULL, username TEXT NOT NULL, sets TEXT NOT NULL DEFAULT '[]',
      timestamp TEXT NOT NULL DEFAULT (now()::text))`,
    `CREATE TABLE IF NOT EXISTS workout_history (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, plan_id INTEGER NOT NULL,
      plan_name TEXT NOT NULL DEFAULT '', total_volume REAL NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0, muscles_worked TEXT NOT NULL DEFAULT '[]',
      exercise_logs TEXT NOT NULL DEFAULT '[]', was_shared BOOLEAN NOT NULL DEFAULT false,
      participant_count INTEGER NOT NULL DEFAULT 1, ai_reasoning TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT (now()::text))`,
  ];
  for (const stmt of statements) {
    await pool.query(stmt);
  }
  console.log("[pg-storage] PostgreSQL tables initialized");
}

export class PgStorage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────────────
  async getUser(id: number): Promise<User | undefined> {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? mapUser(rows[0]) : undefined;
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    return rows[0] ? mapUser(rows[0]) : undefined;
  }
  async getUserByPhone(phone: string): Promise<User | undefined> {
    const { rows } = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
    return rows[0] ? mapUser(rows[0]) : undefined;
  }
  async createUser(u: InsertUser): Promise<User> {
    const { rows } = await pool.query(
      "INSERT INTO users (username, display_name, phone, height_cm, weight_kg, goals) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [u.username, u.displayName, u.phone || "", u.heightCm ?? null, u.weightKg ?? null, u.goals || "[]"]
    );
    return mapUser(rows[0]);
  }
  async updateUser(id: number, u: Partial<InsertUser>): Promise<User | undefined> {
    const sets: string[] = []; const vals: any[] = []; let i = 1;
    if (u.username !== undefined) { sets.push(`username=$${i++}`); vals.push(u.username); }
    if (u.displayName !== undefined) { sets.push(`display_name=$${i++}`); vals.push(u.displayName); }
    if (u.phone !== undefined) { sets.push(`phone=$${i++}`); vals.push(u.phone); }
    if (u.heightCm !== undefined) { sets.push(`height_cm=$${i++}`); vals.push(u.heightCm); }
    if (u.weightKg !== undefined) { sets.push(`weight_kg=$${i++}`); vals.push(u.weightKg); }
    if (u.goals !== undefined) { sets.push(`goals=$${i++}`); vals.push(u.goals); }
    if (sets.length === 0) return this.getUser(id);
    vals.push(id);
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(",")} WHERE id=$${i} RETURNING *`, vals);
    return rows[0] ? mapUser(rows[0]) : undefined;
  }

  // ── Friend Requests ────────────────────────────────────────────────────────
  async createFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest> {
    const { rows } = await pool.query("INSERT INTO friend_requests (from_user_id, to_user_id, status) VALUES ($1,$2,'pending') RETURNING *", [fromUserId, toUserId]);
    return mapFriendRequest(rows[0]);
  }
  async getPendingFriendRequests(userId: number): Promise<(FriendRequest & { fromUser?: User })[]> {
    const { rows } = await pool.query("SELECT * FROM friend_requests WHERE to_user_id=$1 AND status='pending' ORDER BY id DESC", [userId]);
    const enriched = [];
    for (const r of rows) {
      const fr = mapFriendRequest(r);
      const u = await this.getUser(fr.fromUserId);
      enriched.push({ ...fr, fromUser: u });
    }
    return enriched;
  }
  async getSentFriendRequests(userId: number): Promise<(FriendRequest & { toUser?: User })[]> {
    const { rows } = await pool.query("SELECT * FROM friend_requests WHERE from_user_id=$1 AND status='pending' ORDER BY id DESC", [userId]);
    const enriched = [];
    for (const r of rows) {
      const fr = mapFriendRequest(r);
      const u = await this.getUser(fr.toUserId);
      enriched.push({ ...fr, toUser: u });
    }
    return enriched;
  }
  async getAcceptedFriends(userId: number): Promise<User[]> {
    const { rows } = await pool.query(`
      SELECT u.* FROM users u INNER JOIN friend_requests fr ON
        (fr.from_user_id = $1 AND fr.to_user_id = u.id AND fr.status = 'accepted')
        OR (fr.to_user_id = $1 AND fr.from_user_id = u.id AND fr.status = 'accepted')
    `, [userId]);
    return rows.map(mapUser);
  }
  async updateFriendRequest(id: number, status: string): Promise<FriendRequest | undefined> {
    const { rows } = await pool.query("UPDATE friend_requests SET status=$1 WHERE id=$2 RETURNING *", [status, id]);
    return rows[0] ? mapFriendRequest(rows[0]) : undefined;
  }
  async removeFriendRequest(id: number): Promise<void> {
    await pool.query("DELETE FROM friend_requests WHERE id=$1", [id]);
  }
  async findExistingFriendRequest(fromUserId: number, toUserId: number): Promise<FriendRequest | undefined> {
    const { rows } = await pool.query(
      "SELECT * FROM friend_requests WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)",
      [fromUserId, toUserId]
    );
    return rows[0] ? mapFriendRequest(rows[0]) : undefined;
  }

  // ── Workout Invites ────────────────────────────────────────────────────────
  async createWorkoutInvite(inv: InsertWorkoutInvite): Promise<WorkoutInvite> {
    const { rows } = await pool.query(
      "INSERT INTO workout_invites (session_id, from_username, to_username, status) VALUES ($1,$2,$3,$4) RETURNING *",
      [inv.sessionId, inv.fromUsername, inv.toUsername, inv.status || "pending"]
    );
    return mapWorkoutInvite(rows[0]);
  }
  async getWorkoutInvitesForUser(username: string): Promise<WorkoutInvite[]> {
    const { rows } = await pool.query("SELECT * FROM workout_invites WHERE to_username=$1 AND status='pending' ORDER BY id DESC", [username]);
    return rows.map(mapWorkoutInvite);
  }
  async updateWorkoutInvite(id: number, status: string): Promise<WorkoutInvite | undefined> {
    const { rows } = await pool.query("UPDATE workout_invites SET status=$1 WHERE id=$2 RETURNING *", [status, id]);
    return rows[0] ? mapWorkoutInvite(rows[0]) : undefined;
  }
  async getWorkoutInvitesBySession(sessionId: number): Promise<WorkoutInvite[]> {
    const { rows } = await pool.query("SELECT * FROM workout_invites WHERE session_id=$1", [sessionId]);
    return rows.map(mapWorkoutInvite);
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  async createNotification(n: InsertNotification): Promise<Notification> {
    const { rows } = await pool.query(
      "INSERT INTO notifications (user_id, type, title, body, related_id, is_read) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [n.userId, n.type, n.title, n.body, n.relatedId ?? null, n.isRead ?? false]
    );
    return mapNotification(rows[0]);
  }
  async getNotificationsForUser(userId: number): Promise<Notification[]> {
    const { rows } = await pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC", [userId]);
    return rows.map(mapNotification);
  }
  async markNotificationRead(id: number): Promise<void> {
    await pool.query("UPDATE notifications SET is_read=true WHERE id=$1", [id]);
  }
  async getUnreadNotificationCount(userId: number): Promise<number> {
    const { rows } = await pool.query("SELECT COUNT(*) as cnt FROM notifications WHERE user_id=$1 AND is_read=false", [userId]);
    return parseInt(rows[0].cnt, 10);
  }
  async markAllNotificationsRead(userId: number): Promise<void> {
    await pool.query("UPDATE notifications SET is_read=true WHERE user_id=$1", [userId]);
  }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async getAllExercises(): Promise<Exercise[]> {
    const { rows } = await pool.query("SELECT * FROM exercises");
    return rows.map(mapExercise);
  }
  async getExercisesByMuscle(muscle: string): Promise<Exercise[]> {
    const { rows } = await pool.query("SELECT * FROM exercises WHERE primary_muscle=$1", [muscle]);
    return rows.map(mapExercise);
  }
  async getExercisesByEquipment(_equipment: string[]): Promise<Exercise[]> {
    return this.getAllExercises();
  }
  async seedExercises(exerciseList: InsertExercise[]): Promise<void> {
    for (const ex of exerciseList) {
      await pool.query(
        "INSERT INTO exercises (name, primary_muscle, secondary_muscles, equipment, workout_types, is_compound, instructions) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [ex.name, ex.primaryMuscle, ex.secondaryMuscles || "[]", ex.equipment || "[]", ex.workoutTypes || "[]", ex.isCompound ?? false, ex.instructions || ""]
      );
    }
  }
  async getExerciseCount(): Promise<number> {
    const { rows } = await pool.query("SELECT COUNT(*) as cnt FROM exercises");
    return parseInt(rows[0].cnt, 10);
  }

  // ── Workout Plans ──────────────────────────────────────────────────────────
  async createWorkoutPlan(p: InsertWorkoutPlan): Promise<WorkoutPlan> {
    const { rows } = await pool.query(
      "INSERT INTO workout_plans (name, user_id, exercises, workout_types, goal, estimated_duration, intensity, rest_between_sets, ai_reasoning) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [p.name, p.userId, p.exercises || "[]", p.workoutTypes || "[]", p.goal || "Muscle Gain", p.estimatedDuration ?? 45, p.intensity || "Moderate", p.restBetweenSets ?? 90, p.aiReasoning || ""]
    );
    return mapWorkoutPlan(rows[0]);
  }
  async getWorkoutPlan(id: number): Promise<WorkoutPlan | undefined> {
    const { rows } = await pool.query("SELECT * FROM workout_plans WHERE id=$1", [id]);
    return rows[0] ? mapWorkoutPlan(rows[0]) : undefined;
  }
  async getWorkoutPlansByUser(userId: number): Promise<WorkoutPlan[]> {
    const { rows } = await pool.query("SELECT * FROM workout_plans WHERE user_id=$1 ORDER BY id DESC", [userId]);
    return rows.map(mapWorkoutPlan);
  }

  // ── Workout Sessions ───────────────────────────────────────────────────────
  async createWorkoutSession(s: InsertWorkoutSession): Promise<WorkoutSession> {
    const { rows } = await pool.query(
      "INSERT INTO workout_sessions (plan_id, user_id, participant_usernames, creator_username, is_shared, started_at, completed_at, status, is_paused, current_rotation_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [s.planId, s.userId, s.participantUsernames || "[]", s.creatorUsername, s.isShared ?? false, s.startedAt ?? null, s.completedAt ?? null, s.status || "pending", s.isPaused ?? false, s.currentRotationIndex ?? 0]
    );
    return mapWorkoutSession(rows[0]);
  }
  async getWorkoutSession(id: number): Promise<WorkoutSession | undefined> {
    const { rows } = await pool.query("SELECT * FROM workout_sessions WHERE id=$1", [id]);
    return rows[0] ? mapWorkoutSession(rows[0]) : undefined;
  }
  async updateWorkoutSession(id: number, u: Partial<InsertWorkoutSession>): Promise<WorkoutSession | undefined> {
    const sets: string[] = []; const vals: any[] = []; let i = 1;
    if (u.status !== undefined) { sets.push(`status=$${i++}`); vals.push(u.status); }
    if (u.startedAt !== undefined) { sets.push(`started_at=$${i++}`); vals.push(u.startedAt); }
    if (u.completedAt !== undefined) { sets.push(`completed_at=$${i++}`); vals.push(u.completedAt); }
    if (u.isPaused !== undefined) { sets.push(`is_paused=$${i++}`); vals.push(u.isPaused); }
    if (u.currentRotationIndex !== undefined) { sets.push(`current_rotation_index=$${i++}`); vals.push(u.currentRotationIndex); }
    if (u.participantUsernames !== undefined) { sets.push(`participant_usernames=$${i++}`); vals.push(u.participantUsernames); }
    if (sets.length === 0) return this.getWorkoutSession(id);
    vals.push(id);
    const { rows } = await pool.query(`UPDATE workout_sessions SET ${sets.join(",")} WHERE id=$${i} RETURNING *`, vals);
    return rows[0] ? mapWorkoutSession(rows[0]) : undefined;
  }
  async getActiveSessionForUser(userId: number): Promise<WorkoutSession | undefined> {
    const { rows } = await pool.query("SELECT * FROM workout_sessions WHERE user_id=$1 AND status='active'", [userId]);
    return rows[0] ? mapWorkoutSession(rows[0]) : undefined;
  }

  // ── Exercise Logs ──────────────────────────────────────────────────────────
  async createExerciseLog(l: InsertExerciseLog): Promise<ExerciseLog> {
    const { rows } = await pool.query(
      "INSERT INTO exercise_logs (session_id, exercise_id, exercise_name, username, sets) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [l.sessionId, l.exerciseId, l.exerciseName, l.username, l.sets || "[]"]
    );
    return mapExerciseLog(rows[0]);
  }
  async getExerciseLogsBySession(sessionId: number): Promise<ExerciseLog[]> {
    const { rows } = await pool.query("SELECT * FROM exercise_logs WHERE session_id=$1", [sessionId]);
    return rows.map(mapExerciseLog);
  }
  async updateExerciseLog(id: number, u: Partial<InsertExerciseLog>): Promise<ExerciseLog | undefined> {
    const sets: string[] = []; const vals: any[] = []; let i = 1;
    if (u.sets !== undefined) { sets.push(`sets=$${i++}`); vals.push(u.sets); }
    if (sets.length === 0) return undefined;
    vals.push(id);
    const { rows } = await pool.query(`UPDATE exercise_logs SET ${sets.join(",")} WHERE id=$${i} RETURNING *`, vals);
    return rows[0] ? mapExerciseLog(rows[0]) : undefined;
  }

  // ── Workout History ────────────────────────────────────────────────────────
  async createWorkoutHistory(h: InsertWorkoutHistory): Promise<WorkoutHistory> {
    const { rows } = await pool.query(
      "INSERT INTO workout_history (user_id, plan_id, plan_name, total_volume, duration, muscles_worked, exercise_logs, was_shared, participant_count, ai_reasoning) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [h.userId, h.planId, h.planName || "", h.totalVolume ?? 0, h.duration ?? 0, h.musclesWorked || "[]", h.exerciseLogs || "[]", h.wasShared ?? false, h.participantCount ?? 1, h.aiReasoning || ""]
    );
    return mapWorkoutHistory(rows[0]);
  }
  async getWorkoutHistory(userId: number): Promise<WorkoutHistory[]> {
    const { rows } = await pool.query("SELECT * FROM workout_history WHERE user_id=$1 ORDER BY id DESC", [userId]);
    return rows.map(mapWorkoutHistory);
  }
  async getRecentWorkouts(userId: number, days: number): Promise<WorkoutHistory[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { rows } = await pool.query("SELECT * FROM workout_history WHERE user_id=$1 AND completed_at >= $2 ORDER BY id DESC", [userId, since]);
    return rows.map(mapWorkoutHistory);
  }
}
