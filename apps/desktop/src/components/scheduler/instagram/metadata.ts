import type { Content } from "@repo/types";

type LocalSaveSuggestion = {
  relativePath: string;
  fileName: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => !!entry)
    : [];

const normalizeHashtag = (raw: string): string => raw.trim().replace(/^#+/, "").replace(/\s+/g, "");

const dedupe = (values: string[]): string[] => {
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

/**
 * Convert local/absolute path text into display-friendly file name without Node path dependency.
 */
export const fileNameFromPath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
};

const splitCaptionAndHashtagsFromBody = (body: string): { caption: string; hashtags: string[] } => {
  const trimmed = body.trim();
  if (!trimmed) {
    return {
      caption: "",
      hashtags: []
    };
  }

  const lines = trimmed.split(/\r?\n/);
  const hashtagTokens: string[] = [];
  while (lines.length > 0) {
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (!last) {
      lines.pop();
      continue;
    }
    const tokens = last.split(/\s+/).filter(Boolean);
    const isHashtagLine = tokens.length > 0 && tokens.every((token) => token.startsWith("#"));
    if (!isHashtagLine) {
      break;
    }
    hashtagTokens.unshift(...tokens);
    lines.pop();
  }

  const hashtags = dedupe(
    hashtagTokens
      .map((token) => normalizeHashtag(token))
      .filter((token) => !!token)
  );

  return {
    caption: lines.join("\n").trim(),
    hashtags
  };
};

/**
 * Build instagram body string from caption text and hashtag chips.
 */
export const composeCaptionBody = (caption: string, hashtags: string[]): string => {
  const cleanCaption = caption.trim();
  const cleanHashtags = dedupe(
    hashtags
      .map((entry) => normalizeHashtag(entry))
      .filter((entry) => !!entry)
  );
  const hashtagLine = cleanHashtags.map((entry) => `#${entry}`).join(" ");

  if (!hashtagLine) {
    return cleanCaption;
  }
  if (!cleanCaption) {
    return hashtagLine;
  }
  return `${cleanCaption}\n\n${hashtagLine}`;
};

export type InstagramEditorSeed = {
  templateId: string;
  overlayTexts: Record<string, string>;
  imageFileIds: string[];
  imagePaths: string[];
  imageNames: string[];
  activityFolder: string;
  caption: string;
  hashtags: string[];
  localSaveSuggestion: LocalSaveSuggestion;
};

/**
 * Parse scheduler content row into initial instagram editor state.
 */
export const buildInstagramEditorSeed = (content: Content): InstagramEditorSeed => {
  const metadata = asRecord(content.metadata);
  const templateId = asString(metadata.template_id, "koica_cover_01").trim() || "koica_cover_01";
  const overlayTextsRaw = asRecord(metadata.overlay_texts);
  const overlayTexts: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlayTextsRaw)) {
    const id = key.trim();
    if (!id || typeof value !== "string") {
      continue;
    }
    overlayTexts[id] = value;
  }
  const imageFileIds = asStringArray(metadata.image_file_ids);
  const imagePaths = asStringArray(metadata.image_paths);
  const imageNames =
    imagePaths.length > 0
      ? imagePaths.map((entry) => fileNameFromPath(entry)).filter((entry) => !!entry)
      : imageFileIds.map((entry) => entry.slice(0, 8));
  const activityFolder = asString(metadata.activity_folder, "").trim();

  const bodyText = typeof content.body === "string" ? content.body : "";
  const fromBody = splitCaptionAndHashtagsFromBody(bodyText);
  const metadataHashtags = asStringArray(metadata.hashtags).map((entry) => normalizeHashtag(entry)).filter((entry) => !!entry);
  const hashtags = metadataHashtags.length > 0 ? dedupe(metadataHashtags) : fromBody.hashtags;
  const caption = fromBody.caption || bodyText.trim();

  const localSave = asRecord(metadata.local_save_suggestion);
  const relativePath = asString(localSave.relative_path, "").trim();
  const sourceFileName = asString(localSave.file_name, "").trim();
  const stem = sourceFileName.replace(/\.[^./\\]+$/, "");
  const captionFileName = `${(stem || `instagram_${content.id.slice(0, 8)}`).trim()}_caption.txt`;
  const localSaveSuggestion: LocalSaveSuggestion = {
    relativePath: relativePath || "contents/ondemand",
    fileName: captionFileName
  };

  return {
    templateId,
    overlayTexts,
    imageFileIds,
    imagePaths,
    imageNames,
    activityFolder,
    caption,
    hashtags,
    localSaveSuggestion
  };
};
