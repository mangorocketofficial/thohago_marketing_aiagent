import { Router, type Response } from "express";
import { getTemplate } from "@repo/media-engine";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { asRecord, asString, parseOptionalString, parseRequiredString } from "../lib/request-parsers";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  DEFAULT_TEMPLATE_ID,
  loadInstagramContentRow,
  normalizeOverlayTextMap,
  normalizeTemplateId,
  resolveEffectiveImageSelection,
  validateImageSlotCount
} from "../orchestrator/instagram-editor-shared";

export type ContentBodyPatchInput = {
  body: string;
  expectedUpdatedAt: string | null;
};

export type ContentInstagramMetadataPatchInput = {
  templateId: string | null;
  overlayTexts: Record<string, string> | undefined;
  imageFileIds: string[] | undefined;
  expectedUpdatedAt: string | null;
};

type ContentBodyRow = {
  id: string;
  body: string;
  updated_at: string;
};

type ContentMetadataRow = {
  id: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

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

const parseOptionalStringArray = (value: unknown, field: string, maxItems = 8): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_payload", `${field} must be an array of strings.`);
  }

  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => !!entry);

  if (normalized.length > maxItems) {
    throw new HttpError(400, "invalid_payload", `${field} must contain at most ${maxItems} values.`);
  }

  return normalized;
};

const parseOptionalStringMap = (value: unknown, field: string): Record<string, string> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_payload", `${field} must be an object.`);
  }

  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const id = key.trim();
    if (!id) {
      continue;
    }
    if (typeof entry !== "string") {
      throw new HttpError(400, "invalid_payload", `${field}.${id} must be a string.`);
    }
    map[id] = entry;
  }
  return map;
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

export const parseInstagramMetadataPatchInput = (body: unknown): ContentInstagramMetadataPatchInput => {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "invalid_payload", "Request body is required.");
  }

  const row = body as Record<string, unknown>;

  return {
    templateId: parseOptionalString(row.template_id),
    overlayTexts: parseOptionalStringMap(row.overlay_texts, "overlay_texts"),
    imageFileIds: parseOptionalStringArray(row.image_file_ids, "image_file_ids"),
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

const normalizeMetadataRow = (value: unknown): ContentMetadataRow => {
  const row = asRecord(value);
  const id = asString(row.id, "").trim();
  const updatedAt = asString(row.updated_at, "").trim();
  if (!id || !updatedAt) {
    throw new HttpError(500, "db_error", "Failed to normalize updated metadata row.");
  }

  return {
    id,
    metadata: asRecord(row.metadata),
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

const loadContentMetadataRow = async (params: { orgId: string; contentId: string }): Promise<ContentMetadataRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,metadata,updated_at")
    .eq("org_id", params.orgId)
    .eq("id", params.contentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load content metadata row: ${error.message}`);
  }

  return data ? normalizeMetadataRow(data) : null;
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

  let query = supabaseAdmin.from("contents").update(updatePayload).eq("org_id", params.orgId).eq("id", params.contentId);
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

const updateInstagramMetadata = async (params: {
  orgId: string;
  contentId: string;
  input: ContentInstagramMetadataPatchInput;
}): Promise<ContentMetadataRow> => {
  const content = await loadInstagramContentRow({
    orgId: params.orgId,
    contentId: params.contentId
  });

  const fallbackTemplateId = normalizeTemplateId(content.metadata.template_id, DEFAULT_TEMPLATE_ID);
  const templateId = normalizeTemplateId(params.input.templateId, fallbackTemplateId);
  if (params.input.templateId && params.input.templateId !== templateId) {
    throw new HttpError(400, "invalid_payload", `Unsupported template_id: ${params.input.templateId}`);
  }
  const template = getTemplate(templateId);
  if (!template) {
    throw new HttpError(400, "invalid_payload", `Unsupported template_id: ${templateId}`);
  }

  const selection = await resolveEffectiveImageSelection({
    orgId: params.orgId,
    requestImageFileIds: params.input.imageFileIds,
    metadata: content.metadata
  });
  const requiredImageCount = template.overlays.photos.length;
  validateImageSlotCount({
    requiredImageCount,
    providedImageCount: selection.paths.length
  });

  const currentOverlayTexts = normalizeOverlayTextMap(content.metadata.overlay_texts, {});
  const overlayTexts = normalizeOverlayTextMap(params.input.overlayTexts, currentOverlayTexts);
  const firstTextId = template.overlays.texts[0]?.id ?? null;
  const secondTextId = template.overlays.texts[1]?.id ?? null;
  const overlayMain = firstTextId ? asString(overlayTexts[firstTextId], "").trim() : "";
  const overlaySub = secondTextId ? asString(overlayTexts[secondTextId], "").trim() : "";

  const nextMetadata: Record<string, unknown> = {
    ...content.metadata,
    template_id: templateId,
    overlay_main: overlayMain,
    overlay_sub: overlaySub,
    overlay_texts: overlayTexts,
    image_file_ids: selection.fileIds,
    image_paths: selection.paths,
    composed_locally: true,
    local_cache_path: `.instagram-cache/${params.contentId}/composed.png`
  };

  const updatedAt = new Date().toISOString();
  let query = supabaseAdmin
    .from("contents")
    .update({
      metadata: nextMetadata,
      updated_at: updatedAt
    })
    .eq("org_id", params.orgId)
    .eq("id", params.contentId);
  if (params.input.expectedUpdatedAt) {
    query = query.eq("updated_at", params.input.expectedUpdatedAt);
  }

  const { data, error } = await query.select("id,metadata,updated_at").maybeSingle();
  if (error) {
    throw new HttpError(500, "db_error", `Failed to update instagram metadata: ${error.message}`);
  }
  if (data) {
    return normalizeMetadataRow(data);
  }

  const current = await loadContentMetadataRow({
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

  throw new HttpError(409, "version_conflict", "Failed to update instagram metadata due to concurrent update.");
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

contentsRouter.patch("/orgs/:orgId/contents/:contentId/instagram-metadata", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const contentId = parseRequiredString(req.params.contentId, "contentId");
    const input = parseInstagramMetadataPatchInput(req.body);
    const content = await updateInstagramMetadata({
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
