import sharp from "sharp";
import {
  applyRoundedCorners,
  composeImage,
  createSolidBackground,
  preprocessUserImage,
  type CompositeLayer
} from "./sharp-client";
import { buildBadgeSvg, buildTextOverlaySvg } from "./svg-renderer";
import { getTemplate, getTemplateBackgroundPath } from "./templates/registry";
import type { TemplateBadge, TemplateId } from "./templates/schema";

export type ImageComposeInput = {
  templateId: TemplateId;
  userImages: string[];
  overlayTexts?: Record<string, string>;
  badgeText?: string;
  outputFormat: "png" | "jpg";
};

export type ImageComposeResult = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "png" | "jpg";
  sizeBytes: number;
};

type LayerWithOrder = CompositeLayer & { zIndex: number };

/**
 * Compose one Instagram image from template photo/text/badge overlay schema.
 */
export const composeInstagramImage = async (input: ImageComposeInput): Promise<ImageComposeResult> => {
  const template = getTemplate(input.templateId);
  if (!template) {
    throw new Error(`Template not found: ${input.templateId}`);
  }

  const width = template.size.width;
  const height = template.size.height;
  const background = await resolveBackground(input.templateId, width, height);
  const overlays: LayerWithOrder[] = [];

  for (let index = 0; index < template.overlays.photos.length; index += 1) {
    const slot = template.overlays.photos[index];
    const imagePath = input.userImages[index % Math.max(1, input.userImages.length)];
    if (!imagePath) {
      continue;
    }

    let processed = await preprocessUserImage(imagePath, slot.width, slot.height, slot.fit);
    if (slot.fit === "cover") {
      processed = await applyRoundedCorners(processed, slot.width, slot.height, 0);
    }
    overlays.push({
      type: "image",
      input: processed,
      left: slot.x,
      top: slot.y,
      zIndex: slot.z_index ?? 1
    });
  }

  const textMap = resolveOverlayTextMap(input.overlayTexts ?? {});

  for (const textLayer of buildTextOverlaySvg(template.overlays.texts, textMap)) {
    overlays.push({
      type: "svg",
      input: textLayer.buffer,
      left: textLayer.x,
      top: textLayer.y,
      zIndex: 2
    });
  }

  if (template.overlays.badge) {
    const badge = template.overlays.badge;
    const badgeValue = resolveBadgeText({
      badge,
      textMap,
      explicitBadgeText: input.badgeText
    });
    const badgeSvg = buildBadgeSvg(badge, badgeValue);
    overlays.push({
      type: "svg",
      input: badgeSvg,
      left: badge.x,
      top: badge.y,
      zIndex: badge.z_index ?? 3
    });
  }

  overlays.sort((a, b) => a.zIndex - b.zIndex);
  const buffer = await composeImage({
    width,
    height,
    background,
    layers: overlays.map(({ zIndex: _z, ...layer }) => layer),
    outputFormat: input.outputFormat
  });

  return {
    buffer,
    width,
    height,
    format: input.outputFormat,
    sizeBytes: buffer.length
  };
};

const resolveBackground = async (templateId: string, width: number, height: number): Promise<Buffer> => {
  const backgroundPath = getTemplateBackgroundPath(templateId);
  if (backgroundPath) {
    return sharp(backgroundPath).resize(width, height, { fit: "cover", position: "centre" }).png().toBuffer();
  }
  return createSolidBackground(width, height, "#FFFFFF");
};

const resolveOverlayTextMap = (overlayTexts: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlayTexts)) {
    const slotId = key.trim();
    const text = `${value ?? ""}`.trim();
    if (!slotId || !text) {
      continue;
    }
    next[slotId] = text;
  }
  return next;
};

const resolveBadgeText = (params: {
  badge: TemplateBadge;
  textMap: Record<string, string>;
  explicitBadgeText?: string;
}): string => {
  const fromExplicit = `${params.explicitBadgeText ?? ""}`.trim();
  if (fromExplicit) {
    return fromExplicit;
  }
  const fromMap = `${params.textMap[params.badge.id] ?? ""}`.trim();
  if (fromMap) {
    return fromMap;
  }
  return `${params.badge.example_text ?? ""}`.trim();
};
