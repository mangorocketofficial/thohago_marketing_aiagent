import { countTokens, truncateToTokenBudget, type OrgBrandSettings, type RagSearchResult } from "@repo/rag";
import { env } from "../lib/env";
import { getRagEmbedder, ragConfig, ragRetriever } from "../lib/rag";
import {
  getDocumentExtractsByFolder,
  loadOrgBrandSettings,
  readReviewMarkdown,
  type FolderDocumentExtract
} from "../rag/data";
import { getMemoryMdForOrg } from "../rag/memory-service";
import type { FolderContext } from "./folder-context";
import type { ContextLevel, RagContextMeta } from "./types";

type InterviewAnswers = OrgBrandSettings["interview_answers"];

type Tier2SectionType =
  | "brand_profile"
  | "content_same_channel"
  | "content_cross_channel"
  | "local_doc"
  | "chat_pattern";

type Tier2Results = Record<Tier2SectionType, RagSearchResult[]>;

const SOURCE_ORDER: Tier2SectionType[] = [
  "brand_profile",
  "content_same_channel",
  "content_cross_channel",
  "local_doc",
  "chat_pattern"
];

const CONTENT_CROSS_CHANNEL_BUDGET = Math.min(300, Math.max(0, env.ragTier2ContentBudget));
const CONTENT_SAME_CHANNEL_BUDGET = Math.max(0, env.ragTier2ContentBudget - CONTENT_CROSS_CHANNEL_BUDGET);

const TIER2_SUB_BUDGETS: Record<Tier2SectionType, number> = {
  brand_profile: env.ragTier2BrandProfileBudget,
  content_same_channel: CONTENT_SAME_CHANNEL_BUDGET,
  content_cross_channel: CONTENT_CROSS_CHANNEL_BUDGET,
  local_doc: env.ragTier2LocalDocBudget,
  chat_pattern: env.ragTier2ChatPatternBudget
};

const CONTENT_RETRIEVAL = {
  SAME_CHANNEL_TOP_K: 3,
  SAME_CHANNEL_MIN_SIMILARITY: 0.65,
  SAME_CHANNEL_MIN_COUNT: 2,
  CROSS_CHANNEL_TOP_K: 2,
  CROSS_CHANNEL_MIN_SIMILARITY: 0.75
} as const;

const SECTION_LABELS: Record<Tier2SectionType, string> = {
  brand_profile: "Brand profile strategy",
  content_same_channel: "Same-channel past content (format + hashtags reference)",
  content_cross_channel: "Cross-channel related content (message only; ignore format)",
  local_doc: "Related local documents",
  chat_pattern: "User edit patterns"
};

const CAMPAIGN_CONTEXT_BUDGETS = {
  memoryMd: 800,
  brandReview: 1200,
  interviewAnswers: 200,
  folderSummary: 200,
  documentExtracts: 1000
} as const;

const BRAND_REVIEW_KEYWORDS = [
  "channel",
  "tone",
  "audit",
  "priority",
  "improvement",
  "target",
  "audience",
  "채널",
  "톤",
  "진단",
  "개선",
  "우선",
  "타겟",
  "오디언스"
];

