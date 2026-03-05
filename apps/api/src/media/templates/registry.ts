import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateDefinition, TemplateId } from "./schema";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = path.resolve(moduleDir, "presets");

const templates = new Map<TemplateId, TemplateDefinition>();
let loaded = false;

const withDefaultThumbnail = (template: TemplateDefinition): TemplateDefinition => ({
  ...template,
  thumbnail: template.thumbnail ?? `thumbnails/${template.id}.png`
});

const assertTemplateId = (value: string): value is TemplateId =>
  value === "center-image-bottom-text" ||
  value === "fullscreen-overlay" ||
  value === "collage-2x2" ||
  value === "text-only-gradient" ||
  value === "split-image-text";

/**
 * Load JSON preset files from media/templates/presets.
 * Safe to call multiple times; cache is refreshed each call.
 */
export const loadPresetTemplates = (): void => {
  templates.clear();
  if (!fs.existsSync(PRESETS_DIR)) {
    loaded = true;
    return;
  }

  const presetFiles = fs.readdirSync(PRESETS_DIR).filter((entry) => entry.endsWith(".json"));
  for (const fileName of presetFiles) {
    const absolutePath = path.join(PRESETS_DIR, fileName);
    const raw = fs.readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TemplateDefinition>;
    const id = typeof parsed.id === "string" ? parsed.id : "";

    if (!assertTemplateId(id)) {
      console.warn(`[MEDIA] Ignored invalid template id in ${fileName}`);
      continue;
    }

    templates.set(id, withDefaultThumbnail(parsed as TemplateDefinition));
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
export const getTemplate = (id: TemplateId): TemplateDefinition | null => {
  ensureLoaded();
  return templates.get(id) ?? null;
};

/**
 * Return all loaded templates.
 */
export const getAllTemplates = (): TemplateDefinition[] => {
  ensureLoaded();
  return [...templates.values()];
};

/**
 * Return compact template list for survey UI.
 */
export const getTemplateSummaries = (): Array<{ id: TemplateId; nameKo: string; description: string; thumbnail: string }> =>
  getAllTemplates().map((template) => ({
    id: template.id,
    nameKo: template.nameKo,
    description: template.description,
    thumbnail: template.thumbnail ?? `thumbnails/${template.id}.png`
  }));
