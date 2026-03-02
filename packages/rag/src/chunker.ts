import type { RagChunk, RagSourceType } from "@repo/types";

export type ChunkStrategy = "heading_split" | "single_doc" | "sliding_window" | "structured";

export const STRATEGY_MAP: Record<RagSourceType, ChunkStrategy> = {
  brand_profile: "heading_split",
  content: "single_doc",
  local_doc: "sliding_window",
  chat_pattern: "structured"
};

type ChunkContext = {
  sourceType: RagSourceType;
  sourceId: string;
  metadata?: Record<string, unknown>;
};

type SlidingWindowOptions = {
  windowSize?: number;
  overlap?: number;
};

const DEFAULT_WINDOW_SIZE = 700;
const DEFAULT_WINDOW_OVERLAP = 100;

const normalizeText = (value: string): string => value.replace(/\r\n/g, "\n").trim();

const clampWindowSize = (value?: number): number => {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_WINDOW_SIZE;
  }
  return Math.max(200, Math.floor(value));
};

const clampWindowOverlap = (value: number | undefined, windowSize: number): number => {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_WINDOW_OVERLAP;
  }
  const next = Math.max(0, Math.floor(value));
  return Math.min(next, Math.max(0, windowSize - 1));
};

const toChunks = (parts: string[], context: ChunkContext): RagChunk[] =>
  parts.map((content, chunkIndex) => ({
    source_type: context.sourceType,
    source_id: context.sourceId,
    chunk_index: chunkIndex,
    content,
    metadata: context.metadata ?? {}
  }));

const headingSplit = (text: string): string[] => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const sections: string[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (!currentHeading && !body) {
      currentBody = [];
      return;
    }

    const section = [currentHeading, body].filter((entry) => !!entry).join("\n\n").trim();
    if (section) {
      sections.push(section);
    }
    currentBody = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{2,3}\s+/.test(trimmed)) {
      flush();
      currentHeading = trimmed;
      continue;
    }
    currentBody.push(line);
  }

  flush();
  return sections.length ? sections : [normalized];
};

const singleDoc = (text: string): string[] => {
  const normalized = normalizeText(text);
  return normalized ? [normalized] : [];
};

const structuredSplit = (text: string): string[] => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return blocks.length ? blocks : [normalized];
};

const slidingWindow = (text: string, options?: SlidingWindowOptions): string[] => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const windowSize = clampWindowSize(options?.windowSize);
  const overlap = clampWindowOverlap(options?.overlap, windowSize);
  const chunks: string[] = [];

  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + windowSize);
    const piece = normalized.slice(start, end).trim();
    if (piece) {
      chunks.push(piece);
    }

    if (end >= normalized.length) {
      break;
    }

    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
};

export const chunkWithStrategy = (
  content: string,
  strategy: ChunkStrategy,
  context: ChunkContext,
  options?: SlidingWindowOptions
): RagChunk[] => {
  const parts =
    strategy === "heading_split"
      ? headingSplit(content)
      : strategy === "single_doc"
        ? singleDoc(content)
        : strategy === "sliding_window"
          ? slidingWindow(content, options)
          : structuredSplit(content);

  return toChunks(parts, context);
};

export const chunkBySourceType = (
  content: string,
  context: ChunkContext,
  options?: SlidingWindowOptions
): RagChunk[] => {
  const strategy = STRATEGY_MAP[context.sourceType];
  return chunkWithStrategy(content, strategy, context, options);
};
