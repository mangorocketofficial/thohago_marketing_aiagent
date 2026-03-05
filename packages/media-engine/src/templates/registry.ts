import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  TemplateBadge,
  TemplateConfig,
  TemplateHeader,
  TemplateId,
  TemplatePhotoSlot,
  TemplateTextSlot
} from "./schema";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = path.resolve(moduleDir, "presets");

const templates = new Map<TemplateId, TemplateConfig>();
const backgroundByTemplateId = new Map<TemplateId, string>();
let loaded = false;

const collectJsonFiles = (rootDir: string): string[] => {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(absolutePath);
      }
    }
  };

  walk(rootDir);
  return files;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim()
      ? Number.parseFloat(value.trim()) || fallback
      : fallback;

const resolveBackgroundPath = (templateId: string, jsonAbsolutePath: string): string | null => {
  const dir = path.dirname(jsonAbsolutePath);
  const candidates = [
    path.join(dir, "background.png"),
    path.join(dir, "background.jpg"),
    path.join(dir, `${templateId}.png`),
    path.join(dir, `${templateId}.jpg`),
    path.join(PRESETS_DIR, `${templateId}.png`),
    path.join(PRESETS_DIR, `${templateId}.jpg`)
  ];

  for (const absolutePath of candidates) {
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
};

/**
 * Load preset template JSON files from media-engine templates/presets.
 * Safe to call multiple times; cache is refreshed each call.
 */
export const loadPresetTemplates = (): void => {
  templates.clear();
  backgroundByTemplateId.clear();

  for (const absolutePath of collectJsonFiles(PRESETS_DIR)) {
    const raw = fs.readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const row = asRecord(parsed);
    const templateId = asString(row.template_id, "").trim();
    if (!templateId) {
      console.warn(`[MEDIA] Ignored invalid template config: ${absolutePath}`);
      continue;
    }

    const overlays = asRecord(row.overlays);
    const photos: TemplatePhotoSlot[] = Array.isArray(overlays.photos)
      ? overlays.photos
          .map((entry) => {
            const photo = asRecord(entry);
            const id = asString(photo.id, "").trim();
            if (!id) {
              return null;
            }
            return {
              id,
              label: asString(photo.label, id).trim() || id,
              x: asNumber(photo.x, 0),
              y: asNumber(photo.y, 0),
              width: Math.max(1, Math.floor(asNumber(photo.width, 1))),
              height: Math.max(1, Math.floor(asNumber(photo.height, 1))),
              fit: asString(photo.fit, "cover").trim() === "contain" ? "contain" : "cover",
              ...(photo.z_index !== undefined ? { z_index: Math.floor(asNumber(photo.z_index, 1)) } : {})
            } satisfies TemplatePhotoSlot;
          })
          .filter((entry): entry is TemplatePhotoSlot => !!entry)
      : [];

    const texts: TemplateTextSlot[] = Array.isArray(overlays.texts)
      ? overlays.texts
          .map((entry) => {
            const text = asRecord(entry);
            const id = asString(text.id, "").trim();
            if (!id) {
              return null;
            }
            const alignRaw = asString(text.align, "center").trim().toLowerCase();
            const align = alignRaw === "left" || alignRaw === "right" ? alignRaw : "center";
            const fontWeight = asString(text.font_weight, "").trim().toLowerCase();
            return {
              id,
              label: asString(text.label, id).trim() || id,
              x: asNumber(text.x, 0),
              y: asNumber(text.y, 0),
              width: Math.max(1, Math.floor(asNumber(text.width, 1))),
              height: Math.max(1, Math.floor(asNumber(text.height, 1))),
              font_size: Math.max(10, Math.floor(asNumber(text.font_size, 20))),
              font_color: asString(text.font_color, "#222222").trim() || "#222222",
              ...(fontWeight === "bold" || fontWeight === "normal" ? { font_weight: fontWeight } : {}),
              ...(asString(text.font_style, "").trim() ? { font_style: asString(text.font_style, "").trim() } : {}),
              align,
              ...(asString(text.example_text, "").trim() ? { example_text: asString(text.example_text, "").trim() } : {})
            } satisfies TemplateTextSlot;
          })
          .filter((entry): entry is TemplateTextSlot => !!entry)
      : [];

    const badgeRaw = asRecord(overlays.badge);
    const badge: TemplateBadge | undefined =
      asString(badgeRaw.id, "").trim()
        ? {
            id: asString(badgeRaw.id, "").trim(),
            ...(asString(badgeRaw.label, "").trim() ? { label: asString(badgeRaw.label, "").trim() } : {}),
            x: asNumber(badgeRaw.x, 0),
            y: asNumber(badgeRaw.y, 0),
            width: Math.max(1, Math.floor(asNumber(badgeRaw.width, 1))),
            height: Math.max(1, Math.floor(asNumber(badgeRaw.height, 1))),
            type: asString(badgeRaw.type, "circle").trim() === "rect" ? "rect" : "circle",
            font_size: Math.max(10, Math.floor(asNumber(badgeRaw.font_size, 20))),
            font_color: asString(badgeRaw.font_color, "#FFFFFF").trim() || "#FFFFFF",
            ...(asString(badgeRaw.font_weight, "").trim().toLowerCase() === "bold" ||
            asString(badgeRaw.font_weight, "").trim().toLowerCase() === "normal"
              ? { font_weight: asString(badgeRaw.font_weight, "").trim().toLowerCase() as "normal" | "bold" }
              : {}),
            ...(badgeRaw.z_index !== undefined ? { z_index: Math.floor(asNumber(badgeRaw.z_index, 1)) } : {}),
            ...(asString(badgeRaw.example_text, "").trim()
              ? { example_text: asString(badgeRaw.example_text, "").trim() }
              : {})
          }
        : undefined;

    const headerRaw = asRecord(row.header);
    const header: TemplateHeader | undefined =
      headerRaw && typeof headerRaw === "object" && !Array.isArray(headerRaw)
        ? {
            logos: Array.isArray(headerRaw.logos)
              ? headerRaw.logos.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
              : [],
            ...(asString(headerRaw.tag, "").trim() ? { tag: asString(headerRaw.tag, "").trim() } : {}),
            position: {
              x: asNumber(asRecord(headerRaw.position).x, 0),
              y: asNumber(asRecord(headerRaw.position).y, 0),
              width: Math.max(1, Math.floor(asNumber(asRecord(headerRaw.position).width, 1))),
              height: Math.max(1, Math.floor(asNumber(asRecord(headerRaw.position).height, 1)))
            }
          }
        : undefined;

    const normalized: TemplateConfig = {
      template_id: templateId,
      template_name: asString(row.template_name, templateId).trim() || templateId,
      description: asString(row.description, "").trim(),
      size: {
        width: Math.max(1, Math.floor(asNumber(asRecord(row.size).width, 1080))),
        height: Math.max(1, Math.floor(asNumber(asRecord(row.size).height, 1080)))
      },
      overlays: {
        photos,
        texts,
        ...(badge ? { badge } : {})
      },
      ...(header ? { header } : {})
    };

    templates.set(templateId, normalized);
    const backgroundPath = resolveBackgroundPath(templateId, absolutePath);
    if (backgroundPath) {
      backgroundByTemplateId.set(templateId, backgroundPath);
    }
  }

  loaded = true;
};

const ensureLoaded = (): void => {
  if (!loaded) {
    loadPresetTemplates();
  }
};

/**
 * Get one template by id.
 */
export const getTemplate = (id: TemplateId): TemplateConfig | null => {
  ensureLoaded();
  return templates.get(id) ?? null;
};

/**
 * Return all loaded templates.
 */
export const getAllTemplates = (): TemplateConfig[] => {
  ensureLoaded();
  return [...templates.values()];
};

/**
 * Resolve absolute background asset path for template id.
 */
export const getTemplateBackgroundPath = (id: TemplateId): string | null => {
  ensureLoaded();
  return backgroundByTemplateId.get(id) ?? null;
};

/**
 * Return compact template list for survey UI.
 */
export const getTemplateSummaries = (): Array<{ id: TemplateId; nameKo: string; description: string; thumbnail: string }> =>
  getAllTemplates().map((template) => ({
    id: template.template_id,
    nameKo: template.template_name,
    description: template.description,
    thumbnail: `thumbnails/${template.template_id}.png`
  }));
