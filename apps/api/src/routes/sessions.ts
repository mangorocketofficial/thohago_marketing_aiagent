import { Router, type Response } from "express";
import { requireApiSecret, requireUserJwt } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { getTemplateSummaries } from "../media/templates/registry";
import { parseOptionalString, parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";
import { parseRescheduleSlotRequest } from "../scheduler/http/reschedule-slot-request";
import { parseScheduledContentDayQuery } from "../scheduler/http/scheduled-content-day-query";
import {
  encodeScheduledContentCursor,
  parseScheduledContentQuery
} from "../scheduler/http/scheduled-content-query";
import { listActiveCampaignSummaries } from "../scheduler/queries/list-active-campaign-summaries";
import { listScheduledContentBySlotWindow } from "../scheduler/queries/list-scheduled-content";
import { rescheduleScheduleSlot } from "../scheduler/queries/reschedule-schedule-slot";
import {
  createSessionForOrg,
  getActiveSessionForOrg,
  getRecommendedSessionForWorkspace,
  getSessionById,
  listWorkspaceInboxItemsForOrg,
  listSessionsForOrg,
  resumeSession
} from "../orchestrator/service";
import { listActivityImages } from "../orchestrator/skills/instagram-generation/image-selector";
import type { ResumeEventRequest, ResumeEventType, SessionListCursor, SessionStatus } from "../orchestrator/types";
import { getSkillRegistry } from "../orchestrator/skills/router";

const SUPPORTED_EVENTS = new Set<ResumeEventType>([
  "user_message",
  "content_approved",
  "content_rejected"
]);

const SESSION_STATUSES: SessionStatus[] = ["running", "paused", "done", "failed"];
const SESSION_STATUS_SET = new Set<SessionStatus>(SESSION_STATUSES);

const asQueryString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
};

const parseOptionalPositiveInt = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < 1) {
    throw new HttpError(400, "invalid_payload", `${field} must be a positive integer.`);
  }
  return candidate;
};

const parseBoundedInt = (value: unknown, field: string, defaults: { fallback: number; min: number; max: number }): number => {
  const parsed = parseOptionalPositiveInt(value, field);
  if (parsed === undefined) {
    return defaults.fallback;
  }
  return Math.max(defaults.min, Math.min(defaults.max, parsed));
};

const parseBooleanQuery = (value: unknown, fallback: boolean): boolean => {
  const normalized = asQueryString(value);
  if (!normalized) {
    return fallback;
  }
  const lowered = normalized.toLowerCase();
  if (lowered === "true" || lowered === "1") {
    return true;
  }
  if (lowered === "false" || lowered === "0") {
    return false;
  }
  throw new HttpError(400, "invalid_payload", "archived must be true/false.");
};

const parseOptionalBoolean = (value: unknown, field: string, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = `${value}`.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new HttpError(400, "invalid_payload", `${field} must be true/false.`);
};

const parseSessionStatuses = (value: unknown): SessionStatus[] => {
  const candidates: string[] = [];

  if (typeof value === "string") {
    candidates.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      candidates.push(...entry.split(",").map((piece) => piece.trim()).filter(Boolean));
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const result: SessionStatus[] = [];
  for (const entry of candidates) {
    if (!SESSION_STATUS_SET.has(entry as SessionStatus)) {
      throw new HttpError(400, "invalid_payload", `Unsupported status filter: ${entry}`);
    }
    result.push(entry as SessionStatus);
  }

  return [...new Set(result)];
};

const parseCursor = (value: unknown): SessionListCursor | null => {
  const encoded = asQueryString(value);
  if (!encoded) {
    return null;
  }

  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const updatedAt = parseRequiredString(parsed.updated_at, "cursor.updated_at");
    const id = parseRequiredString(parsed.id, "cursor.id");
    return {
      updated_at: updatedAt,
      id
    };
  } catch {
    throw new HttpError(400, "invalid_payload", "cursor is invalid.");
  }
};

