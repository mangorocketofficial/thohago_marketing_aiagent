import type { RagChunk, RagSourceType } from "@repo/types";

export type ChunkStrategy = "heading_split" | "single_doc" | "sliding_window" | "structured";

export const STRATEGY_MAP: Record<RagSourceType, ChunkStrategy> = {
  brand_profile: "heading_split",
  content: "single_doc",
  local_doc: "sliding_window",
  chat_pattern: "structured",
  analysis_report: "heading_split"
};

export type ChunkContext = {
  sourceType: RagSourceType;
  sourceId: string;
  metadata?: Record<string, unknown>;
};

type SlidingWindowOptions = {
  windowSize?: number;
  overlap?: number;
};

type HeadingSplitSection = {
  heading: string;
  content: string;
};

type ChunkEntry = {
  content: string;
  metadata?: Record<string, unknown>;
};

export type HeadingChunkOptions = {
  tagChannelSections?: boolean;
};

const CHANNEL_HEADING_MAP: Array<{ pattern: string; channel: string }> = [
  { pattern: "웹사이트", channel: "website" },
  { pattern: "인스타그램", channel: "instagram" },
  { pattern: "네이버 블로그", channel: "naver_blog" },
  { pattern: "채널 간", channel: "cross_channel" },
  { pattern: "일관성", channel: "cross_channel" },
  { pattern: "통합 전략", channel: "strategy" },
  { pattern: "수정 제안", channel: "recommendations" },
  { pattern: "컴플라이언스", channel: "compliance" },
  { pattern: "종합 요약", channel: "summary" }
];

const DEFAULT_WINDOW_SIZE = 700;
const DEFAULT_WINDOW_OVERLAP = 100;

const normalizeText = (value: string): string => value.replace(/\r\n/g, "\n").trim();

const normalizeHeading = (value: string): string => value.replace(/^#+\s*/, "").trim();

const resolveSectionChannel = (heading: string): string | null => {
  const normalized = normalizeHeading(heading);
  for (const mapping of CHANNEL_HEADING_MAP) {
    if (normalized.includes(mapping.pattern)) {
      return mapping.channel;
    }
  }
  return null;
};

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

const toChunks = (entries: ChunkEntry[], context: ChunkContext): RagChunk[] =>
  entries.map((entry, chunkIndex) => ({
    source_type: context.sourceType,
    source_id: context.sourceId,
    chunk_index: chunkIndex,
    content: entry.content,
    metadata: {
      ...(context.metadata ?? {}),
      ...(entry.metadata ?? {})
    }
  }));

const parseHeadingSections = (text: string): HeadingSplitSection[] => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const sections: HeadingSplitSection[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (!currentHeading && !body) {
      currentBody = [];
      return;
    }

    const content = [currentHeading, body].filter((entry) => !!entry).join("\n\n").trim();
    if (content) {
      sections.push({
        heading: currentHeading,
        content
      });
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
  if (sections.length) {
    return sections;
  }
  return [
    {
      heading: "",
      content: normalized
    }
  ];
};

const headingSplit = (text: string): string[] => parseHeadingSections(text).map((section) => section.content);

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

export const chunkByHeading = (
  content: string,
  context: ChunkContext,
  options: HeadingChunkOptions = {}
): RagChunk[] => {
  const sections = parseHeadingSections(content);
  const entries = sections.map((section) => {
    const metadata: Record<string, unknown> = {};
    if (section.heading) {
      metadata.section_heading = normalizeHeading(section.heading);
    }
    if (options.tagChannelSections && section.heading) {
      const channel = resolveSectionChannel(section.heading);
      if (channel) {
        metadata.section_channel = channel;
      }
    }
    return {
      content: section.content,
      metadata
    };
  });
  return toChunks(entries, context);
};

export const chunkStructuredText = (content: string, context: ChunkContext): RagChunk[] =>
  toChunks(structuredSplit(content).map((entry) => ({ content: entry })), context);

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

  return toChunks(parts.map((entry) => ({ content: entry })), context);
};

export const chunkBySourceType = (
  content: string,
  context: ChunkContext,
  options?: SlidingWindowOptions
): RagChunk[] => {
  const strategy = STRATEGY_MAP[context.sourceType];
  return chunkWithStrategy(content, strategy, context, options);
};
