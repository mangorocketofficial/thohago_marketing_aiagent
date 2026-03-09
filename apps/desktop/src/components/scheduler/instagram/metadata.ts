import type { Content } from "@repo/types";
import { fillInstagramSlideImageGaps } from "@repo/types";

type LocalSaveSuggestion = {
  relativePath: string;
  fileName: string;
};

const DEFAULT_TEMPLATE_ID = "koica_cover_01";

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

const buildImageNames = (imagePaths: string[], imageFileIds: string[]): string[] =>
  imagePaths.length > 0 ? imagePaths.map((entry) => fileNameFromPath(entry)).filter(Boolean) : imageFileIds.map((entry) => entry.slice(0, 8));

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

const asStringMap = (value: unknown): Record<string, string> => {
  const row = asRecord(value);
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(row)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || typeof entry !== "string") {
      continue;
    }
    next[normalizedKey] = entry;
  }
  return next;
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

export type InstagramEditorSlide = {
  slideIndex: number;
  templateId: string;
  role: string;
  overlayTexts: Record<string, string>;
  imageFileIds: string[];
  imagePaths: string[];
  imageNames: string[];
};

export type InstagramEditorSeed = {
  templateId: string;
  slides: InstagramEditorSlide[];
  activityFolder: string;
  caption: string;
  hashtags: string[];
  localSaveSuggestion: LocalSaveSuggestion;
  isCarousel: boolean;
};

const resolveRequiredImageCount = (metadata: Record<string, unknown>, slides: InstagramEditorSlide[]): number => {
  const slideCount = slides.reduce((max, slide) => Math.max(max, slide.imagePaths.length, slide.imageFileIds.length), 0);
  if (slideCount > 0) {
    return slideCount;
  }

  const legacyImageCount = Math.max(asStringArray(metadata.image_paths).length, asStringArray(metadata.image_file_ids).length);
  return Math.max(1, legacyImageCount);
};

const buildEditorSlides = (metadata: Record<string, unknown>): InstagramEditorSlide[] => {
  const fallbackTemplateId = asString(metadata.template_id, DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID;
  const rawSlides = Array.isArray(metadata.slides) ? metadata.slides : [];
  const slides = rawSlides
    .map((entry, index) => {
      const row = asRecord(entry);
      const imageFileIds = asStringArray(row.image_file_ids ?? row.imageFileIds);
      const imagePaths = asStringArray(row.image_paths ?? row.imagePaths);
      return {
        slideIndex: typeof row.slide_index === "number" && Number.isFinite(row.slide_index) ? Math.max(0, Math.floor(row.slide_index)) : index,
        templateId: asString(row.template_id ?? row.templateId, fallbackTemplateId).trim() || fallbackTemplateId,
        role: asString(row.role, "custom").trim() || "custom",
        overlayTexts: asStringMap(row.overlay_texts ?? row.overlayTexts),
        imageFileIds,
        imagePaths,
        imageNames: buildImageNames(imagePaths, imageFileIds)
      } satisfies InstagramEditorSlide;
    })
    .sort((left, right) => left.slideIndex - right.slideIndex)
    .map((slide, index) => ({
      ...slide,
      slideIndex: index
    }));

  if (slides.length > 0) {
    return slides;
  }

  const imageFileIds = asStringArray(metadata.image_file_ids);
  const imagePaths = asStringArray(metadata.image_paths);
  return [
    {
      slideIndex: 0,
      templateId: fallbackTemplateId,
      role: "custom",
      overlayTexts: asStringMap(metadata.overlay_texts),
      imageFileIds,
      imagePaths,
      imageNames: buildImageNames(imagePaths, imageFileIds)
    }
  ];
};

/**
 * Parse scheduler content row into initial instagram editor state.
 */
export const buildInstagramEditorSeed = (content: Content): InstagramEditorSeed => {
  const metadata = asRecord(content.metadata);
  const rawSlides = buildEditorSlides(metadata);
  const requiredImageCount = resolveRequiredImageCount(metadata, rawSlides);
  const slides = fillInstagramSlideImageGaps(rawSlides, requiredImageCount).map((slide, index) => ({
    ...slide,
    slideIndex: index,
    imageNames: buildImageNames(slide.imagePaths, slide.imageFileIds)
  }));
  const templateId = slides[0]?.templateId ?? (asString(metadata.template_id, DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID);
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
    slides,
    activityFolder,
    caption,
    hashtags,
    localSaveSuggestion,
    isCarousel: slides.length > 1
  };
};
