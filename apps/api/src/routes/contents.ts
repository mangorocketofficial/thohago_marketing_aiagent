import { Router, type Response } from "express";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { asString, parseRequiredString } from "../lib/request-parsers";
import { supabaseAdmin } from "../lib/supabase-admin";

export type ContentBodyPatchInput = {
  body: string;
  expectedUpdatedAt: string | null;
};

type ContentBodyRow = {
  id: string;
  body: string;
  updated_at: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseOptionalIsoDateTime = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = asString(value, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "invalid_payload", `${field} must be a valid ISO datetime.`);
  }

  return normalized;
};

export const parseContentBodyPatchInput = (body: unknown): ContentBodyPatchInput => {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "invalid_payload", "Request body is required.");
  }

  const row = body as Record<string, unknown>;
  if (typeof row.body !== "string") {
    throw new HttpError(400, "invalid_payload", "body must be a string.");
  }
  if (row.body.length > 200_000) {
    throw new HttpError(400, "invalid_payload", "body is too long.");
  }

  return {
    body: row.body,
    expectedUpdatedAt: parseOptionalIsoDateTime(row.expected_updated_at, "expected_updated_at")
  };
};

const normalizeBodyRow = (value: unknown): ContentBodyRow => {
  const row = asRecord(value);
  const id = asString(row.id, "").trim();
  const updatedAt = asString(row.updated_at, "").trim();
  if (!id || !updatedAt) {
    throw new HttpError(500, "db_error", "Failed to normalize updated content row.");
  }

  return {
    id,
    body: typeof row.body === "string" ? row.body : "",
    updated_at: updatedAt
  };
};

const loadContentBodyRow = async (params: { orgId: string; contentId: string }): Promise<ContentBodyRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,body,updated_at")
    .eq("org_id", params.orgId)
    .eq("id", params.contentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load content row: ${error.message}`);
  }

  return data ? normalizeBodyRow(data) : null;
};

const updateContentBody = async (params: {
  orgId: string;
  contentId: string;
  input: ContentBodyPatchInput;
}): Promise<ContentBodyRow> => {
  const updatePayload = {
    body: params.input.body,
    updated_at: new Date().toISOString()
  };

  let query = supabaseAdmin
    .from("contents")
    .update(updatePayload)
    .eq("org_id", params.orgId)
    .eq("id", params.contentId);

  if (params.input.expectedUpdatedAt) {
    query = query.eq("updated_at", params.input.expectedUpdatedAt);
  }

  const { data, error } = await query.select("id,body,updated_at").maybeSingle();
  if (error) {
    throw new HttpError(500, "db_error", `Failed to update content body: ${error.message}`);
  }
  if (data) {
    return normalizeBodyRow(data);
  }

  const current = await loadContentBodyRow({
    orgId: params.orgId,
    contentId: params.contentId
  });
  if (!current) {
    throw new HttpError(404, "not_found", "Content not found.");
  }

  if (params.input.expectedUpdatedAt) {
    throw new HttpError(409, "version_conflict", "Content was updated by another request.", {
      content_id: params.contentId,
      expected_updated_at: params.input.expectedUpdatedAt,
      current_updated_at: current.updated_at
    });
  }

  throw new HttpError(409, "version_conflict", "Failed to update content body due to concurrent update.");
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

export const contentsRouter: Router = Router();

contentsRouter.patch("/orgs/:orgId/contents/:contentId/body", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const contentId = parseRequiredString(req.params.contentId, "contentId");
    const input = parseContentBodyPatchInput(req.body);
    const content = await updateContentBody({
      orgId,
      contentId,
      input
    });

    res.json({
      ok: true,
      content
    });
  } catch (error) {
    sendError(res, error);
  }
});
