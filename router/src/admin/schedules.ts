import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import {
  getSchedulesByGroup,
  getAllSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "../db/index.js";
import { getMappingGroupById, getProviderById } from "../db/index.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

const CreateScheduleSchema = Type.Object({
  mapping_group_id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  week: Type.String(),
  start_hour: Type.Number({ minimum: 0, maximum: 23 }),
  end_hour: Type.Number({ minimum: 1, maximum: 24 }),
  mapping_rule: Type.String(),
  concurrency_rule: Type.Optional(Type.String()),
  transform_rule: Type.Optional(Type.String()),
});

const UpdateScheduleSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  enabled: Type.Optional(Type.Number()),
  week: Type.Optional(Type.String()),
  start_hour: Type.Optional(Type.Number({ minimum: 0, maximum: 23 })),
  end_hour: Type.Optional(Type.Number({ minimum: 1, maximum: 24 })),
  mapping_rule: Type.Optional(Type.String()),
  concurrency_rule: Type.Optional(Type.String()),
  transform_rule: Type.Optional(Type.String()),
});

function validateMappingRule(db: Database.Database, ruleJson: string): string | undefined {
  let rule: unknown;
  try {
    rule = JSON.parse(ruleJson);
  } catch {
    return "Invalid mapping_rule JSON";
  }

  if (typeof rule !== "object" || rule === null) return "Invalid mapping_rule";
  const r = rule as { targets?: unknown[] };

  if (!Array.isArray(r.targets) || r.targets.length === 0) {
    return "mapping_rule.targets must be a non-empty array";
  }

  for (let i = 0; i < r.targets.length; i++) {
    const t = r.targets[i] as Record<string, unknown>;
    if (!t.backend_model || !t.provider_id) {
      return `targets[${i}] missing backend_model or provider_id`;
    }
    const p = getProviderById(db, t.provider_id as string);
    if (!p) return `targets[${i}] provider_id '${t.provider_id}' not found`;

    const hasOverflowProvider = !!t.overflow_provider_id;
    const hasOverflowModel = !!t.overflow_model;
    if (hasOverflowProvider && !hasOverflowModel) {
      return `targets[${i}]: overflow_provider_id requires overflow_model`;
    }
    if (hasOverflowModel && !hasOverflowProvider) {
      return `targets[${i}]: overflow_model requires overflow_provider_id`;
    }
    if (hasOverflowProvider) {
      const op = getProviderById(db, t.overflow_provider_id as string);
      if (!op) return `targets[${i}]: overflow_provider_id '${t.overflow_provider_id}' not found`;
    }
  }
  return undefined;
}

/** 解析 week JSON 为数字数组，失败返回 null */
const MAX_WEEK_DAY = 6;

function parseWeekSafe(weekJson: string): number[] | null {
  try {
    const arr = JSON.parse(weekJson);
    if (!Array.isArray(arr) || !arr.every((d: unknown) => typeof d === "number" && d >= 0 && d <= MAX_WEEK_DAY)) return null;
    return arr;
  } catch { return null; }
}

/** 检查同组 schedules 是否与 [startHour, endHour) 时段重叠（按星期交集判断） */
function checkOverlap(
  db: Database.Database,
  groupId: string,
  excludeId: string | undefined,
  weekDays: number[],
  startHour: number,
  endHour: number,
): string | undefined {
  const existing = getSchedulesByGroup(db, groupId);
  for (const s of existing) {
    if (excludeId && s.id === excludeId) continue;
    const sWeek = parseWeekSafe(s.week);
    if (!sWeek) continue;
    // 星期有交集 AND 时段有交集 才算重叠
    const weekOverlap = weekDays.some(d => sWeek.includes(d));
    const timeOverlap = startHour < s.end_hour && endHour > s.start_hour;
    if (weekOverlap && timeOverlap) {
      const days = weekDays.map(d => ["周日","周一","周二","周三","周四","周五","周六"][d]).join("、");
      return `时段与「${s.name}」重叠 (${days} ${formatHour(startHour)}-${formatHour(endHour)} vs ${formatHour(s.start_hour)}-${formatHour(s.end_hour)})`;
    }
  }
  return undefined;
}

const HOUR_PAD_WIDTH = 2;

function formatHour(h: number): string {
  return h.toString().padStart(HOUR_PAD_WIDTH, "0") + ":00";
}

