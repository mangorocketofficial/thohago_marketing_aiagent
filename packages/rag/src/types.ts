import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccumulatedInsights,
  Campaign,
  CampaignPlan,
  CampaignPlanSchedule,
  CampaignStatus,
  MemoryMd,
  OrgBrandSettings,
  RagChunk,
  RagEmbedding,
  RagEmbeddingDim,
  RagEmbeddingModel,
  RagEmbeddingProfile,
  RagIngestionStatus,
  RagSearchOptions,
  RagSearchResult,
  RagSourceType
} from "@repo/types";

export type {
  AccumulatedInsights,
  Campaign,
  CampaignPlan,
  CampaignPlanSchedule,
  CampaignStatus,
  MemoryMd,
  OrgBrandSettings,
  RagChunk,
  RagEmbedding,
  RagEmbeddingDim,
  RagEmbeddingModel,
  RagEmbeddingProfile,
  RagIngestionStatus,
  RagSearchOptions,
  RagSearchResult,
  RagSourceType
} from "@repo/types";

export type RagSupabaseClient = SupabaseClient;

export type RagEmbeddingRow = RagEmbedding;

export type RagEmbeddingInsertRow = {
  org_id: string;
  source_type: RagSourceType;
  source_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding_model: RagEmbeddingModel;
  embedding_dim: RagEmbeddingDim;
  embedding: number[];
};

export type RagMatchRow = {
  id: string;
  content: string;
  source_type: RagSourceType;
  source_id: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

export type RagStoreApi = {
  insertBatch: (
    orgId: string,
    chunks: RagChunk[],
    embeddings: number[][],
    profile?: RagEmbeddingProfile
  ) => Promise<void>;
  upsertBySource: (
    orgId: string,
    sourceType: RagSourceType,
    sourceId: string,
    chunks: RagChunk[],
    embeddings: number[][],
    profile?: RagEmbeddingProfile
  ) => Promise<void>;
  deleteBySource: (
    orgId: string,
    sourceType: RagSourceType,
    sourceId: string,
    profile?: RagEmbeddingProfile
  ) => Promise<void>;
  replaceBySource: (
    orgId: string,
    sourceType: RagSourceType,
    sourceId: string,
    chunks: RagChunk[],
    embeddings: number[][],
    profile?: RagEmbeddingProfile
  ) => Promise<void>;
  deleteBySourceType: (orgId: string, sourceType: RagSourceType, profile?: RagEmbeddingProfile) => Promise<void>;
};

export type RagRetrieverApi = {
  searchSimilar: (
    orgId: string,
    queryEmbedding: number[],
    options?: RagSearchOptions
  ) => Promise<RagSearchResult[]>;
};
