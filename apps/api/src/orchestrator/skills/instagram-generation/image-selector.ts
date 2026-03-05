import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { asRecord, asString, type InstagramImageMode } from "./types";
import { rankAndSelectCandidates, type ImageSelectionCandidate } from "./image-selection-ranking";

const IMAGE_INDEX_TABLE = "activity_image_indexes";

export type ActivityImageEntry = {
  fileId: string;
  fileName: string;
  relativePath: string;
  fileSize: number | null;
  detectedAt: string | null;
};

export type ImageSelectionResult = {
  mode: InstagramImageMode;
  selectedImages: ActivityImageEntry[];
  selectionSource: "manual_selection" | "index_activity_folder" | "index_org_fallback" | "recency_fallback" | "none";
  telemetryReason: string | null;
};

const isMissingTableError = (error: unknown, tableName: string): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes(tableName.toLowerCase()) &&
    (normalized.includes("could not find the table") || normalized.includes("does not exist"))
  );
};

const parseDateMs = (value: unknown): number => {
  const parsed = new Date(asString(value, "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseFileSize = (value: unknown): number | null => {
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

const parseStringArray = (value: unknown, maxItems = 32): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => asString(entry, "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

const parseSafety = (value: unknown): Record<string, string> => {
  const row = asRecord(value);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(row)) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = asString(entry, "").trim().toLowerCase();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    result[normalizedKey] = normalizedValue;
    if (Object.keys(result).length >= 24) {
      break;
    }
  }
  return result;
};

const toActivityImageEntry = (row: Record<string, unknown>): ActivityImageEntry | null => {
  const status = asString(row.status, "").trim().toLowerCase();
  if (status === "deleted") {
    return null;
  }

  const fileId = asString(row.id, "").trim();
  const fileName = asString(row.file_name, "").trim();
  const relativePath = asString(row.source_id, "").trim();
  if (!fileId || !relativePath) {
    return null;
  }

  return {
    fileId,
    fileName: fileName || relativePath.split("/").pop() || relativePath,
    relativePath,
    fileSize: parseFileSize(row.file_size_bytes),
    detectedAt: asString(row.file_modified_at, "").trim() || asString(row.indexed_at, "").trim() || null
  };
};

const toSelectionCandidate = (row: Record<string, unknown>): ImageSelectionCandidate | null => {
  const base = toActivityImageEntry(row);
  if (!base) {
    return null;
  }

  return {
    ...base,
    modifiedAtMs: parseDateMs(row.file_modified_at) || parseDateMs(row.indexed_at),
    searchText: asString(row.search_text, "").trim(),
    sceneTags: parseStringArray(row.scene_tags),
    safety: parseSafety(row.safety_json),
    fileContentHash: asString(row.file_content_hash, "").trim() || null
  };
};

const listCandidates = async (params: {
  orgId: string;
  activityFolder?: string | null;
  statuses: string[];
  limit: number;
}): Promise<ImageSelectionCandidate[]> => {
  let query = supabaseAdmin
    .from(IMAGE_INDEX_TABLE)
    .select(
      "id,source_id,file_name,file_size_bytes,file_modified_at,indexed_at,status,search_text,scene_tags,safety_json,file_content_hash"
    )
    .eq("org_id", params.orgId)
    .eq("is_latest", true)
    .in("status", params.statuses)
    .order("file_modified_at", { ascending: false, nullsFirst: false })
    .order("indexed_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(200, params.limit)));

  const activityFolder = typeof params.activityFolder === "string" ? params.activityFolder.trim() : "";
  if (activityFolder) {
    query = query.eq("activity_folder", activityFolder);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error, IMAGE_INDEX_TABLE)) {
      console.warn(`[INSTAGRAM_SKILL] ${IMAGE_INDEX_TABLE} table is unavailable; continuing with fallback mode.`);
      return [];
    }
    throw new HttpError(500, "db_error", `Failed to list image index candidates: ${error.message}`);
  }

  return (Array.isArray(data) ? data : [])
    .map((entry) => toSelectionCandidate(asRecord(entry)))
    .filter((entry): entry is ImageSelectionCandidate => !!entry);
};

export const listActivityImages = async (params: {
  orgId: string;
  activityFolder?: string | null;
  limit?: number;
}): Promise<ActivityImageEntry[]> => {
  const candidates = await listCandidates({
    orgId: params.orgId,
    activityFolder: params.activityFolder,
    statuses: ["ready", "failed"],
    limit: params.limit ?? 40
  });
  return candidates.map((entry) => ({
    fileId: entry.fileId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    fileSize: entry.fileSize,
    detectedAt: entry.detectedAt
  }));
};

const normalizeManualSelection = (values?: string[]): string[] =>
  Array.isArray(values) ? values.map((entry) => entry.trim().toLowerCase()).filter(Boolean) : [];

const asEntryList = (candidates: ImageSelectionCandidate[]): ActivityImageEntry[] =>
  candidates.map((entry) => ({
    fileId: entry.fileId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    fileSize: entry.fileSize,
    detectedAt: entry.detectedAt
  }));

export const selectImagesForInstagram = async (params: {
  orgId: string;
  activityFolder: string;
  topic: string;
  mode: InstagramImageMode;
  requiredCount: number;
  manualSelections?: string[];
}): Promise<ImageSelectionResult> => {
  if (params.mode === "text_only" || params.requiredCount <= 0) {
    return {
      mode: params.mode,
      selectedImages: [],
      selectionSource: "none",
      telemetryReason: null
    };
  }

  const requiredCount = Math.max(1, Math.min(4, params.requiredCount));
  const activityImages = await listActivityImages({
    orgId: params.orgId,
    activityFolder: params.activityFolder,
    limit: 120
  });

  if (params.mode === "manual") {
    const manual = normalizeManualSelection(params.manualSelections);
    if (!manual.length) {
      return {
        mode: "manual",
        selectedImages: activityImages.slice(0, requiredCount),
        selectionSource: "manual_selection",
        telemetryReason: null
      };
    }

    const matched = activityImages.filter((image) => {
      const fileName = image.fileName.toLowerCase();
      const relativePath = image.relativePath.toLowerCase();
      return manual.includes(fileName) || manual.includes(relativePath);
    });

    return {
      mode: "manual",
      selectedImages: (matched.length ? matched : activityImages).slice(0, requiredCount),
      selectionSource: "manual_selection",
      telemetryReason: null
    };
  }

  const queryText = `${params.topic}\nactivity_folder:${params.activityFolder}`;
  const folderCandidates = await listCandidates({
    orgId: params.orgId,
    activityFolder: params.activityFolder,
    statuses: ["ready"],
    limit: 200
  });
  if (folderCandidates.length > 0) {
    const selected = rankAndSelectCandidates({
      queryText,
      requiredCount,
      candidates: folderCandidates
    });
    if (selected.length > 0) {
      return {
        mode: "auto",
        selectedImages: asEntryList(selected).slice(0, requiredCount),
        selectionSource: "index_activity_folder",
        telemetryReason: null
      };
    }
  }

  const orgCandidates = await listCandidates({
    orgId: params.orgId,
    statuses: ["ready"],
    limit: 200
  });
  if (orgCandidates.length > 0) {
    const selected = rankAndSelectCandidates({
      queryText,
      requiredCount,
      candidates: orgCandidates
    });
    if (selected.length > 0) {
      return {
        mode: "auto",
        selectedImages: asEntryList(selected).slice(0, requiredCount),
        selectionSource: "index_org_fallback",
        telemetryReason: "image_index_unavailable:activity_folder_scope_empty"
      };
    }
  }

  if (activityImages.length > 0) {
    return {
      mode: "auto",
      selectedImages: activityImages.slice(0, requiredCount),
      selectionSource: "recency_fallback",
      telemetryReason: "image_index_unavailable:ready_index_missing"
    };
  }

  const orgImages = await listActivityImages({
    orgId: params.orgId,
    limit: 120
  });
  return {
    mode: "auto",
    selectedImages: orgImages.slice(0, requiredCount),
    selectionSource: orgImages.length > 0 ? "recency_fallback" : "none",
    telemetryReason: "image_index_unavailable"
  };
};