const encodeCursor = (cursor: SessionListCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const parseResumeEvent = (body: unknown): ResumeEventRequest => {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "invalid_payload", "Request body is required.");
  }

  const row = body as Record<string, unknown>;
  const eventType = parseRequiredString(row.event_type, "event_type") as ResumeEventType;
  if (!SUPPORTED_EVENTS.has(eventType)) {
    throw new HttpError(400, "invalid_payload", `Unsupported event_type: ${eventType}`);
  }

  const payloadRaw = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
  const payload: Record<string, unknown> = { ...payloadRaw };

  if (payload.mode !== undefined && payload.mode !== null && `${payload.mode}`.trim()) {
    const mode = `${payload.mode}`.trim().toLowerCase();
    if (mode !== "revision") {
      throw new HttpError(400, "invalid_payload", "payload.mode must be \"revision\" when provided.");
    }
    if (eventType !== "content_rejected") {
      throw new HttpError(400, "invalid_payload", "payload.mode is only allowed for reject events.");
    }
    payload.mode = "revision";

    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (!reason) {
      throw new HttpError(400, "invalid_payload", "payload.reason is required when payload.mode is \"revision\".");
    }
    payload.reason = reason;
  } else if (payload.mode !== undefined) {
    delete payload.mode;
  }

  const expectedVersion = parseOptionalPositiveInt(payload.expected_version, "payload.expected_version");
  if (expectedVersion === undefined) {
    delete payload.expected_version;
  } else {
    payload.expected_version = expectedVersion;
  }

  const skillTriggerRaw = typeof payload.skill_trigger === "string" ? payload.skill_trigger.trim().toLowerCase() : "";
  if (!skillTriggerRaw) {
    delete payload.skill_trigger;
  } else {
    if (!/^[a-z0-9_:-]{2,64}$/.test(skillTriggerRaw)) {
      throw new HttpError(400, "invalid_payload", "payload.skill_trigger format is invalid.");
    }
    payload.skill_trigger = skillTriggerRaw;
  }

  const idempotencyKey =
    typeof row.idempotency_key === "string" && row.idempotency_key.trim() ? row.idempotency_key.trim() : undefined;

  return {
    event_type: eventType,
    payload,
    idempotency_key: idempotencyKey
  };
};

const sendError = (res: Response, error: unknown): void => {
  const httpError = toHttpError(error);
  const body: {
    ok: false;
    error: string;
    message: string;
    details?: Record<string, unknown>;
  } = {
    ok: false,
    error: httpError.code,
    message: httpError.message
  };
  if (httpError.details) {
    body.details = httpError.details;
  }

  res.status(httpError.status).json({
    ...body
  });
};

export const sessionsRouter: Router = Router();

