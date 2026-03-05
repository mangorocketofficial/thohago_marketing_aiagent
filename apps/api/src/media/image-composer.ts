import sharp from "sharp";
import {
  applyDarkOverlay,
  applyImageOpacity,
  applyRoundedCorners,
  composeImage,
  createGradientBackground,
  createSolidBackground,
  preprocessUserImage,
  type CompositeLayer
} from "./sharp-client";
import { buildTextOverlaySvg } from "./svg-renderer";
import { getTemplate } from "./templates/registry";
import type { BackgroundDef, TemplateId, TemplateTextLayer } from "./templates/schema";

export type ImageComposeInput = {
  templateId: TemplateId;
  userImages: string[];
  overlayMainText: string;
  overlaySubText: string;
  brandLogoPath?: string;
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
 * Compose one Instagram image from template, user images, and overlay text.
 */
export const composeInstagramImage = async (input: ImageComposeInput): Promise<ImageComposeResult> => {
  const template = getTemplate(input.templateId);
  if (!template) {
    throw new Error(`Template not found: ${input.templateId}`);
  }

  const width = template.width;
  const height = template.height;
  let background = await resolveBackground(template.background, input.userImages, width, height);

  if (template.layers.darkOverlay) {
    background = await applyDarkOverlay(background, width, height, template.layers.darkOverlay.opacity);
  }

  const layers: CompositeLayer[] = [];

  if (template.layers.userImageAreas && input.userImages.length > 0) {
    for (let index = 0; index < template.layers.userImageAreas.length; index += 1) {
      const area = template.layers.userImageAreas[index];
      const imagePath = input.userImages[index % input.userImages.length];
      if (!imagePath) {
        continue;
      }

      let processed = await preprocessUserImage(imagePath, area.w, area.h, area.fit);
      if (typeof area.borderRadius === "number" && area.borderRadius > 0) {
        processed = await applyRoundedCorners(processed, area.w, area.h, area.borderRadius);
      }

      layers.push({
        type: "image",
        input: processed,
        left: area.x,
        top: area.y
      });
    }
  }

  layers.push(buildTextLayer(input.overlayMainText, template.layers.mainText));

  if (template.layers.subText && input.overlaySubText.trim()) {
    layers.push(buildTextLayer(input.overlaySubText, template.layers.subText));
  }

  if (template.layers.brandLogo && input.brandLogoPath) {
    let logo = await preprocessUserImage(
      input.brandLogoPath,
      template.layers.brandLogo.w,
      template.layers.brandLogo.h,
      "contain"
    );

    if (template.layers.brandLogo.opacity < 1) {
      logo = await applyImageOpacity(logo, template.layers.brandLogo.opacity);
    }

    layers.push({
      type: "image",
      input: logo,
      left: template.layers.brandLogo.x,
      top: template.layers.brandLogo.y
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

const buildTextLayer = (text: string, layer: TemplateTextLayer): CompositeLayer => {
  const textSvg = buildTextOverlaySvg({
    text,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontColor: layer.fontColor,
    align: layer.align,
    maxWidth: layer.maxWidth,
    lineSpacing: layer.lineSpacing
  });

  return {
    type: "svg",
    input: textSvg,
    left: layer.x,
    top: layer.y
  };
};

/**
 * Resolve background definition into image buffer.
 */
const resolveBackground = async (
  background: BackgroundDef,
  userImages: string[],
  width: number,
  height: number
): Promise<Buffer> => {
  switch (background.type) {
    case "solid":
      return createSolidBackground(width, height, background.color);
    case "gradient":
      return createGradientBackground(width, height, background.colors, background.direction);
    case "image": {
      const firstImage = userImages[0];
      if (!firstImage) {
        return createSolidBackground(width, height, "#E0E0E0");
      }

      return sharp(firstImage).resize(width, height, { fit: "cover", position: "centre" }).png().toBuffer();
    }
  }
};
