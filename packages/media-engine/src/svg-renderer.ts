import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateBadge, TemplateTextSlot } from "./templates/schema";

type TextOverlaySvg = {
  slotId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  buffer: Buffer;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const FONT_STYLE_MAP: Record<string, string> = {
  handwriting: "InstagramOverlayHandwritingFont, InstagramOverlayFont, Noto Sans CJK KR, sans-serif"
};

/**
 * Build per-slot SVG buffers from template text slots and id-based content map.
 */
export const buildTextOverlaySvg = (
  slots: TemplateTextSlot[],
  textById: Record<string, string>
): TextOverlaySvg[] =>
  slots.map((slot) => {
    const sourceText = `${textById[slot.id] ?? slot.example_text ?? ""}`.trim() || " ";
    const safeFontSize = Math.max(12, Math.floor(slot.font_size));
    const safeWidth = Math.max(64, Math.floor(slot.width));
    const safeHeight = Math.max(24, Math.floor(slot.height));
    const lineHeight = Math.max(safeFontSize * 1.25, safeFontSize + 4);
    const charsPerLine = Math.max(1, Math.floor(safeWidth / (safeFontSize * 0.58)));
    const lines = wrapText(sourceText, charsPerLine, Math.max(1, Math.floor(safeHeight / lineHeight)));
    const textAnchor = alignToAnchor(slot.align);
    const x = anchorX(slot.align, safeWidth);
    const fontFaceCss = buildFontFaceCss();
    const fontFamily = mapFontFamily(slot.font_style);
    const fillColor = slot.font_color || "#222222";
    const tspans = lines
      .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
      .join("");

    const svg = [
      `<svg width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg">`,
      "<defs>",
      "<style>",
      fontFaceCss,
      "</style>",
      "</defs>",
      `<text x="${x}" y="${safeFontSize}" font-family="${fontFamily}" font-size="${safeFontSize}" font-weight="${slot.font_weight === "bold" ? 700 : 400}" fill="${fillColor}" text-anchor="${textAnchor}">`,
      tspans,
      "</text>",
      "</svg>"
    ].join("");

    return {
      slotId: slot.id,
      x: slot.x,
      y: slot.y,
      width: safeWidth,
      height: safeHeight,
      buffer: Buffer.from(svg)
    };
  });

/**
 * Build one SVG buffer for badge text overlay.
 */
export const buildBadgeSvg = (badge: TemplateBadge, text: string): Buffer => {
  const safeText = text.trim() || badge.example_text || " ";
  const safeWidth = Math.max(20, Math.floor(badge.width));
  const safeHeight = Math.max(20, Math.floor(badge.height));
  const safeFontSize = Math.max(10, Math.floor(badge.font_size));
  const textAnchor = "middle";
  const x = Math.floor(safeWidth / 2);
  const y = Math.floor(safeHeight / 2 + safeFontSize * 0.35);
  const fontFaceCss = buildFontFaceCss();
  const fillColor = badge.font_color || "#FFFFFF";
  const shape =
    badge.type === "circle"
      ? `<circle cx="${Math.floor(safeWidth / 2)}" cy="${Math.floor(safeHeight / 2)}" r="${Math.floor(Math.min(safeWidth, safeHeight) / 2)}" fill="white" fill-opacity="0"/>`
      : `<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="white" fill-opacity="0"/>`;

  const svg = [
    `<svg width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg">`,
    "<defs>",
    "<style>",
    fontFaceCss,
    "</style>",
    badge.type === "circle"
      ? `<clipPath id="badge-clip"><circle cx="${Math.floor(safeWidth / 2)}" cy="${Math.floor(safeHeight / 2)}" r="${Math.floor(
          Math.min(safeWidth, safeHeight) / 2
        )}"/></clipPath>`
      : `<clipPath id="badge-clip"><rect x="0" y="0" width="${safeWidth}" height="${safeHeight}"/></clipPath>`,
    "</defs>",
    shape,
    `<g clip-path="url(#badge-clip)">`,
    `<text x="${x}" y="${y}" font-family="InstagramOverlayFont, Noto Sans CJK KR, sans-serif" font-size="${safeFontSize}" font-weight="${badge.font_weight === "bold" ? 700 : 400}" fill="${fillColor}" text-anchor="${textAnchor}">${escapeXml(
      safeText
    )}</text>`,
    "</g>",
    "</svg>"
  ].join("");

  return Buffer.from(svg);
};

const wrapText = (text: string, maxChars: number, maxLines: number): string[] => {
  if (text.length <= maxChars) {
    return [text];
  }

  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0 && lines.length < maxLines) {
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

  if (remaining.length > 0 && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, Math.max(0, maxChars - 3))}...`;
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const mapFontFamily = (fontStyle: string | undefined): string => {
  const normalized = `${fontStyle ?? ""}`.trim().toLowerCase();
  return FONT_STYLE_MAP[normalized] ?? "InstagramOverlayFont, Noto Sans CJK KR, sans-serif";
};

const buildFontFaceCss = (): string => {
  const regularPath = path.resolve(moduleDir, "templates", "fonts", "Pretendard-Regular.otf");
  const boldPath = path.resolve(moduleDir, "templates", "fonts", "Pretendard-Bold.otf");
  const regularCss = fs.existsSync(regularPath)
    ? [
        "@font-face {",
        "  font-family: 'InstagramOverlayFont';",
        `  src: url('data:font/otf;base64,${fs.readFileSync(regularPath).toString("base64")}') format('opentype');`,
        "  font-weight: 400;",
        "}",
        "@font-face {",
        "  font-family: 'InstagramOverlayHandwritingFont';",
        `  src: url('data:font/otf;base64,${fs.readFileSync(regularPath).toString("base64")}') format('opentype');`,
        "  font-weight: 400;",
        "}"
      ].join("")
    : "";

  const boldCss = fs.existsSync(boldPath)
    ? [
        "@font-face {",
        "  font-family: 'InstagramOverlayFont';",
        `  src: url('data:font/otf;base64,${fs.readFileSync(boldPath).toString("base64")}') format('opentype');`,
        "  font-weight: 700;",
        "}",
        "@font-face {",
        "  font-family: 'InstagramOverlayHandwritingFont';",
        `  src: url('data:font/otf;base64,${fs.readFileSync(boldPath).toString("base64")}') format('opentype');`,
        "  font-weight: 700;",
        "}"
      ].join("")
    : "";

  return `${regularCss}${boldCss}`;
};