sessionsRouter.get("/orgs/:orgId/sessions", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const limit = parseBoundedInt(req.query.limit, "limit", { fallback: 20, min: 1, max: 50 });
    const cursor = parseCursor(req.query.cursor);
    const workspaceType = parseOptionalString(asQueryString(req.query.workspace_type));
    const scopeIdRaw = asQueryString(req.query.scope_id);
    const scopeId = scopeIdRaw === null ? undefined : parseOptionalString(scopeIdRaw);
    const statuses = parseSessionStatuses(req.query.status);
    const includeArchived = parseBooleanQuery(req.query.archived, false);

    const rows = await listSessionsForOrg({
      orgId,
      limit: limit + 1,
      cursor,
      workspaceType,
      scopeId,
      statuses,
      includeArchived
    });

    const hasMore = rows.length > limit;
    const sessions = hasMore ? rows.slice(0, limit) : rows;
    const last = sessions[sessions.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ updated_at: last.updated_at, id: last.id }) : null;

    res.json({
      ok: true,
      sessions,
      next_cursor: nextCursor
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.post("/orgs/:orgId/sessions", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const workspaceType = parseRequiredString(req.body?.workspace_type, "workspace_type");
    const scopeId = parseOptionalString(req.body?.scope_id);
    const title = parseOptionalString(req.body?.title);
    const startPaused = parseOptionalBoolean(req.body?.start_paused, "start_paused", true);
    const forceNew = parseOptionalBoolean(req.body?.force_new, "force_new", false);

    let createdByUserId: string | null = null;
    if ((req.header("authorization") ?? "").trim()) {
      const user = await requireUserJwt(req, res);
      if (!user) {
        return;
      }
      createdByUserId = user.userId;
    }

    const result = await createSessionForOrg({
      orgId,
      workspaceType,
      scopeId,
      title,
      createdByUserId,
      startPaused,
      forceNew
    });

    res.status(result.reused ? 200 : 201).json({
      ok: true,
      reused: result.reused,
      session: result.session
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/sessions/recommended", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const workspaceType = parseRequiredString(asQueryString(req.query.workspace_type), "workspace_type");
    const scopeId = parseOptionalString(asQueryString(req.query.scope_id));
    const session = await getRecommendedSessionForWorkspace({
      orgId,
      workspaceType,
      scopeId
    });

    res.json({
      ok: true,
      session
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/workspace-inbox-items", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const limit = parseBoundedInt(req.query.limit, "limit", { fallback: 50, min: 1, max: 100 });
    const items = await listWorkspaceInboxItemsForOrg({
      orgId,
      limit
    });

    res.json({
      ok: true,
      items
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/scheduled-content/day", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const parsed = parseScheduledContentDayQuery(req.query as Record<string, unknown>);
    const result = await listScheduledContentBySlotWindow({
      orgId,
      startDate: parsed.date,
      endDate: parsed.date,
      timezone: parsed.timezone,
      campaignId: parsed.campaignId,
      channel: parsed.channel,
      status: parsed.status,
      limit: parsed.limit,
      cursor: parsed.cursor
    });

    res.json({
      ok: true,
      items: result.items,
      page: {
        next_cursor: result.page.nextCursor ? encodeScheduledContentCursor(result.page.nextCursor) : null,
        has_more: result.page.hasMore
      },
      query: {
        timezone: result.query.timezone,
        date: parsed.date
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/scheduled-content", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const parsed = parseScheduledContentQuery(req.query as Record<string, unknown>);
    const result = await listScheduledContentBySlotWindow({
      orgId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      timezone: parsed.timezone,
      campaignId: parsed.campaignId,
      channel: parsed.channel,
      status: parsed.status,
      limit: parsed.limit,
      cursor: parsed.cursor
    });

    res.json({
      ok: true,
      items: result.items,
      page: {
        next_cursor: result.page.nextCursor ? encodeScheduledContentCursor(result.page.nextCursor) : null,
        has_more: result.page.hasMore
      },
      query: {
        timezone: result.query.timezone,
        start_date: result.query.startDate,
        end_date: result.query.endDate
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.patch("/orgs/:orgId/schedule-slots/:slotId/reschedule", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const slotId = parseRequiredString(req.params.slotId, "slotId");
    const parsed = parseRescheduleSlotRequest(req.body);
    const result = await rescheduleScheduleSlot({
      orgId,
      slotId,
      targetDate: parsed.targetDate,
      targetTime: parsed.targetTime,
      timezone: parsed.timezone,
      idempotencyKey: parsed.idempotencyKey,
      windowStart: parsed.windowStart,
      windowEnd: parsed.windowEnd
    });

    res.json({
      ok: true,
      slot: result.slot,
      window: result.window,
      query: result.query,
      idempotency_key: result.idempotency_key
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/campaigns/active-summaries", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const items = await listActiveCampaignSummaries(orgId);
    res.json({
      ok: true,
      items
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/skills", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  const registry = getSkillRegistry();
  const items = registry.getAll().map((skill) => ({
    id: skill.id,
    display_name: skill.displayName,
    version: skill.version
  }));

  res.json({
    ok: true,
    items
  });
});

sessionsRouter.get("/orgs/:orgId/templates/instagram", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const templates = getTemplateSummaries();
    res.json({
      ok: true,
      templates
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/activity-images", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const activityFolder = parseOptionalString(asQueryString(req.query.activity_folder));
    if (!activityFolder) {
      throw new HttpError(400, "invalid_payload", "activity_folder query is required.");
    }

    const limit = parseBoundedInt(req.query.limit, "limit", {
      fallback: 40,
      min: 1,
      max: 100
    });

    const images = await listActivityImages({
      orgId,
      activityFolder,
      limit
    });

    res.json({
      ok: true,
      images: images.map((image) => ({
        fileId: image.fileId,
        fileName: image.fileName,
        relativePath: image.relativePath,
        fileSize: image.fileSize,
        detectedAt: image.detectedAt
      }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.post("/sessions/:sessionId/resume", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const sessionId = parseRequiredString(req.params.sessionId, "sessionId");
    const session = await getSessionById(sessionId);
    if (!session) {
      throw new HttpError(404, "not_found", "Session not found.");
    }
    if (!(await requireActiveSubscription(res, session.org_id))) {
      return;
    }

    const event = parseResumeEvent(req.body);
    const result = await resumeSession(sessionId, event);

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/sessions/:sessionId", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const sessionId = parseRequiredString(req.params.sessionId, "sessionId");
    const session = await getSessionById(sessionId);
    if (!session) {
      throw new HttpError(404, "not_found", "Session not found.");
    }

    res.json({
      ok: true,
      session
    });
  } catch (error) {
    sendError(res, error);
  }
});

sessionsRouter.get("/orgs/:orgId/sessions/active", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const session = await getActiveSessionForOrg(orgId);
    res.json({
      ok: true,
      session
    });
  } catch (error) {
    sendError(res, error);
  }
});
