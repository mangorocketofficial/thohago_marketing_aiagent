import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateConfig, TemplateId, TemplatePhotoSlot, TemplateTextSlot } from "./schema.js";

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

const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
};

const resolveBackgroundPath = (jsonAbsolutePath: string): string | null => {
  const dir = path.dirname(jsonAbsolutePath);
  const backgroundPath = path.join(dir, "background.png");
  return fs.existsSync(backgroundPath) ? backgroundPath : null;
};

const readSizeField = (row: Record<string, unknown>, key: "width" | "height"): number => {
  const size = asRecord(row.size);
  return Math.max(1, Math.floor(asNumber(size[key], 1080)));
};

const parsePhotoSlots = (row: Record<string, unknown>): TemplatePhotoSlot[] => {
  const legacyOverlays = asRecord(row.overlays);
  const source = Array.isArray(row.photos)
    ? row.photos
    : Array.isArray(legacyOverlays.photos)
      ? legacyOverlays.photos
      : [];

  return source
    .map((entry) => {
      const slot = asRecord(entry);
      const id = asString(slot.id, "").trim();
      if (!id) {
        return null;
      }
      const fitRaw = asString(slot.fit, "cover").trim().toLowerCase();
      return {
        id,
        label: asString(slot.label, id).trim() || id,
        x: asNumber(slot.x, 0),
        y: asNumber(slot.y, 0),
        width: Math.max(1, Math.floor(asNumber(slot.width ?? slot.w, 1))),
        height: Math.max(1, Math.floor(asNumber(slot.height ?? slot.h, 1))),
        fit: fitRaw === "contain" ? "contain" : "cover",
        ...(slot.optional !== undefined ? { optional: asBoolean(slot.optional) } : {})
      } satisfies TemplatePhotoSlot;
    })
    .filter((entry): entry is TemplatePhotoSlot => !!entry);
};

const parseTextSlots = (row: Record<string, unknown>): TemplateTextSlot[] => {
  const legacyOverlays = asRecord(row.overlays);
  const source = Array.isArray(row.texts)
    ? row.texts
    : Array.isArray(legacyOverlays.texts)
      ? legacyOverlays.texts
      : [];

  return source
    .map((entry) => {
      const slot = asRecord(entry);
      const id = asString(slot.id, "").trim();
      if (!id) {
        return null;
      }
      const alignRaw = asString(slot.align, "center").trim().toLowerCase();
      const align = alignRaw === "left" || alignRaw === "right" ? alignRaw : "center";
      const fontWeightRaw = asString(slot.font_weight, "").trim().toLowerCase();
      return {
        id,
        label: asString(slot.label, id).trim() || id,
        x: asNumber(slot.x, 0),
        y: asNumber(slot.y, 0),
        width: Math.max(1, Math.floor(asNumber(slot.width ?? slot.w, 1))),
        height: Math.max(1, Math.floor(asNumber(slot.height ?? slot.h, 1))),
        font_size: Math.max(10, Math.floor(asNumber(slot.font_size, 20))),
        font_color: asString(slot.font_color, "#222222").trim() || "#222222",
        ...(fontWeightRaw === "normal" || fontWeightRaw === "bold" ? { font_weight: fontWeightRaw } : {}),
        align
      } satisfies TemplateTextSlot;
    })
    .filter((entry): entry is TemplateTextSlot => !!entry);
};

const parseMeta = (row: Record<string, unknown>): Record<string, unknown> | undefined => {
  const explicitMeta = asRecord(row.meta);
  const next: Record<string, unknown> = { ...explicitMeta };
  const legacyDescription = asString(row.description, "").trim();
  if (legacyDescription && !("description" in next)) {
    next.description = legacyDescription;
  }
  return Object.keys(next).length > 0 ? next : undefined;
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
    const row = asRecord(JSON.parse(raw) as unknown);
    const templateId = asString(row.template_id, "").trim();
    if (!templateId) {
      console.warn(`[MEDIA] Ignored invalid template config: ${absolutePath}`);
      continue;
    }

    const meta = parseMeta(row);
    const normalized: TemplateConfig = {
      template_id: templateId,
      template_name: asString(row.template_name, templateId).trim() || templateId,
      size: {
        width: readSizeField(row, "width"),
        height: readSizeField(row, "height")
      },
      photos: parsePhotoSlots(row),
      texts: parseTextSlots(row),
      ...(meta ? { meta } : {})
    };

    templates.set(templateId, normalized);

    const backgroundPath = resolveBackgroundPath(absolutePath);
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
  getAllTemplates().map((template) => {
    const meta = asRecord(template.meta);
    const description = asString(meta.description, "").trim();
    const thumbnail = asString(meta.thumbnail, "").trim() || `thumbnails/${template.template_id}.png`;
    return {
      id: template.template_id,
      nameKo: template.template_name,
      description,
      thumbnail
    };
  });
