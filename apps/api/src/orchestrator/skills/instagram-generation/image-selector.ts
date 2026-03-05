import path from "node:path";
import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { callWithFallback } from "../../llm-client";
import { asRecord, asString, type InstagramImageMode } from "./types";

export type ActivityImageEntry = {
  fileId: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  fileSize: number | null;
  detectedAt: string | null;
};

export type ImageSelectionResult = {
  mode: InstagramImageMode;
  selectedImages: ActivityImageEntry[];
};

/**
 * List recent image files from local_files for activity folder.
 */
export const listActivityImages = async (params: {
  orgId: string;
  activityFolder: string;
  limit?: number;
}): Promise<ActivityImageEntry[]> => {
  const activityFolder = params.activityFolder.trim();
  if (!activityFolder) {
    return [];
  }

  const limit = Math.max(1, Math.min(100, params.limit ?? 40));
  const { data, error } = await supabaseAdmin
    .from("local_files")
    .select("id,file_name,file_path,file_size,indexed_at,status,activity_folder")
    .eq("org_id", params.orgId)
    .eq("file_type", "image")
    .eq("activity_folder", activityFolder)
    .order("indexed_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to list activity images: ${error.message}`);
  }

  return (Array.isArray(data) ? data : [])
    .map((row) => {
      const record = asRecord(row);
      const status = asString(record.status, "active").toLowerCase();
      if (status === "deleted") {
        return null;
      }

      const filePath = asString(record.file_path).trim();
      const fileName = asString(record.file_name).trim() || path.basename(filePath);
      const folder = asString(record.activity_folder, activityFolder).trim() || activityFolder;

      return {
        fileId: asString(record.id).trim(),
        fileName,
        filePath,
        relativePath: toRelativePath(filePath, folder, fileName),
        fileSize: typeof record.file_size === "number" && Number.isFinite(record.file_size) ? record.file_size : null,
        detectedAt: asString(record.indexed_at).trim() || null
      } satisfies ActivityImageEntry;
    })
    .filter((entry): entry is ActivityImageEntry => !!entry && !!entry.fileId && !!entry.filePath);
};

/**
 * Select relevant images based on selected mode.
 */
export const selectImagesForInstagram = async (params: {
  orgId: string;
  activityFolder: string;
  topic: string;
  mode: InstagramImageMode;
  requiredCount: number;
  manualSelections?: string[];
}): Promise<ImageSelectionResult> => {
  if (params.mode === "text_only") {
    return {
      mode: "text_only",
      selectedImages: []
    };
  }

  const images = await listActivityImages({
    orgId: params.orgId,
    activityFolder: params.activityFolder,
    limit: 80
  });
  if (!images.length) {
    return {
      mode: params.mode,
      selectedImages: []
    };
  }

  const requiredCount = Math.max(1, Math.min(4, params.requiredCount));
  if (params.mode === "manual") {
    const manual = normalizeManualSelection(params.manualSelections);
    if (!manual.length) {
      return {
        mode: "manual",
        selectedImages: images.slice(0, requiredCount)
      };
    }

    const matched = images.filter((image) =>
      manual.some(
        (selected) =>
          image.fileName.toLowerCase() === selected ||
          image.relativePath.toLowerCase() === selected ||
          image.filePath.toLowerCase() === selected
      )
    );

    return {
      mode: "manual",
      selectedImages: (matched.length ? matched : images).slice(0, requiredCount)
    };
  }

  const llmSelected = await selectByLlm({
    orgId: params.orgId,
    topic: params.topic,
    requiredCount,
    images
  });
  return {
    mode: "auto",
    selectedImages: llmSelected.slice(0, requiredCount)
  };
};

const selectByLlm = async (params: {
  orgId: string;
  topic: string;
  requiredCount: number;
  images: ActivityImageEntry[];
}): Promise<ActivityImageEntry[]> => {
  const imageList = params.images
    .slice(0, 40)
    .map((entry) => `- ${entry.fileName} | ${entry.relativePath} | size=${entry.fileSize ?? "n/a"} | detectedAt=${entry.detectedAt ?? "n/a"}`)
    .join("\n");

  const prompt = [
    "[TASK]",
    `Select up to ${params.requiredCount} most relevant images for Instagram topic: "${params.topic}"`,
    "",
    "[AVAILABLE_IMAGES]",
    imageList,
    "",
    "[OUTPUT]",
    "Return strict JSON:",
    "{",
    '  "selected_file_names": ["image1.jpg", "image2.jpg"]',
    "}"
  ].join("\n");

  const result = await callWithFallback({
    orgId: params.orgId,
    prompt,
    maxTokens: 512
  });

  if (!result.text) {
    return params.images.slice(0, params.requiredCount);
  }

  const selectedNames = parseSelectedFileNames(result.text);
  if (!selectedNames.length) {
    return params.images.slice(0, params.requiredCount);
  }

  const selected = params.images.filter((entry) =>
    selectedNames.some((name) => entry.fileName.toLowerCase() === name || entry.relativePath.toLowerCase() === name)
  );

  return selected.length ? selected : params.images.slice(0, params.requiredCount);
};

const parseSelectedFileNames = (text: string): string[] => {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const values = Array.isArray(parsed.selected_file_names) ? parsed.selected_file_names : [];
    return values
      .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const normalizeManualSelection = (values?: string[]): string[] =>
  Array.isArray(values)
    ? values.map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    : [];

const toRelativePath = (absoluteOrRelativePath: string, activityFolder: string, fileName: string): string => {
  const normalized = absoluteOrRelativePath.replace(/\\/g, "/");
  const normalizedFolder = activityFolder.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(`/${normalizedFolder}/`);
  if (index >= 0) {
    return normalized.slice(index + 1).replace(/^\/+/, "");
  }

  if (normalized.includes(normalizedFolder)) {
    const start = normalized.indexOf(normalizedFolder);
    return normalized.slice(start);
  }

  return `${normalizedFolder}/${fileName}`.replace(/\/+/g, "/");
};
