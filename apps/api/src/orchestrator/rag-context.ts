import { countTokens, truncateToTokenBudget, type RagSearchResult, type RagSourceType } from "@repo/rag";
import { env } from "../lib/env";
import { getRagEmbedder, ragConfig, ragRetriever } from "../lib/rag";
import { getMemoryMdForOrg } from "../rag/memory-service";
import type { ContextLevel, RagContextMeta } from "./types";

type Tier2Results = Record<RagSourceType, RagSearchResult[]>;

const SOURCE_ORDER: RagSourceType[] = ["brand_profile", "content", "local_doc", "chat_pattern"];

const TIER2_SUB_BUDGETS: Record<RagSourceType, number> = {
  brand_profile: env.ragTier2BrandProfileBudget,
  content: env.ragTier2ContentBudget,
  local_doc: env.ragTier2LocalDocBudget,
  chat_pattern: env.ragTier2ChatPatternBudget
};

const SECTION_LABELS: Record<RagSourceType, string> = {
  brand_profile: "채널별 브랜드 전략",
  content: "유사 과거 콘텐츠",
  local_doc: "관련 활동 문서",
  chat_pattern: "사용자 수정 패턴"
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

const formatSectionRow = (sourceType: RagSourceType, result: RagSearchResult): string => {
  switch (sourceType) {
    case "brand_profile":
      return result.content;
    case "content": {
      const channel = readString(result.metadata.channel) || "unknown";
      const publishedAt = readString(result.metadata.published_at) || "unknown";
      const score = readNumber(result.metadata.performance_score);
      const scoreText = score > 0 ? score.toFixed(2) : "n/a";
      return `[${channel} / ${publishedAt}] 성과: ${scoreText}\n${result.content}`;
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
    console.warn(`[RAG_CONTEXT] Failed to load memory.md for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
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
    const queryText = [channel, topic, activityFolder].map((entry) => entry.trim()).filter(Boolean).join(" | ");
    const embedder = getRagEmbedder();
    const queryEmbedding = await embedder.generateEmbedding(queryText, ragConfig.defaultEmbeddingProfile);

    const [brandStrategies, similarContent, relatedDocs, editPatterns] = await Promise.all([
      ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["brand_profile"],
        metadata_filter: channel ? { section_channel: channel } : {},
        top_k: 3,
        min_similarity: 0.6,
        embedding_profile: ragConfig.defaultEmbeddingProfile
      }),
      ragRetriever.searchSimilar(orgId, queryEmbedding, {
        source_types: ["content"],
        top_k: 3,
        min_similarity: 0.65,
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
        metadata_filter: channel ? { channel } : {},
        top_k: 2,
        min_similarity: 0.6,
        embedding_profile: ragConfig.defaultEmbeddingProfile
      })
    ]);

    return {
      brand_profile: brandStrategies,
      content: similarContent,
      local_doc: relatedDocs,
      chat_pattern: editPatterns
    };
  } catch (error) {
    console.warn(`[RAG_CONTEXT] Tier2 retrieval failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
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

    sectionBlocks.push(`=== 참고: ${SECTION_LABELS[sourceType]} ===\n${sectionContent}`);

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
