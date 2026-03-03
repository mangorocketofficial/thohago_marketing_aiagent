import { Router } from "express";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";
import { getActiveSessionForOrg, getSessionById, resumeSession } from "../orchestrator/service";
import type { ResumeEventRequest, ResumeEventType } from "../orchestrator/types";

const SUPPORTED_EVENTS = new Set<ResumeEventType>([
  "user_message",
  "campaign_approved",
  "content_approved",
  "campaign_rejected",
  "content_rejected"
]);

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
    if (eventType !== "campaign_rejected" && eventType !== "content_rejected") {
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

  const idempotencyKey =
    typeof row.idempotency_key === "string" && row.idempotency_key.trim() ? row.idempotency_key.trim() : undefined;

  return {
    event_type: eventType,
    payload,
    idempotency_key: idempotencyKey
  };
};

export const sessionsRouter: Router = Router();

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
  }
});
