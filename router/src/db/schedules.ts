import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";

export interface Schedule {
  id: string;
  mapping_group_id: string;
  name: string;
  enabled: number;
  week: string;
  start_hour: number;
  end_hour: number;
  mapping_rule: string;
  concurrency_rule: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

const SCHEDULE_FIELDS = new Set([
  "mapping_group_id", "name", "enabled", "week",
  "start_hour", "end_hour", "mapping_rule", "concurrency_rule",
]);

export function getSchedulesByGroup(db: Database.Database, mappingGroupId: string): Schedule[] {
  return db
    .prepare("SELECT * FROM schedules WHERE mapping_group_id = ? ORDER BY created_at ASC")
    .all(mappingGroupId) as Schedule[];
}

export function getActiveSchedulesForGroup(db: Database.Database, mappingGroupId: string): Schedule[] {
  return db
    .prepare("SELECT * FROM schedules WHERE mapping_group_id = ? AND enabled = 1 ORDER BY created_at ASC")
    .all(mappingGroupId) as Schedule[];
}

export function getScheduleById(db: Database.Database, id: string): Schedule | undefined {
  return db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Schedule | undefined;
}

export function getAllSchedules(db: Database.Database): Schedule[] {
  return db.prepare("SELECT * FROM schedules ORDER BY created_at DESC").all() as Schedule[];
}

export function createSchedule(
  db: Database.Database,
  data: {
    mapping_group_id: string;
    name: string;
    week: string;
    start_hour: number;
    end_hour: number;
    mapping_rule: string;
    concurrency_rule?: string;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id, data.mapping_group_id, data.name,
    data.week, data.start_hour, data.end_hour,
    data.mapping_rule, data.concurrency_rule ?? null,
    now, now,
  );
  return id;
}

export function updateSchedule(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Schedule, "name" | "enabled" | "week" | "start_hour" | "end_hour" | "mapping_rule" | "concurrency_rule">>,
): void {
  const now = new Date().toISOString();
  buildUpdateQuery(db, "schedules", id, fields as Record<string, unknown>, SCHEDULE_FIELDS);
  db.prepare("UPDATE schedules SET updated_at = ? WHERE id = ?").run(now, id);
}

export function deleteSchedule(db: Database.Database, id: string): void {
  deleteById(db, "schedules", id);
}

export function deleteSchedulesByGroup(db: Database.Database, mappingGroupId: string): void {
  db.prepare("DELETE FROM schedules WHERE mapping_group_id = ?").run(mappingGroupId);
}