interface ScheduleRoutesOptions {
  db: Database.Database;
}

export const adminScheduleRoutes: FastifyPluginCallback<ScheduleRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/schedules", async (_request, reply) => {
    const schedules = getAllSchedules(db);
    return reply.send(schedules);
  });

  app.get("/admin/api/schedules/group/:groupId", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const group = getMappingGroupById(db, groupId);
    if (!group) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Mapping group not found"));
    const schedules = getSchedulesByGroup(db, groupId);
    return reply.send(schedules);
  });

  app.post("/admin/api/schedules", { schema: { body: CreateScheduleSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateScheduleSchema>;

    const group = getMappingGroupById(db, body.mapping_group_id);
    if (!group) return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "mapping_group_id not found"));

    const ruleErr = validateMappingRule(db, body.mapping_rule);
    if (ruleErr) return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, ruleErr));

    if (body.concurrency_rule) {
      try {
        JSON.parse(body.concurrency_rule);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "Invalid concurrency_rule JSON"));
      }
    }

    if (body.transform_rule) {
      try {
        JSON.parse(body.transform_rule);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "Invalid transform_rule JSON"));
      }
    }

    if (body.start_hour >= body.end_hour) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "start_hour must be < end_hour"));
    }

    const weekDays = parseWeekSafe(body.week);
    if (!weekDays) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "week must be array of 0-6"));
    }

    const overlapErr = checkOverlap(db, body.mapping_group_id, undefined, weekDays, body.start_hour, body.end_hour);
    if (overlapErr) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, overlapErr));
    }

    const id = createSchedule(db, {
      mapping_group_id: body.mapping_group_id,
      name: body.name,
      week: body.week,
      start_hour: body.start_hour,
      end_hour: body.end_hour,
      mapping_rule: body.mapping_rule,
      concurrency_rule: body.concurrency_rule,
      transform_rule: body.transform_rule,
    });
    return reply.code(HTTP_CREATED).send({ id });
  });

  app.put("/admin/api/schedules/:id", { schema: { body: UpdateScheduleSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Static<typeof UpdateScheduleSchema>;
    const existing = getScheduleById(db, id);
    if (!existing) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Schedule not found"));

    const mappingRule = body.mapping_rule ?? existing.mapping_rule;
    const ruleErr = validateMappingRule(db, mappingRule);
    if (ruleErr) return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, ruleErr));

    if (body.concurrency_rule) {
      try {
        JSON.parse(body.concurrency_rule);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "Invalid concurrency_rule JSON"));
      }
    }

    if (body.transform_rule) {
      try {
        JSON.parse(body.transform_rule);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "Invalid transform_rule JSON"));
      }
    }

    const startH = body.start_hour ?? existing.start_hour;
    const endH = body.end_hour ?? existing.end_hour;
    if (startH >= endH) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "start_hour must be < end_hour"));
    }

    // 时段重叠校验（仅在 week 或 start/end 有变更时）
    if (body.week !== undefined || body.start_hour !== undefined || body.end_hour !== undefined) {
      const weekDays = parseWeekSafe(body.week ?? existing.week);
      if (!weekDays) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "week must be array of 0-6"));
      }
      const overlapErr = checkOverlap(db, existing.mapping_group_id, id, weekDays, startH, endH);
      if (overlapErr) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, overlapErr));
      }
    }

    const fields: Record<string, unknown> = {};
    const UPDATE_FIELDS = ["name", "enabled", "week", "start_hour", "end_hour", "mapping_rule", "concurrency_rule", "transform_rule"] as const;
    const bodyObj = body as Record<string, unknown>;
    for (const key of UPDATE_FIELDS) {
      if (bodyObj[key] !== undefined) fields[key] = bodyObj[key];
    }

    updateSchedule(db, id, fields);
    return reply.send({ success: true });
  });

  app.delete("/admin/api/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getScheduleById(db, id);
    if (!existing) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Schedule not found"));
    deleteSchedule(db, id);
    return reply.send({ success: true });
  });

  app.post("/admin/api/schedules/:id/toggle", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getScheduleById(db, id);
    if (!existing) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Schedule not found"));
    const newEnabled = existing.enabled ? 0 : 1;
    updateSchedule(db, id, { enabled: newEnabled });
    return reply.send({ success: true, enabled: newEnabled });
  });

  done();
};
