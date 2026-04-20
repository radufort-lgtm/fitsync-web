/**
 * PostgreSQL storage implementation.
 * Used when DATABASE_URL env var is set (e.g. Render Postgres).
 * Implements the same IStorage interface as the SQLite version.
 */
import { Pool } from "pg";
import type { IStorage } from "./storage";
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Schema bootstrap ───────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      height_cm REAL,
      weight_kg REAL,
      goals TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT now()::text
    );
    CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT now()::text
    );
    CREATE TABLE IF NOT EXISTS workout_invites (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      from_username TEXT NOT NULL,
      to_username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT now()::text
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      related_id INTEGER,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT now()::text
    );
    CREATE TABLE IF NOT EXISTS exercises (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      primary_muscle TEXT NOT NULL,
      secondary_muscles TEXT NOT NULL DEFAULT '[]',
      equipment TEXT NOT NULL DEFAULT '[]',
      workout_types TEXT NOT NULL DEFAULT '[]',
      is_compound BOOLEAN NOT NULL DEFAULT FALSE,
      instructions TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS workout_plans (
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
      created_at TEXT NOT NULL DEFAULT now()::text
    );
    CREATE TABLE IF NOT EXISTS workout_sessions (
      id SERIAL PRIMARY KEY,
      plan_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      participant_usernames TEXT NOT NULL DEFAULT '[]',
      creator_username TEXT NOT NULL,
      is_shared BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      is_paused BOOLEAN NOT NULL DEFAULT FALSE,
      current_rotation_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS exercise_logs (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      username TEXT NOT NULL,
      sets TEXT NOT NULL DEFAULT '[]',
      timestamp TEXT NOT NULL DEFAULT now()::text
    );
    CREATE TABLE IF NOT EXISTS workout_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      plan_name TEXT NOT NULL DEFAULT '',
      total_volume REAL NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0,
      muscles_worked TEXT NOT NULL DEFAULT '[]',
      exercise_logs TEXT NOT NULL DEFAULT '[]',
      was_shared BOOLEAN NOT NULL DEFAULT FALSE,
      participant_count INTEGER NOT NULL DEFAULT 1,
      ai_reasoning TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT now()::text
    );
  `);
  console.log("[storage-pg] Schema ready");
}

// Helper: map raw PG row → User
function rowToUser(r: any): User {
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    phone: r.phone || "", heightCm: r.height_cm, weightKg: r.weight_kg,
    goals: r.goals, createdAt: r.created_at,
  };
}
function rowToFR(r: any): FriendRequest {
  return { id: r.id, fromUserId: r.from_user_id, toUserId: r.to_user_id, status: r.status, createdAt: r.created_at };
}
function rowToInvite(r: any): WorkoutInvite {
  return { id: r.id, sessionId: r.session_id, fromUsername: r.from_username, toUsername: r.to_username, status: r.status, createdAt: r.created_at };
}
function rowToNotif(r: any): Notification {
  return { id: r.id, userId: r.user_id, type: r.type, title: r.title, body: r.body, relatedId: r.related_id, isRead: r.is_read, createdAt: r.created_at };
}
function rowToExercise(r: any): Exercise {
  return { id: r.id, name: r.name, primaryMuscle: r.primary_muscle, secondaryMuscles: r.secondary_muscles, equipment: r.equipment, workoutTypes: r.workout_types, isCompound: r.is_compound, instructions: r.instructions };
}
function rowToPlan(r: any): WorkoutPlan {
  return { id: r.id, name: r.name, userId: r.user_id, exercises: r.exercises, workoutTypes: r.workout_types, goal: r.goal, estimatedDuration: r.estimated_duration, intensity: r.intensity, restBetweenSets: r.rest_between_sets, aiReasoning: r.ai_reasoning, createdAt: r.created_at };
}
function rowToSession(r: any): WorkoutSession {
  return { id: r.id, planId: r.plan_id, userId: r.user_id, participantUsernames: r.participant_usernames, creatorUsername: r.creator_username, isShared: r.is_shared, startedAt: r.started_at, completedAt: r.completed_at, status: r.status, isPaused: r.is_paused, currentRotationIndex: r.current_rotation_index };
}
function rowToLog(r: any): ExerciseLog {
  return { id: r.id, sessionId: r.session_id, exerciseId: r.exercise_id, exerciseName: r.exercise_name, username: r.username, sets: r.sets, timestamp: r.timestamp };
}
function rowToHistory(r: any): WorkoutHistory {
  return { id: r.id, userId: r.user_id, planId: r.plan_id, planName: r.plan_name, totalVolume: r.total_volume, duration: r.duration, musclesWorked: r.muscles_worked, exerciseLogs: r.exercise_logs, wasShared: r.was_shared, participantCount: r.participant_count, aiReasoning: r.ai_reasoning, completedAt: r.completed_at };
}

export class PgStorage implements IStorage {
  async init() { await initSchema(); }

  // ── Users ──────────────────────────────────────────────────────────────────
  async getUser(id: number) {
    const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  async getUserByUsername(username: string) {
    const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  async getUserByPhone(phone: string) {
    const { rows } = await pool.query("SELECT * FROM users WHERE phone=$1", [phone]);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  async createUser(u: InsertUser) {
    const { rows } = await pool.query(
      "INSERT INTO users (username,display_name,phone,height_cm,weight_kg,goals) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [u.username, u.displayName, u.phone || "", u.heightCm ?? null, u.weightKg ?? null, u.goals || "[]"]
    );
    return rowToUser(rows[0]);
  }
  async updateUser(id: number, u: Partial<InsertUser>) {
    const sets: string[] = [], vals: any[] = [];
    if (u.displayName !== undefined) { sets.push(`display_name=$${sets.length+1}`); vals.push(u.displayName); }
    if (u.heightCm !== undefined) { sets.push(`height_cm=$${sets.length+1}`); vals.push(u.heightCm); }
    if (u.weightKg !== undefined) { sets.push(`weight_kg=$${sets.length+1}`); vals.push(u.weightKg); }
    if (u.goals !== undefined) { sets.push(`goals=$${sets.length+1}`); vals.push(u.goals); }
    if (sets.length === 0) return this.getUser(id);
    vals.push(id);
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`, vals);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  // ── Friend Requests ────────────────────────────────────────────────────────
  async createFriendRequest(fromUserId: number, toUserId: number) {
    const { rows } = await pool.query(
      "INSERT INTO friend_requests (from_user_id,to_user_id,status) VALUES ($1,$2,'pending') RETURNING *",
      [fromUserId, toUserId]
    );
    return rowToFR(rows[0]);
  }
  async getPendingFriendRequests(userId: number) {
    const { rows } = await pool.query(
      "SELECT * FROM friend_requests WHERE to_user_id=$1 AND status='pending' ORDER BY id DESC", [userId]
    );
    const enriched = [];
    for (const r of rows) {
      const fr = rowToFR(r);
      const fromUser = await this.getUser(fr.fromUserId);
      enriched.push({ ...fr, fromUser });
    }
    return enriched;
  }
  async getSentFriendRequests(userId: number) {
    const { rows } = await pool.query(
      "SELECT * FROM friend_requests WHERE from_user_id=$1 AND status='pending' ORDER BY id DESC", [userId]
    );
    const enriched = [];
    for (const r of rows) {
      const fr = rowToFR(r);
      const toUser = await this.getUser(fr.toUserId);
      enriched.push({ ...fr, toUser });
    }
    return enriched;
  }
  async getAcceptedFriends(userId: number) {
    const { rows } = await pool.query(`
      SELECT u.* FROM users u
      INNER JOIN friend_requests fr ON
        (fr.from_user_id=$1 AND fr.to_user_id=u.id AND fr.status='accepted')
        OR (fr.to_user_id=$1 AND fr.from_user_id=u.id AND fr.status='accepted')
    `, [userId]);
    return rows.map(rowToUser);
  }
  async updateFriendRequest(id: number, status: string) {
    const { rows } = await pool.query("UPDATE friend_requests SET status=$1 WHERE id=$2 RETURNING *", [status, id]);
    return rows[0] ? rowToFR(rows[0]) : undefined;
  }
  async removeFriendRequest(id: number) {
    await pool.query("DELETE FROM friend_requests WHERE id=$1", [id]);
  }
  async findExistingFriendRequest(fromUserId: number, toUserId: number) {
    const { rows } = await pool.query(
      "SELECT * FROM friend_requests WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1) LIMIT 1",
      [fromUserId, toUserId]
    );
    return rows[0] ? rowToFR(rows[0]) : undefined;
  }
  async unfriendUsers(userId1: number, userId2: number) {
    await pool.query(
      "DELETE FROM friend_requests WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)",
      [userId1, userId2]
    );
  }

  // ── Workout Invites ────────────────────────────────────────────────────────
  async createWorkoutInvite(invite: InsertWorkoutInvite) {
    const { rows } = await pool.query(
      "INSERT INTO workout_invites (session_id,from_username,to_username,status) VALUES ($1,$2,$3,$4) RETURNING *",
      [invite.sessionId, invite.fromUsername, invite.toUsername, invite.status || "pending"]
    );
    return rowToInvite(rows[0]);
  }
  async getWorkoutInvitesForUser(username: string) {
    const { rows } = await pool.query(
      "SELECT * FROM workout_invites WHERE to_username=$1 AND status='pending' ORDER BY id DESC", [username]
    );
    return rows.map(rowToInvite);
  }
  async updateWorkoutInvite(id: number, status: string) {
    const { rows } = await pool.query("UPDATE workout_invites SET status=$1 WHERE id=$2 RETURNING *", [status, id]);
    return rows[0] ? rowToInvite(rows[0]) : undefined;
  }
  async getWorkoutInvitesBySession(sessionId: number) {
    const { rows } = await pool.query("SELECT * FROM workout_invites WHERE session_id=$1", [sessionId]);
    return rows.map(rowToInvite);
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  async createNotification(n: InsertNotification) {
    const { rows } = await pool.query(
      "INSERT INTO notifications (user_id,type,title,body,related_id,is_read) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [n.userId, n.type, n.title, n.body, n.relatedId ?? null, n.isRead ?? false]
    );
    return rowToNotif(rows[0]);
  }
  async getNotificationsForUser(userId: number) {
    const { rows } = await pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC", [userId]);
    return rows.map(rowToNotif);
  }
  async markNotificationRead(id: number) {
    await pool.query("UPDATE notifications SET is_read=TRUE WHERE id=$1", [id]);
  }
  async getUnreadNotificationCount(userId: number) {
    const { rows } = await pool.query("SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE", [userId]);
    return parseInt(rows[0].count, 10);
  }
  async markAllNotificationsRead(userId: number) {
    await pool.query("UPDATE notifications SET is_read=TRUE WHERE user_id=$1", [userId]);
  }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async getAllExercises() {
    const { rows } = await pool.query("SELECT * FROM exercises");
    return rows.map(rowToExercise);
  }
  async getExerciseById(id: number) {
    const { rows } = await pool.query("SELECT * FROM exercises WHERE id=$1", [id]);
    return rows[0] ? rowToExercise(rows[0]) : undefined;
  }
  async getExercisesByMuscle(muscle: string) {
    const { rows } = await pool.query("SELECT * FROM exercises WHERE primary_muscle=$1", [muscle]);
    return rows.map(rowToExercise);
  }
  async getExercisesByEquipment(_equipment: string[]) {
    return this.getAllExercises();
  }
  async seedExercises(list: InsertExercise[]) {
    const { rows: existing } = await pool.query("SELECT name FROM exercises");
    const existingNames = new Set(existing.map((r: any) => r.name));
    for (const ex of list) {
      if (!existingNames.has(ex.name)) {
        await pool.query(
          "INSERT INTO exercises (name,primary_muscle,secondary_muscles,equipment,workout_types,is_compound,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [ex.name, ex.primaryMuscle, ex.secondaryMuscles || "[]", ex.equipment || "[]", ex.workoutTypes || "[]", ex.isCompound ?? false, ex.instructions || ""]
        );
      }
    }
  }
  async getExerciseCount() {
    const { rows } = await pool.query("SELECT COUNT(*) FROM exercises");
    return parseInt(rows[0].count, 10);
  }
  async updateExerciseInstructions(id: number, instructions: string) {
    await pool.query("UPDATE exercises SET instructions=$1 WHERE id=$2", [instructions, id]);
  }

  // ── Workout Plans ──────────────────────────────────────────────────────────
  async createWorkoutPlan(plan: InsertWorkoutPlan) {
    const { rows } = await pool.query(
      "INSERT INTO workout_plans (name,user_id,exercises,workout_types,goal,estimated_duration,intensity,rest_between_sets,ai_reasoning) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [plan.name, plan.userId, plan.exercises || "[]", plan.workoutTypes || "[]", plan.goal || "Muscle Gain", plan.estimatedDuration || 45, plan.intensity || "Moderate", plan.restBetweenSets || 90, plan.aiReasoning || ""]
    );
    return rowToPlan(rows[0]);
  }
  async getWorkoutPlan(id: number) {
    const { rows } = await pool.query("SELECT * FROM workout_plans WHERE id=$1", [id]);
    return rows[0] ? rowToPlan(rows[0]) : undefined;
  }
  async getWorkoutPlansByUser(userId: number) {
    const { rows } = await pool.query("SELECT * FROM workout_plans WHERE user_id=$1 ORDER BY id DESC", [userId]);
    return rows.map(rowToPlan);
  }

  // ── Workout Sessions ───────────────────────────────────────────────────────
  async createWorkoutSession(session: InsertWorkoutSession) {
    const { rows } = await pool.query(
      "INSERT INTO workout_sessions (plan_id,user_id,participant_usernames,creator_username,is_shared,status,is_paused,current_rotation_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [session.planId, session.userId, session.participantUsernames || "[]", session.creatorUsername, session.isShared ?? false, session.status || "pending", session.isPaused ?? false, session.currentRotationIndex ?? 0]
    );
    return rowToSession(rows[0]);
  }
  async getWorkoutSession(id: number) {
    const { rows } = await pool.query("SELECT * FROM workout_sessions WHERE id=$1", [id]);
    return rows[0] ? rowToSession(rows[0]) : undefined;
  }
  async updateWorkoutSession(id: number, updates: Partial<InsertWorkoutSession>) {
    const sets: string[] = [], vals: any[] = [];
    const fieldMap: Record<string, string> = {
      status: "status", isPaused: "is_paused", startedAt: "started_at",
      completedAt: "completed_at", currentRotationIndex: "current_rotation_index",
      participantUsernames: "participant_usernames",
    };
    for (const [k, col] of Object.entries(fieldMap)) {
      if ((updates as any)[k] !== undefined) {
        sets.push(`${col}=$${sets.length + 1}`);
        vals.push((updates as any)[k]);
      }
    }
    if (sets.length === 0) return this.getWorkoutSession(id);
    vals.push(id);
    const { rows } = await pool.query(`UPDATE workout_sessions SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`, vals);
    return rows[0] ? rowToSession(rows[0]) : undefined;
  }
  async getActiveSessionForUser(userId: number) {
    const { rows } = await pool.query("SELECT * FROM workout_sessions WHERE user_id=$1 AND status='active' LIMIT 1", [userId]);
    return rows[0] ? rowToSession(rows[0]) : undefined;
  }

  // ── Exercise Logs ──────────────────────────────────────────────────────────
  async createExerciseLog(log: InsertExerciseLog) {
    const { rows } = await pool.query(
      "INSERT INTO exercise_logs (session_id,exercise_id,exercise_name,username,sets) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [log.sessionId, log.exerciseId, log.exerciseName, log.username, log.sets || "[]"]
    );
    return rowToLog(rows[0]);
  }
  async getExerciseLogsBySession(sessionId: number) {
    const { rows } = await pool.query("SELECT * FROM exercise_logs WHERE session_id=$1", [sessionId]);
    return rows.map(rowToLog);
  }
  async updateExerciseLog(id: number, updates: Partial<InsertExerciseLog>) {
    const { rows } = await pool.query("UPDATE exercise_logs SET sets=$1 WHERE id=$2 RETURNING *", [updates.sets || "[]", id]);
    return rows[0] ? rowToLog(rows[0]) : undefined;
  }

  // ── Workout History ────────────────────────────────────────────────────────
  async createWorkoutHistory(h: InsertWorkoutHistory) {
    const { rows } = await pool.query(
      "INSERT INTO workout_history (user_id,plan_id,plan_name,total_volume,duration,muscles_worked,exercise_logs,was_shared,participant_count,ai_reasoning) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [h.userId, h.planId, h.planName || "", h.totalVolume || 0, h.duration || 0, h.musclesWorked || "[]", h.exerciseLogs || "[]", h.wasShared ?? false, h.participantCount || 1, h.aiReasoning || ""]
    );
    return rowToHistory(rows[0]);
  }
  async getWorkoutHistory(userId: number) {
    const { rows } = await pool.query("SELECT * FROM workout_history WHERE user_id=$1 ORDER BY id DESC", [userId]);
    return rows.map(rowToHistory);
  }
  async getRecentWorkouts(userId: number, days: number) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { rows } = await pool.query(
      "SELECT * FROM workout_history WHERE user_id=$1 AND completed_at>=$2 ORDER BY id DESC",
      [userId, since]
    );
    return rows.map(rowToHistory);
  }
}