const readString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const readNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const normalizeChannel = (value: string): string => value.trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const nonEmptyOrNull = (value: string): string | null => {
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeAnswer = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const normalizeInterviewAnswers = (value: unknown): InterviewAnswers | null => {
  if (!isRecord(value)) {
    return null;
  }

  const q1 = normalizeAnswer(value.q1);
  const q2 = normalizeAnswer(value.q2);
  const q3 = normalizeAnswer(value.q3);
  const q4 = normalizeAnswer(value.q4);

  if (!q1 && !q2 && !q3 && !q4) {
    return null;
  }

  return { q1, q2, q3, q4 };
};

const formatInterviewAnswers = (answers: InterviewAnswers | null): string | null => {
  if (!answers) {
    return null;
  }

  const lines = [
    `Tone and manner: ${answers.q1 || "n/a"}`,
    `Target audience: ${answers.q2 || "n/a"}`,
    `Forbidden words/topics: ${answers.q3 || "n/a"}`,
    `Campaign seasons: ${answers.q4 || "n/a"}`
  ];

  return nonEmptyOrNull(lines.join("\n"));
};

const summarizeFileList = (label: string, values: string[]): string => {
  if (!values.length) {
    return `- ${label}: 0`;
  }

  const preview = values.slice(0, 6).join(", ");
  const extraCount = Math.max(0, values.length - 6);
  return extraCount > 0
    ? `- ${label}: ${values.length} (${preview}, +${extraCount} more)`
    : `- ${label}: ${values.length} (${preview})`;
};

const formatFolderSummary = (folderContext: FolderContext | null | undefined): string | null => {
  if (!folderContext) {
    return null;
  }

  const activityFolder = readString(folderContext.activity_folder);
  if (!activityFolder) {
    return null;
  }

  const lines = [
    `Folder: ${activityFolder}`,
    `Total files: ${Math.max(0, Number(folderContext.total_files) || 0)}`,
    summarizeFileList("Images", Array.isArray(folderContext.images) ? folderContext.images : []),
    summarizeFileList("Videos", Array.isArray(folderContext.videos) ? folderContext.videos : []),
    summarizeFileList("Documents", Array.isArray(folderContext.documents) ? folderContext.documents : [])
  ];

  return nonEmptyOrNull(lines.join("\n"));
};

const splitMarkdownSections = (markdown: string): string[] => {
  const normalized = markdown.trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isHeader = /^#{1,6}\s+/.test(line.trim());
    if (isHeader && current.length) {
      sections.push(current.join("\n").trim());
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length) {
    sections.push(current.join("\n").trim());
  }

  return sections.filter(Boolean);
};

const pickBrandReviewHighlights = (markdown: string): string => {
  const sections = splitMarkdownSections(markdown);
  if (!sections.length) {
    return "";
  }

  const matched = sections.filter((section) => {
    const lower = section.toLowerCase();
    return BRAND_REVIEW_KEYWORDS.some((keyword) => lower.includes(keyword));
  });

  if (matched.length) {
    return matched.join("\n\n");
  }

  return sections.slice(0, 4).join("\n\n");
};

const formatDocumentExtractBlock = (extract: FolderDocumentExtract): string => {
  const title = readString(extract.file_name) || readString(extract.source_id) || "document";
  return `[${title}]\n${extract.content.trim()}`;
};

const formatDocumentExtracts = (
  extracts: FolderDocumentExtract[],
  tokenBudget: number
): {
  text: string | null;
  sources: RagContextMeta["tier2_sources"];
} => {
  if (!extracts.length) {
    return {
      text: null,
      sources: []
    };
  }

  const perDocBudget = Math.max(120, Math.floor(tokenBudget / Math.max(1, extracts.length)));
  const blocks: string[] = [];
  const sources: RagContextMeta["tier2_sources"] = [];

  for (const extract of extracts) {
    const block = truncateToTokenBudget(formatDocumentExtractBlock(extract), perDocBudget);
    if (!block) {
      continue;
    }

    blocks.push(block);
    sources.push({
      id: `local_doc:${extract.source_id}`,
      source_type: "local_doc",
      source_id: extract.source_id,
      similarity: 1
    });
  }

  const merged = truncateToTokenBudget(blocks.join("\n\n---\n\n"), tokenBudget);
  return {
    text: nonEmptyOrNull(merged),
    sources: merged ? sources : []
  };
};

const hasSupplementalContext = (params: {
  brandReviewMd: string | null;
  interviewAnswersText: string | null;
  folderSummary: string | null;
  documentExtracts: string | null;
}): boolean =>
  !!params.brandReviewMd || !!params.interviewAnswersText || !!params.folderSummary || !!params.documentExtracts;

const formatSectionRow = (sourceType: Tier2SectionType, result: RagSearchResult): string => {
  switch (sourceType) {
    case "brand_profile":
      return result.content;
    case "content_same_channel":
    case "content_cross_channel": {
      const channel = readString(result.metadata.channel) || "unknown";
      const publishedAt = readString(result.metadata.published_at) || "unknown";
      const score = readNumber(result.metadata.performance_score);
      const scoreText = score > 0 ? score.toFixed(2) : "n/a";
      return `[${channel} / ${publishedAt}] score: ${scoreText}\n${result.content}`;
    }
    case "local_doc": {
      const fileName = readString(result.metadata.file_name) || "unknown";
      const folder = readString(result.metadata.activity_folder) || "unknown";
      return `[${fileName} / ${folder}]\n${result.content}`;
    }
    case "chat_pattern":
      return result.content;
    default:
      return result.content;
  }
};

const emptyMeta = (level: ContextLevel): RagContextMeta => ({
  context_level: level,
  memory_md_generated_at: null,
  tier2_sources: [],
  total_context_tokens: 0,
  retrieval_avg_similarity: null
});

const fetchMemoryMd = async (orgId: string): Promise<{ markdown: string; generatedAt: string } | null> => {
  try {
    const memory = await getMemoryMdForOrg(orgId);
    return {
      markdown: memory.memory_md,
      generatedAt: memory.generated_at
    };
  } catch (error) {
    console.warn(
      `[RAG_CONTEXT] Failed to load memory.md for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
};

const fetchTier2 = async (
  orgId: string,
  channel: string,
  topic: string,
  activityFolder: string
): Promise<Tier2Results | null> => {
  try {
    const normalizedChannel = normalizeChannel(channel);
    const queryText = [normalizedChannel, topic, activityFolder]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" | ");

    const embedder = getRagEmbedder();
    const queryEmbedding = await embedder.generateEmbedding(queryText, ragConfig.defaultEmbeddingProfile);

    const [brandStrategies, sameChannelContent, relatedDocs, editPatterns] = await Promise.all([
      ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["brand_profile"],
        metadata_filter: normalizedChannel ? { section_channel: normalizedChannel } : {},
        top_k: 3,
        min_similarity: 0.6,
        embedding_profile: ragConfig.defaultEmbeddingProfile
      }),
      ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["content"],
        metadata_filter: normalizedChannel ? { channel: normalizedChannel } : {},
        top_k: CONTENT_RETRIEVAL.SAME_CHANNEL_TOP_K,
        min_similarity: CONTENT_RETRIEVAL.SAME_CHANNEL_MIN_SIMILARITY,
        boost: { field: "metadata.performance_score", weight: 1.5 },
        embedding_profile: ragConfig.defaultEmbeddingProfile
      }),
      ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["local_doc"],
        top_k: 3,
        min_similarity: 0.6,
        embedding_profile: ragConfig.defaultEmbeddingProfile
      }),
      ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["chat_pattern"],
        metadata_filter: normalizedChannel ? { channel: normalizedChannel } : {},
        top_k: 2,
        min_similarity: 0.6,
        embedding_profile: ragConfig.defaultEmbeddingProfile
      })
    ]);

    let crossChannelContent: RagSearchResult[] = [];
    if (normalizedChannel && sameChannelContent.length < CONTENT_RETRIEVAL.SAME_CHANNEL_MIN_COUNT) {
      const broadContent = await ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["content"],
        top_k: CONTENT_RETRIEVAL.SAME_CHANNEL_TOP_K + CONTENT_RETRIEVAL.CROSS_CHANNEL_TOP_K,
        min_similarity: CONTENT_RETRIEVAL.CROSS_CHANNEL_MIN_SIMILARITY,
        boost: { field: "metadata.performance_score", weight: 1.5 },
        embedding_profile: ragConfig.defaultEmbeddingProfile
      });

      const sameChannelIds = new Set(sameChannelContent.map((row) => row.id));
      crossChannelContent = broadContent
        .filter((row) => {
          const rowChannel = normalizeChannel(readString(row.metadata.channel));
          return rowChannel !== normalizedChannel && !sameChannelIds.has(row.id);
        })
        .slice(0, CONTENT_RETRIEVAL.CROSS_CHANNEL_TOP_K);
    }

    return {
      brand_profile: brandStrategies,
      content_same_channel: sameChannelContent,
      content_cross_channel: crossChannelContent,
      local_doc: relatedDocs,
      chat_pattern: editPatterns
    };
  } catch (error) {
    console.warn(
      `[RAG_CONTEXT] Tier2 retrieval failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
};

const assembleTier2Sections = (
  tier2: Tier2Results
): {
  sectionsText: string;
  sources: RagContextMeta["tier2_sources"];
  avgSimilarity: number | null;
} => {
  const sectionBlocks: string[] = [];
  const allSources: RagContextMeta["tier2_sources"] = [];
  const allSimilarities: number[] = [];

  for (const sourceType of SOURCE_ORDER) {
    const rows = tier2[sourceType];
    if (!rows.length) {
      continue;
    }

    const rawSection = rows.map((row) => formatSectionRow(sourceType, row)).join("\n---\n");
    const subBudget = TIER2_SUB_BUDGETS[sourceType] ?? 500;
    const sectionContent = truncateToTokenBudget(rawSection, subBudget);
    if (!sectionContent) {
      continue;
    }

    sectionBlocks.push(`=== Reference: ${SECTION_LABELS[sourceType]} ===\n${sectionContent}`);

    for (const row of rows) {
      allSources.push({
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        similarity: row.similarity
      });
      allSimilarities.push(row.similarity);
    }
  }

  const merged = sectionBlocks.join("\n\n");
  const tier2Text = truncateToTokenBudget(merged, env.ragTier2TotalBudget);

  const avgSimilarity = allSimilarities.length
    ? allSimilarities.reduce((sum, value) => sum + value, 0) / allSimilarities.length
    : null;

  return {
    sectionsText: tier2Text,
    sources: allSources,
    avgSimilarity
  };
};

export type CampaignPlanContext = {
  contextLevel: ContextLevel;
  memoryMd: string | null;
  meta: RagContextMeta;
};

export type EnrichedCampaignContext = {
  contextLevel: ContextLevel;
  memoryMd: string | null;
  brandReviewMd: string | null;
  interviewAnswers: InterviewAnswers | null;
  folderSummary: string | null;
  documentExtracts: string | null;
  meta: RagContextMeta;
};

export type ContentGenerationContext = {
  contextLevel: ContextLevel;
  memoryMd: string | null;
  tier2Sections: string;
  meta: RagContextMeta;
};

export const buildEnrichedCampaignContext = async (
  orgId: string,
  options?: {
    activityFolder?: string | null;
    folderContext?: FolderContext | null;
  }
): Promise<EnrichedCampaignContext> => {
  const memory = await fetchMemoryMd(orgId);
  const memoryMd = memory ? nonEmptyOrNull(truncateToTokenBudget(memory.markdown, CAMPAIGN_CONTEXT_BUDGETS.memoryMd)) : null;

  let brandReviewMd: string | null = null;
  let interviewAnswers: InterviewAnswers | null = null;

  try {
    const brandSettings = await loadOrgBrandSettings(orgId);
    if (brandSettings) {
      const reviewMarkdown = pickBrandReviewHighlights(readReviewMarkdown(brandSettings));
      brandReviewMd = nonEmptyOrNull(truncateToTokenBudget(reviewMarkdown, CAMPAIGN_CONTEXT_BUDGETS.brandReview));
      interviewAnswers = normalizeInterviewAnswers(brandSettings.interview_answers);
    }
  } catch (error) {
    console.warn(
      `[RAG_CONTEXT] Failed to load brand settings for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const interviewAnswersText = nonEmptyOrNull(
    truncateToTokenBudget(formatInterviewAnswers(interviewAnswers) ?? "", CAMPAIGN_CONTEXT_BUDGETS.interviewAnswers)
  );
  const folderSummary = nonEmptyOrNull(
    truncateToTokenBudget(formatFolderSummary(options?.folderContext) ?? "", CAMPAIGN_CONTEXT_BUDGETS.folderSummary)
  );

  let documentExtracts: string | null = null;
  let documentSources: RagContextMeta["tier2_sources"] = [];
  const activityFolder = readString(options?.folderContext?.activity_folder) || readString(options?.activityFolder);
  if (activityFolder) {
    try {
      const extracts = await getDocumentExtractsByFolder({
        orgId,
        activityFolder,
        limitDocs: 3,
        maxChunksPerDoc: 8
      });
      const formatted = formatDocumentExtracts(extracts, CAMPAIGN_CONTEXT_BUDGETS.documentExtracts);
      documentExtracts = formatted.text;
      documentSources = formatted.sources;
    } catch (error) {
      console.warn(
        `[RAG_CONTEXT] Failed to load folder document extracts for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const contextLevel: ContextLevel = !memoryMd
    ? "minimal"
    : hasSupplementalContext({
          brandReviewMd,
          interviewAnswersText,
          folderSummary,
          documentExtracts
        })
      ? "full"
      : "partial";

  const totalContextTokens =
    countTokens(memoryMd ?? "") +
    countTokens(brandReviewMd ?? "") +
    countTokens(interviewAnswersText ?? "") +
    countTokens(folderSummary ?? "") +
    countTokens(documentExtracts ?? "");

  return {
    contextLevel,
    memoryMd,
    brandReviewMd,
    interviewAnswers,
    folderSummary,
    documentExtracts,
    meta: {
      context_level: contextLevel,
      memory_md_generated_at: memory?.generatedAt ?? null,
      tier2_sources: documentSources,
      total_context_tokens: totalContextTokens,
      retrieval_avg_similarity: null
    }
  };
};

export const buildCampaignPlanContext = async (orgId: string): Promise<CampaignPlanContext> => {
  const enriched = await buildEnrichedCampaignContext(orgId);
  return {
    contextLevel: enriched.contextLevel,
    memoryMd: enriched.memoryMd,
    meta: enriched.meta
  };
};

export const buildContentGenerationContext = async (
  orgId: string,
  channel: string,
  topic: string,
  activityFolder: string
): Promise<ContentGenerationContext> => {
  const memory = await fetchMemoryMd(orgId);
  if (!memory) {
    return {
      contextLevel: "minimal",
      memoryMd: null,
      tier2Sections: "",
      meta: emptyMeta("minimal")
    };
  }

  const memoryTokens = countTokens(memory.markdown);
  const tier2 = await fetchTier2(orgId, channel, topic, activityFolder);
  if (!tier2) {
    return {
      contextLevel: "partial",
      memoryMd: memory.markdown,
      tier2Sections: "",
      meta: {
        context_level: "partial",
        memory_md_generated_at: memory.generatedAt,
        tier2_sources: [],
        total_context_tokens: memoryTokens,
        retrieval_avg_similarity: null
      }
    };
  }

  const assembled = assembleTier2Sections(tier2);
  const maxTier2FromTotal = Math.max(0, env.ragContextTotalBudget - memoryTokens);
  const finalTier2Budget = Math.min(env.ragTier2TotalBudget, maxTier2FromTotal);
  const finalTier2Sections = truncateToTokenBudget(assembled.sectionsText, finalTier2Budget);
  const tier2Tokens = countTokens(finalTier2Sections);
  const contextLevel: ContextLevel = finalTier2Sections ? "full" : "partial";

  return {
    contextLevel,
    memoryMd: memory.markdown,
    tier2Sections: finalTier2Sections,
    meta: {
      context_level: contextLevel,
      memory_md_generated_at: memory.generatedAt,
      tier2_sources: finalTier2Sections ? assembled.sources : [],
      total_context_tokens: memoryTokens + tier2Tokens,
      retrieval_avg_similarity: finalTier2Sections ? assembled.avgSimilarity : null
    }
  };
};
