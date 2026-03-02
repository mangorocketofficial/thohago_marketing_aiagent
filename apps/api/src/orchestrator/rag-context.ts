import { countTokens, truncateToTokenBudget, type RagSearchResult } from "@repo/rag";
import { env } from "../lib/env";
import { getRagEmbedder, ragConfig, ragRetriever } from "../lib/rag";
import { getMemoryMdForOrg } from "../rag/memory-service";
import type { ContextLevel, RagContextMeta } from "./types";

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

export type ContentGenerationContext = {
  contextLevel: ContextLevel;
  memoryMd: string | null;
  tier2Sections: string;
  meta: RagContextMeta;
};

export const buildCampaignPlanContext = async (orgId: string): Promise<CampaignPlanContext> => {
  const memory = await fetchMemoryMd(orgId);
  if (!memory) {
    return {
      contextLevel: "no_context",
      memoryMd: null,
      meta: emptyMeta("no_context")
    };
  }

  return {
    contextLevel: "tier1_only",
    memoryMd: memory.markdown,
    meta: {
      context_level: "tier1_only",
      memory_md_generated_at: memory.generatedAt,
      tier2_sources: [],
      total_context_tokens: countTokens(memory.markdown),
      retrieval_avg_similarity: null
    }
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
      contextLevel: "no_context",
      memoryMd: null,
      tier2Sections: "",
      meta: emptyMeta("no_context")
    };
  }

  const memoryTokens = countTokens(memory.markdown);
  const tier2 = await fetchTier2(orgId, channel, topic, activityFolder);
  if (!tier2) {
    return {
      contextLevel: "tier1_only",
      memoryMd: memory.markdown,
      tier2Sections: "",
      meta: {
        context_level: "tier1_only",
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
  const contextLevel: ContextLevel = finalTier2Sections ? "full" : "tier1_only";

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
