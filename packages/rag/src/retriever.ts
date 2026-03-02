import type { SupabaseClient } from "@supabase/supabase-js";
import type { RagEmbeddingProfile, RagSearchOptions, RagSearchResult } from "@repo/types";
import { DEFAULT_EMBEDDING_PROFILE, resolveEmbeddingProfile, toStorageEmbedding } from "./embedder";
import type { RagMatchRow } from "./types";

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIMILARITY = 0.65;
const MAX_RPC_MATCH_COUNT = 50;

const clampTopK = (value?: number): number => {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_TOP_K;
  }
  const normalized = Math.floor(value);
  if (normalized < 1) {
    return DEFAULT_TOP_K;
  }
  return Math.min(normalized, MAX_RPC_MATCH_COUNT);
};

const clampSimilarity = (value?: number): number => {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return DEFAULT_MIN_SIMILARITY;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

const readNumericField = (value: unknown): number => {
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

const readNestedValue = (source: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
};

const readBoostValue = (metadata: Record<string, unknown>, fieldPath: string): number => {
  if (!fieldPath.trim()) {
    return 0;
  }

  const normalizedPath = fieldPath.startsWith("metadata.") ? fieldPath.slice("metadata.".length) : fieldPath;
  return readNumericField(readNestedValue(metadata, normalizedPath));
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const toRagResult = (
  row: RagMatchRow,
  boost: RagSearchOptions["boost"]
): RagSearchResult & { weighted_score: number } => {
  const metadata = toRecord(row.metadata);
  const similarity = clampSimilarity(readNumericField(row.similarity));
  const boostWeight = boost?.weight ?? 0;
  const boostValue = boost ? readBoostValue(metadata, boost.field) : 0;
  const multiplier = Math.max(0, 1 + boostWeight * boostValue);
  const weightedScore = similarity * multiplier;

  return {
    id: row.id,
    content: row.content,
    source_type: row.source_type,
    source_id: row.source_id,
    metadata,
    similarity,
    weighted_score: weightedScore
  };
};

export class RagRetriever {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async searchSimilar(
    orgId: string,
    queryEmbedding: number[],
    options: RagSearchOptions = {}
  ): Promise<RagSearchResult[]> {
    const profile: RagEmbeddingProfile = resolveEmbeddingProfile(
      options.embedding_profile,
      DEFAULT_EMBEDDING_PROFILE
    );

    if (queryEmbedding.length !== profile.dimensions) {
      throw new Error(
        `Query embedding dimension mismatch. Expected ${profile.dimensions}, got ${queryEmbedding.length}.`
      );
    }

    const queryVector = toStorageEmbedding(queryEmbedding, profile.dimensions);

    const topK = clampTopK(options.top_k);
    const minSimilarity = clampSimilarity(options.min_similarity);
    const metadataFilter =
      options.metadata_filter && Object.keys(options.metadata_filter).length > 0 ? options.metadata_filter : {};

    const rpcMatchCount = Math.min(Math.max(topK * 4, topK), MAX_RPC_MATCH_COUNT);
    const { data, error } = await this.supabase.rpc("match_rag_embeddings", {
      query_embedding: queryVector,
      query_org_id: orgId,
      query_embedding_model: profile.model,
      query_embedding_dim: profile.dimensions,
      query_source_types: options.source_types?.length ? options.source_types : null,
      query_metadata_filter: metadataFilter,
      match_threshold: minSimilarity,
      match_count: rpcMatchCount
    });

    if (error) {
      throw new Error(`Failed to search RAG embeddings: ${error.message}`);
    }

    const rows = Array.isArray(data) ? (data as RagMatchRow[]) : [];
    const reranked = rows
      .map((row) => toRagResult(row, options.boost))
      .sort((left, right) => {
        if (right.weighted_score !== left.weighted_score) {
          return right.weighted_score - left.weighted_score;
        }
        return right.similarity - left.similarity;
      });

    return reranked.slice(0, topK);
  }
}

export const createRagRetriever = (supabase: SupabaseClient): RagRetriever => new RagRetriever(supabase);
