import { Router } from "express";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
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

const parseRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} is required.`);
  }
  return value.trim();
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

  const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
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
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
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
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
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
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});
