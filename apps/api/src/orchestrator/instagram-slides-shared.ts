import type { InstagramSlide, InstagramSlideRole } from "./skills/instagram-generation/types";

export const INSTAGRAM_SLIDE_ROLES: InstagramSlideRole[] = [
  "cover",
  "problem",
  "solution",
  "benefit",
  "data",
  "detail",
  "testimonial",
  "cta",
  "custom"
];

const INSTAGRAM_SLIDE_ROLE_SET = new Set<InstagramSlideRole>(INSTAGRAM_SLIDE_ROLES);

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => !!entry)
    : [];

const asStringMap = (value: unknown): Record<string, string> => {
  const row = asRecord(value);
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(row)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    next[normalizedKey] = asString(entry, "").trim();
  }
  return next;
};

export const normalizeInstagramSlideRole = (value: unknown, fallback: InstagramSlideRole = "custom"): InstagramSlideRole => {
  const normalized = asString(value, "").trim().toLowerCase() as InstagramSlideRole;
  return INSTAGRAM_SLIDE_ROLE_SET.has(normalized) ? normalized : fallback;
};

const normalizeSlide = (value: unknown, fallbackIndex: number): InstagramSlide | null => {
  const row = asRecord(value);
  const slideIndexRaw = row.slide_index ?? row.slideIndex;
  const parsedIndex =
    typeof slideIndexRaw === "number" && Number.isFinite(slideIndexRaw)
      ? Math.max(0, Math.floor(slideIndexRaw))
      : fallbackIndex;

  return {
    slideIndex: parsedIndex,
    role: normalizeInstagramSlideRole(row.role),
    overlayTexts: asStringMap(row.overlay_texts ?? row.overlayTexts),
    imageFileIds: asStringArray(row.image_file_ids ?? row.imageFileIds),
    imagePaths: asStringArray(row.image_paths ?? row.imagePaths)
  };
};

export const normalizeInstagramSlides = (metadata: Record<string, unknown>): InstagramSlide[] => {
  const parsedSlides = Array.isArray(metadata.slides)
    ? metadata.slides
        .map((entry, index) => normalizeSlide(entry, index))
        .filter((entry): entry is InstagramSlide => !!entry)
        .sort((left, right) => left.slideIndex - right.slideIndex)
        .map((entry, index) => ({
          ...entry,
          slideIndex: index
        }))
    : [];

  if (parsedSlides.length > 0) {
    return parsedSlides;
  }

  return [
    {
      slideIndex: 0,
      role: "custom",
      overlayTexts: asStringMap(metadata.overlay_texts),
      imageFileIds: asStringArray(metadata.image_file_ids),
      imagePaths: asStringArray(metadata.image_paths)
    }
  ];
};

export const deriveLegacyInstagramFields = (slides: InstagramSlide[]): {
  overlayTexts: Record<string, string>;
  imageFileIds: string[];
  imagePaths: string[];
  isCarousel: boolean;
} => {
  const firstSlide = slides[0] ?? {
    slideIndex: 0,
    role: "custom" as const,
    overlayTexts: {},
    imageFileIds: [],
    imagePaths: []
  };

  return {
    overlayTexts: { ...firstSlide.overlayTexts },
    imageFileIds: [...firstSlide.imageFileIds],
    imagePaths: [...firstSlide.imagePaths],
    isCarousel: slides.length > 1
  };
};

export const serializeInstagramSlides = (slides: InstagramSlide[]): Array<Record<string, unknown>> =>
  slides.map((slide) => ({
    slide_index: slide.slideIndex,
    role: slide.role,
    overlay_texts: slide.overlayTexts,
    image_file_ids: slide.imageFileIds,
    image_paths: slide.imagePaths
  }));
