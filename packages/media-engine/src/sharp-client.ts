import fs from "node:fs/promises";
import sharp from "sharp";
import type { TemplateImageFit } from "./templates/schema";

export type CompositeLayer = {
  type: "image" | "svg";
  input: Buffer | string;
  top: number;
  left: number;
  opacity?: number;
};

export type ComposeOptions = {
  width: number;
  height: number;
  background: Buffer;
  layers: CompositeLayer[];
  outputFormat: "png" | "jpg";
  quality?: number;
};

/**
 * Compose multiple layers into one image.
 */
export const composeImage = async (options: ComposeOptions): Promise<Buffer> => {
  const overlays: sharp.OverlayOptions[] = [];

  for (const layer of options.layers) {
    let input: Buffer | string = layer.input;
    if (typeof layer.opacity === "number" && layer.opacity >= 0 && layer.opacity < 1) {
      if (typeof input === "string") {
        input = await fs.readFile(input);
      }
      input = await applyImageOpacity(input, layer.opacity);
    }

    overlays.push({
      input,
      top: layer.top,
      left: layer.left
    });
  }

  const composed = sharp(options.background)
    .resize(options.width, options.height, { fit: "cover" })
    .composite(overlays);

  return options.outputFormat === "jpg"
    ? composed.jpeg({ quality: options.quality ?? 90 }).toBuffer()
    : composed.png().toBuffer();
};

/**
 * Build a solid color background image.
 */
export const createSolidBackground = async (width: number, height: number, color: string): Promise<Buffer> =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  })
    .png()
    .toBuffer();

/**
 * Build a gradient background via inline SVG.
 */
export const createGradientBackground = async (
  width: number,
  height: number,
  colors: [string, string],
  direction: "vertical" | "horizontal" | "diagonal"
): Promise<Buffer> => {
  const [x1, y1, x2, y2] = gradientCoords(direction);
  const svg = [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    "<defs>",
    `<linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`,
    `<stop offset="0%" stop-color="${colors[0]}"/>`,
    `<stop offset="100%" stop-color="${colors[1]}"/>`,
    "</linearGradient>",
    "</defs>",
    `<rect width="${width}" height="${height}" fill="url(#g)"/>`,
    "</svg>"
  ].join("");

  return sharp(Buffer.from(svg)).png().toBuffer();
};

const gradientCoords = (
  direction: "vertical" | "horizontal" | "diagonal"
): [string, string, string, string] => {
  switch (direction) {
    case "vertical":
      return ["0%", "0%", "0%", "100%"];
    case "horizontal":
      return ["0%", "0%", "100%", "0%"];
    case "diagonal":
      return ["0%", "0%", "100%", "100%"];
  }
};

/**
 * Resize/crop one user image to target area.
 */
export const preprocessUserImage = async (
  imagePath: string,
  targetWidth: number,
  targetHeight: number,
  fit: TemplateImageFit = "cover"
): Promise<Buffer> =>
  sharp(imagePath)
    .resize(targetWidth, targetHeight, {
      fit: fit === "contain" ? "contain" : "cover",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toBuffer();

/**
 * Apply a dark overlay across full background.
 */
export const applyDarkOverlay = async (
  imageBuffer: Buffer,
  width: number,
  height: number,
  opacity: number
): Promise<Buffer> => {
  const normalized = Math.max(0, Math.min(1, opacity));
  const overlay = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: normalized }
    }
  })
    .png()
    .toBuffer();

  return sharp(imageBuffer).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
};

/**
 * Apply rounded corners to one image card.
 */
export const applyRoundedCorners = async (
  imageBuffer: Buffer,
  width: number,
  height: number,
  radius: number
): Promise<Buffer> => {
  const safeRadius = Math.max(0, Math.min(Math.floor(Math.min(width, height) / 2), Math.floor(radius)));
  if (safeRadius === 0) {
    return imageBuffer;
  }

  const mask = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" rx="${safeRadius}" ry="${safeRadius}" fill="white"/></svg>`
  );

  return sharp(imageBuffer).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
};

/**
 * Apply global image opacity.
 */
export const applyImageOpacity = async (imageBuffer: Buffer, opacity: number): Promise<Buffer> => {
  const normalized = Math.max(0, Math.min(1, opacity));
  if (normalized >= 1) {
    return imageBuffer;
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const alphaMask = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: normalized }
    }
  })
    .png()
    .toBuffer();

  return sharp(imageBuffer).composite([{ input: alphaMask, blend: "dest-in" }]).png().toBuffer();
};
