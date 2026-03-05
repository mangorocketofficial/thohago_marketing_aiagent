import { Router } from "express";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { asRecord, asString, parseOptionalString, parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";
const IMAGE_INDEX_STATUSES = new Set(["ready", "failed"]);
const DELETE_STATUS = "deleted";
type NormalizedVisionPayload = {
  schemaVersion: string;
  summaryText: string;
  sceneTags: string[];
  objects: Array<{ label: string; confidence: number }>;
  ocrText: string | null;
  ocrLanguage: string | null;
  safety: Record<string, string>;
};
const parseRequiredBodyString = (value: unknown, field: string): string =>
  parseRequiredString(value, field, { code: "invalid_body" });
const normalizeText = (value: unknown, maxLength: number): string => {
  const normalized = asString(value, "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, maxLength);
};
const parseOptionalIsoDateTime = (value: unknown, field: string): string | null => {
  const normalized = parseOptionalString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "invalid_body", `${field} must be a valid ISO datetime.`);
  }
  return normalized;
};
const parseOptionalNonNegativeInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
};
const parseStatus = (value: unknown): "ready" | "failed" => {
  const normalized = parseRequiredBodyString(value, "status").toLowerCase();
  if (!IMAGE_INDEX_STATUSES.has(normalized)) {
    throw new HttpError(400, "invalid_body", "status must be ready or failed.");
  }
  return normalized as "ready" | "failed";
};
const parseSceneTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const tag = normalizeText(entry, 64).toLowerCase();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
    if (result.length >= 32) {
      break;
    }
  }
  return result;
};
const parseObjects = (value: unknown): Array<{ label: string; confidence: number }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<{ label: string; confidence: number }> = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const label = normalizeText(row.label, 64).toLowerCase();
    if (!label) {
      continue;
    }
    const confidenceRaw =
      typeof row.confidence === "number"
        ? row.confidence
        : typeof row.confidence === "string"
          ? Number.parseFloat(row.confidence)
          : 0;
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
    result.push({
      label,
      confidence
    });
    if (result.length >= 64) {
      break;
    }
  }
  return result;
};
const parseSafety = (value: unknown): Record<string, string> => {
  const row = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(row)) {
    const normalizedKey = normalizeText(key, 48).toLowerCase();
    if (!normalizedKey) {
      continue;
    }
    const normalizedValue = normalizeText(rawValue, 48).toLowerCase();
    if (!normalizedValue) {
      continue;
    }
    out[normalizedKey] = normalizedValue;
    if (Object.keys(out).length >= 24) {
      break;
    }
  }
  return out;
};
const parseVisionPayload = (value: unknown): NormalizedVisionPayload | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const row = asRecord(value);
  const schemaVersion = parseRequiredString(row.schema_version, "vision_payload.schema_version", { code: "invalid_body" });
  const summaryText = normalizeText(row.summary_text, 3_000);

  return {
    schemaVersion,
    summaryText,
    sceneTags: parseSceneTags(row.scene_tags),
    objects: parseObjects(row.objects),
    ocrText: (() => {
      const text = normalizeText(row.ocr_text, 12_000);
      return text || null;
    })(),
    ocrLanguage: (() => {
      const value = normalizeText(row.ocr_language, 16).toLowerCase();
      return value || null;
    })(),
    safety: parseSafety(row.safety)
  };
};
const buildSearchText = (vision: NormalizedVisionPayload | null): string => {
  if (!vision) {
    return "";
  }

  return [vision.summaryText, vision.sceneTags.join(" "), vision.objects.map((entry) => entry.label).join(" "), vision.ocrText ?? ""]
    .join(" ")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 12_000);
};
export const imageIndexRouter: Router = Router();
imageIndexRouter.post("/image-index/upsert", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }
  try {
    const orgId = parseRequiredBodyString(req.body?.org_id, "org_id");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }
    const sourceId = parseRequiredBodyString(req.body?.source_id, "source_id");
    const activityFolder = parseRequiredBodyString(req.body?.activity_folder, "activity_folder");
    const fileName = parseRequiredBodyString(req.body?.file_name, "file_name");
    const fileModifiedAt = parseOptionalIsoDateTime(req.body?.file_modified_at, "file_modified_at");
    const fileSizeBytes = parseOptionalNonNegativeInt(req.body?.file_size_bytes);
    const fileContentHash = parseRequiredBodyString(req.body?.file_content_hash, "file_content_hash").toLowerCase();
    const status = parseStatus(req.body?.status);
    const lastError = normalizeText(req.body?.last_error, 1_000) || null;
    const visionModel = normalizeText(req.body?.vision_model, 120) || null;
    const visionPayload = parseVisionPayload(req.body?.vision_payload);
    if (status === "ready" && !visionPayload) {
      throw new HttpError(400, "invalid_body", "vision_payload is required when status=ready.");
    }
    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from("activity_image_indexes")
      .upsert(
        {
          org_id: orgId,
          source_id: sourceId,
          activity_folder: activityFolder,
          file_name: fileName,
          file_size_bytes: fileSizeBytes,
          file_modified_at: fileModifiedAt,
          file_content_hash: fileContentHash,
          status,
          last_error: status === "failed" ? lastError ?? "vision_index_failed" : null,
          vision_model: visionModel,
          schema_version: visionPayload?.schemaVersion ?? null,
          summary_text: visionPayload?.summaryText ?? null,
          objects_json: visionPayload?.objects ?? [],
          scene_tags: visionPayload?.sceneTags ?? [],
          ocr_text: visionPayload?.ocrText ?? null,
          ocr_language: visionPayload?.ocrLanguage ?? null,
          safety_json: visionPayload?.safety ?? {},
          search_text: buildSearchText(visionPayload),
          is_latest: true,
          indexed_at: new Date().toISOString()
        },
        {
          onConflict: "org_id,source_id,file_content_hash"
        }
      )
      .select("id")
      .single();
    if (upsertError || !upserted) {
      throw new HttpError(500, "db_error", `Failed to upsert image index row: ${upsertError?.message ?? "unknown"}`);
    }
    const currentRowId = parseRequiredString(asRecord(upserted).id, "id", { code: "db_error" });
    const { error: demoteError } = await supabaseAdmin
      .from("activity_image_indexes")
      .update({
        is_latest: false
      })
      .eq("org_id", orgId)
      .eq("source_id", sourceId)
      .neq("id", currentRowId)
      .eq("is_latest", true);
    if (demoteError) {
      throw new HttpError(500, "db_error", `Failed to update latest image index pointer: ${demoteError.message}`);
    }
    res.status(201).json({
      ok: true,
      id: currentRowId,
      status
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
imageIndexRouter.post("/image-index/delete", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }
  try {
    const orgId = parseRequiredBodyString(req.body?.org_id, "org_id");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }
    const sourceId = parseRequiredBodyString(req.body?.source_id, "source_id");
    const { data, error } = await supabaseAdmin
      .from("activity_image_indexes")
      .update({
        status: DELETE_STATUS,
        last_error: null,
        indexed_at: new Date().toISOString()
      })
      .eq("org_id", orgId)
      .eq("source_id", sourceId)
      .eq("is_latest", true)
      .select("id");
    if (error) {
      throw new HttpError(500, "db_error", `Failed to soft-delete image index rows: ${error.message}`);
    }
    res.json({
      ok: true,
      deleted_count: Array.isArray(data) ? data.length : 0
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
