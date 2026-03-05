import sharp from "sharp";
import { composeImage, preprocessUserImage, type CompositeLayer } from "./sharp-client.js";
import { buildTextOverlaySvg } from "./svg-renderer.js";
import { getTemplate, getTemplateBackgroundPath } from "./templates/registry.js";
import type { TemplateId } from "./templates/schema.js";

export type ImageComposeInput = {
  templateId: TemplateId;
  userImages: string[];
  overlayTexts?: Record<string, string>;
  outputFormat: "png" | "jpg";
};

export type ImageComposeResult = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "png" | "jpg";
  sizeBytes: number;
};

/**
 * Compose one Instagram image from template photo/text schema.
 * Non-editable visual decorations must be pre-baked into background.png.
 */
export const composeInstagramImage = async (input: ImageComposeInput): Promise<ImageComposeResult> => {
  const template = getTemplate(input.templateId);
  if (!template) {
    throw new Error(`Template not found: ${input.templateId}`);
  }

  const width = template.size.width;
  const height = template.size.height;
  const background = await resolveBackground(input.templateId, width, height);
  const layers: CompositeLayer[] = [];

  for (let index = 0; index < template.photos.length; index += 1) {
    const slot = template.photos[index];
    const imagePath = input.userImages[index];
    if (!imagePath) {
      if (slot.optional) {
        continue;
      }
      throw new Error(`Missing required photo slot: ${slot.id}`);
    }

    const processed = await preprocessUserImage(imagePath, slot.width, slot.height, slot.fit);
    layers.push({
      type: "image",
      input: processed,
      left: slot.x,
      top: slot.y
    });
  }

  const textMap = resolveOverlayTextMap(input.overlayTexts ?? {});
  for (const textLayer of buildTextOverlaySvg(template.texts, textMap)) {
    layers.push({
      type: "svg",
      input: textLayer.buffer,
      left: textLayer.x,
      top: textLayer.y
    });
  }

  const buffer = await composeImage({
    width,
    height,
    background,
    layers,
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
  if (!backgroundPath) {
    throw new Error(`Missing background.png for template: ${templateId}`);
  }

  return sharp(backgroundPath).resize(width, height, { fit: "cover", position: "centre" }).png().toBuffer();
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
