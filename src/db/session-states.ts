import Database from "better-sqlite3";
import { randomUUID } from "crypto";

// --- Types ---

export interface SessionModelState {
  id: string;
  router_key_id: string;
  router_key_name?: string;
  session_id: string;
  current_model: string;
  original_model: string | null;
  last_active_at: string;
  created_at: string;
}

export interface SessionModelHistory {
  id: string;
  router_key_id: string;
  session_id: string;
  old_model: string | null;
  new_model: string;
  trigger_type: string;
  created_at: string;
}

export interface UpsertSessionStateInput {
  id?: string;
  router_key_id: string;
  session_id: string;
  current_model: string;
  original_model?: string | null;
}

export interface InsertSessionHistoryInput {
  router_key_id: string;
  session_id: string;
  old_model?: string | null;
  new_model: string;
  trigger_type: string;
}

// --- CRUD ---

export function getSessionStates(db: Database.Database): SessionModelState[] {
  return db.prepare(
    `SELECT sms.*, rk.name AS router_key_name
     FROM session_model_states sms
     JOIN router_keys rk ON rk.id = sms.router_key_id
     ORDER BY sms.last_active_at DESC`
  ).all() as SessionModelState[];
}

export function getSessionHistory(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
): SessionModelHistory[] {
  return db.prepare(
    `SELECT * FROM session_model_history
     WHERE router_key_id = ? AND session_id = ?
     ORDER BY created_at DESC`
  ).all(routerKeyId, sessionId) as SessionModelHistory[];
}

export function upsertSessionState(
  db: Database.Database,
  input: UpsertSessionStateInput,
): string {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();

  db.prepare(
    `INSERT INTO session_model_states (id, router_key_id, session_id, current_model, original_model, last_active_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(router_key_id, session_id) DO UPDATE SET
       current_model = excluded.current_model,
       original_model = excluded.original_model,
       last_active_at = excluded.last_active_at`
  ).run(
    id,
    input.router_key_id,
    input.session_id,
    input.current_model,
    input.original_model ?? null,
    now,
    now,
  );

  return id;
}

export function insertSessionHistory(
  db: Database.Database,
  input: InsertSessionHistoryInput,
): string {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO session_model_history (id, router_key_id, session_id, old_model, new_model, trigger_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.router_key_id,
    input.session_id,
    input.old_model ?? null,
    input.new_model,
    input.trigger_type,
    now,
  );

  return id;
}

export function deleteSessionState(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
): void {
  db.prepare(
    `DELETE FROM session_model_states WHERE router_key_id = ? AND session_id = ?`
  ).run(routerKeyId, sessionId);
}

export function getSessionState(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
): SessionModelState | undefined {
  return db.prepare(
    `SELECT * FROM session_model_states WHERE router_key_id = ? AND session_id = ?`
  ).get(routerKeyId, sessionId) as SessionModelState | undefined;
}
