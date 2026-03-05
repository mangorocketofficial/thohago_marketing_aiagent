import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { getTemplate } from "../media/templates/registry";
import type { TemplateId } from "../media/templates/schema";

export const DEFAULT_TEMPLATE_ID: TemplateId = "center-image-bottom-text";
export const STORAGE_BUCKET = "content-images-private";
export const SIGNED_URL_TTL_SECONDS = 30 * 60;

export type InstagramContentRow = {
  id: string;
  orgId: string;
  body: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type ResolvedImageSelection = {
  fileIds: string[];
  paths: string[];
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => !!entry)
    : [];

const isTemplateId = (value: string): value is TemplateId =>
  value === "center-image-bottom-text" ||
  value === "fullscreen-overlay" ||
  value === "collage-2x2" ||
  value === "text-only-gradient" ||
  value === "split-image-text";

const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

export const normalizeTemplateId = (candidate: unknown, fallback: TemplateId): TemplateId => {
  const normalized = asString(candidate, "").trim();
  if (!normalized || !isTemplateId(normalized)) {
    return fallback;
  }
  return getTemplate(normalized) ? normalized : fallback;
};

export const normalizeOverlayText = (value: unknown, fallback: string, maxLength: number): string => {
  const normalized = asString(value, fallback).trim();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, maxLength);
};

export const resolveRequestId = (clientRequestId: unknown): string => {
  const value = asString(clientRequestId, "").trim();
  if (!value) {
    return randomUUID();
  }
  return value.slice(0, 120);
};

export const resolveStorageRef = (params: {
  orgId: string;
  contentId: string;
  metadata: Record<string, unknown>;
}): { bucket: string; path: string; contentType: string } => {
  const storage = asRecord(params.metadata.composed_image_storage);
  return {
    bucket: asString(storage.bucket, STORAGE_BUCKET).trim() || STORAGE_BUCKET,
    path: asString(storage.path, "").trim() || `${params.orgId}/${params.contentId}/composed.png`,
    contentType: asString(storage.content_type, "image/png").trim() || "image/png"
  };
};

export const buildSignedUrlPayload = async (params: {
  bucket: string;
  path: string;
}): Promise<{ signedImageUrl: string; expiresAt: string }> => {
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const signed = await supabaseAdmin.storage.from(params.bucket).createSignedUrl(params.path, SIGNED_URL_TTL_SECONDS);
  const signedImageUrl = asString(signed.data?.signedUrl, "").trim();
  if (!signedImageUrl) {
    throw new HttpError(500, "storage_sign_failed", "Failed to create signed url.");
  }

  return {
    signedImageUrl,
    expiresAt
  };
};

export const loadInstagramContentRow = async (params: {
  orgId: string;
  contentId: string;
}): Promise<InstagramContentRow> => {
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,org_id,channel,content_type,body,metadata,updated_at")
    .eq("org_id", params.orgId)
    .eq("id", params.contentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load instagram content: ${error.message}`);
  }
  if (!data) {
    throw new HttpError(404, "not_found", "Content not found.");
  }

  const row = asRecord(data);
  if (asString(row.channel, "").trim().toLowerCase() !== "instagram") {
    throw new HttpError(400, "invalid_payload", "content is not an instagram draft.");
  }
  if (asString(row.content_type, "").trim().toLowerCase() !== "image") {
    throw new HttpError(400, "invalid_payload", "content_type must be image for instagram re-compose.");
  }

  const id = asString(row.id, "").trim();
  const orgId = asString(row.org_id, "").trim();
  const updatedAt = asString(row.updated_at, "").trim();
  if (!id || !orgId || !updatedAt) {
    throw new HttpError(500, "db_error", "Failed to normalize instagram content row.");
  }

  return {
    id,
    orgId,
    body: asString(row.body, ""),
    metadata: asRecord(row.metadata),
    updatedAt
  };
};

const resolveImagePathsByFileIds = async (params: {
  orgId: string;
  imageFileIds: string[];
}): Promise<ResolvedImageSelection> => {
  const normalizedIds = dedupeStrings(params.imageFileIds.map((entry) => entry.trim()).filter(Boolean)).slice(0, 8);
  if (normalizedIds.length === 0) {
    return {
      fileIds: [],
      paths: []
    };
  }

  const { data, error } = await supabaseAdmin
    .from("local_files")
    .select("id,file_path,status")
    .eq("org_id", params.orgId)
    .eq("file_type", "image")
    .in("id", normalizedIds);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to resolve image_file_ids: ${error.message}`);
  }

  const byId = new Map<string, string>();
  for (const row of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
    const id = asString(row.id, "").trim();
    const filePath = asString(row.file_path, "").trim();
    const status = asString(row.status, "active").trim().toLowerCase();
    if (!id || !filePath || status === "deleted") {
      continue;
    }
    byId.set(id, filePath);
  }

  const missing = normalizedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, "invalid_payload", "One or more image_file_ids are invalid.", {
      missing_image_file_ids: missing
    });
  }

  return {
    fileIds: normalizedIds,
    paths: normalizedIds.map((id) => byId.get(id) as string)
  };
};

export const resolveEffectiveImageSelection = async (params: {
  orgId: string;
  requestImageFileIds: string[] | null | undefined;
  metadata: Record<string, unknown>;
}): Promise<ResolvedImageSelection> => {
  if (Array.isArray(params.requestImageFileIds)) {
    return resolveImagePathsByFileIds({
      orgId: params.orgId,
      imageFileIds: params.requestImageFileIds
    });
  }

  const metadataImageFileIds = asStringArray(params.metadata.image_file_ids);
  if (metadataImageFileIds.length > 0) {
    try {
      return await resolveImagePathsByFileIds({
        orgId: params.orgId,
        imageFileIds: metadataImageFileIds
      });
    } catch {
      // Fall through to legacy path list.
    }
  }

  return {
    fileIds: metadataImageFileIds,
    paths: asStringArray(params.metadata.image_paths)
  };
};

export const validateImageSlotCount = (params: {
  requiredImageCount: number;
  providedImageCount: number;
}): void => {
  if (params.requiredImageCount <= 0 || params.requiredImageCount === params.providedImageCount) {
    return;
  }
  throw new HttpError(422, "invalid_payload", "Invalid image slot count for selected template.", {
    requiredImageCount: params.requiredImageCount,
    providedImageCount: params.providedImageCount
  });
};
