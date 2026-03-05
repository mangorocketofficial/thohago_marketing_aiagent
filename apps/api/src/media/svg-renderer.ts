import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TextOverlayOptions = {
  text: string;
  fontSize: number;
  fontWeight: "regular" | "bold";
  fontColor: string;
  align: "center" | "left" | "right";
  maxWidth: number;
  lineSpacing?: number;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build SVG image buffer for text overlay.
 */
export const buildTextOverlaySvg = (options: TextOverlayOptions): Buffer => {
  const safeText = options.text.trim() || " ";
  const safeFontSize = Math.max(12, Math.floor(options.fontSize));
  const safeWidth = Math.max(64, Math.floor(options.maxWidth));
  const lineHeight = safeFontSize * Math.max(1, options.lineSpacing ?? 1.4);

  const charsPerLine = Math.max(1, Math.floor(safeWidth / (safeFontSize * 0.62)));
  const lines = wrapText(safeText, charsPerLine);
  const height = Math.max(safeFontSize + 4, Math.ceil(lines.length * lineHeight + safeFontSize * 0.35));

  const x = anchorX(options.align, safeWidth);
  const textAnchor = alignToAnchor(options.align);
  const fontFaceCss = buildFontFaceCss(options.fontWeight);
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = [
    `<svg width="${safeWidth}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    "<defs>",
    "<style>",
    fontFaceCss,
    "</style>",
    "</defs>",
    `<text x="${x}" y="${safeFontSize}" font-family="InstagramOverlayFont, Noto Sans CJK KR, sans-serif" font-size="${safeFontSize}" font-weight="${options.fontWeight === "bold" ? 700 : 400}" fill="${options.fontColor}" text-anchor="${textAnchor}">`,
    tspans,
    "</text>",
    "</svg>"
  ].join("");

  return Buffer.from(svg);
};

/**
 * Wrap text by Korean-friendly char count first, then by whitespace when possible.
 */
const wrapText = (text: string, maxChars: number): string[] => {
  if (text.length <= maxChars) {
    return [text];
  }

  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }

    let breakPoint = remaining.lastIndexOf(" ", maxChars);
    if (breakPoint <= 0) {
      breakPoint = maxChars;
    }

    lines.push(remaining.slice(0, breakPoint).trimEnd());
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return lines.length ? lines : [text];
};

const alignToAnchor = (align: "center" | "left" | "right"): "middle" | "start" | "end" => {
  switch (align) {
    case "center":
      return "middle";
    case "left":
      return "start";
    case "right":
      return "end";
  }
};

const anchorX = (align: "center" | "left" | "right", width: number): number => {
  switch (align) {
    case "center":
      return Math.round(width / 2);
    case "left":
      return 0;
    case "right":
      return width;
  }
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildFontFaceCss = (weight: "regular" | "bold"): string => {
  const fileName = weight === "bold" ? "Pretendard-Bold.otf" : "Pretendard-Regular.otf";
  const fontPath = path.resolve(moduleDir, "templates", "fonts", fileName);
  if (!fs.existsSync(fontPath)) {
    return "";
  }

  const fontBase64 = fs.readFileSync(fontPath).toString("base64");
  const weightCss = weight === "bold" ? 700 : 400;
  return [
    "@font-face {",
    "  font-family: 'InstagramOverlayFont';",
    `  src: url('data:font/otf;base64,${fontBase64}') format('opentype');`,
    `  font-weight: ${weightCss};`,
    "}"
  ].join("");
};
