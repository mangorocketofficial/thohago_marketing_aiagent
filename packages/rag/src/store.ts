import type { SupabaseClient } from "@supabase/supabase-js";
import type { RagChunk, RagEmbeddingProfile, RagSourceType } from "@repo/types";
import {
  assertEmbeddingVectorDimension,
  DEFAULT_EMBEDDING_PROFILE,
  resolveEmbeddingProfile,
  toStorageEmbedding
} from "./embedder";
import type { RagEmbeddingInsertRow } from "./types";

const TABLE_NAME = "org_rag_embeddings";
const UPSERT_CONFLICT_COLUMNS = "org_id,source_type,source_id,chunk_index,embedding_model,embedding_dim";

const buildInsertRows = (
  orgId: string,
  chunks: RagChunk[],
  embeddings: number[][],
  profile: RagEmbeddingProfile
): RagEmbeddingInsertRow[] => {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Chunk/embedding length mismatch. chunks=${chunks.length}, embeddings=${embeddings.length}.`
    );
  }

  return chunks.map((chunk, index) => {
    if (!chunk.source_id?.trim()) {
      throw new Error(`Chunk at index ${index} is missing source_id.`);
    }

    const embedding = embeddings[index] ?? [];
    assertEmbeddingVectorDimension(embedding, profile.dimensions);
    const storageEmbedding = toStorageEmbedding(embedding, profile.dimensions);

    return {
      org_id: orgId,
      source_type: chunk.source_type,
      source_id: chunk.source_id,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      metadata: chunk.metadata ?? {},
      embedding_model: profile.model,
      embedding_dim: profile.dimensions,
      embedding: storageEmbedding
    };
  });
};

export class RagStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async insertBatch(
    orgId: string,
    chunks: RagChunk[],
    embeddings: number[][],
    profile: RagEmbeddingProfile = DEFAULT_EMBEDDING_PROFILE
  ): Promise<void> {
    if (!chunks.length) {
      return;
    }

    const resolvedProfile = resolveEmbeddingProfile(profile, DEFAULT_EMBEDDING_PROFILE);
    const rows = buildInsertRows(orgId, chunks, embeddings, resolvedProfile);

    const { error } = await this.supabase.from(TABLE_NAME).insert(rows);
    if (error) {
      throw new Error(`Failed to insert RAG embeddings: ${error.message}`);
    }
  }

  async upsertBySource(
    orgId: string,
    sourceType: RagSourceType,
    sourceId: string,
    chunks: RagChunk[],
    embeddings: number[][],
    profile: RagEmbeddingProfile = DEFAULT_EMBEDDING_PROFILE
  ): Promise<void> {
    if (!sourceId.trim()) {
      throw new Error("sourceId is required for upsertBySource.");
    }

    const normalizedChunks = chunks.map((chunk, index) => ({
      ...chunk,
      source_type: sourceType,
      source_id: sourceId,
      chunk_index: index
    }));

    if (!normalizedChunks.length) {
      await this.deleteBySource(orgId, sourceType, sourceId, profile);
      return;
    }

    const resolvedProfile = resolveEmbeddingProfile(profile, DEFAULT_EMBEDDING_PROFILE);
    const rows = buildInsertRows(orgId, normalizedChunks, embeddings, resolvedProfile);
    const { error } = await this.supabase
      .from(TABLE_NAME)
      .upsert(rows, { onConflict: UPSERT_CONFLICT_COLUMNS, ignoreDuplicates: false });

    if (error) {
      throw new Error(`Failed to upsert RAG embeddings: ${error.message}`);
    }
  }

  async deleteBySource(
    orgId: string,
    sourceType: RagSourceType,
    sourceId: string,
    profile?: RagEmbeddingProfile
  ): Promise<void> {
    let request = this.supabase.from(TABLE_NAME).delete().eq("org_id", orgId).eq("source_type", sourceType).eq(
      "source_id",
      sourceId
    );

    if (profile) {
      const resolvedProfile = resolveEmbeddingProfile(profile, DEFAULT_EMBEDDING_PROFILE);
      request = request.eq("embedding_model", resolvedProfile.model).eq("embedding_dim", resolvedProfile.dimensions);
    }

    const { error } = await request;
    if (error) {
      throw new Error(`Failed to delete RAG embeddings by source: ${error.message}`);
    }
  }

  async updateMetadata(
    orgId: string,
    sourceType: RagSourceType,
    sourceId: string,
    patch: Record<string, unknown>,
    profile?: RagEmbeddingProfile
  ): Promise<void> {
    let request = this.supabase
      .from(TABLE_NAME)
      .select("id, metadata")
      .eq("org_id", orgId)
      .eq("source_type", sourceType)
      .eq("source_id", sourceId);

    if (profile) {
      const resolvedProfile = resolveEmbeddingProfile(profile, DEFAULT_EMBEDDING_PROFILE);
      request = request.eq("embedding_model", resolvedProfile.model).eq("embedding_dim", resolvedProfile.dimensions);
    }

    const { data, error } = await request;
    if (error) {
      throw new Error(`Failed to load existing metadata: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) {
        continue;
      }

      const current = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const merged = {
        ...(current as Record<string, unknown>),
        ...patch
      };

      const { error: updateError } = await this.supabase.from(TABLE_NAME).update({ metadata: merged }).eq("id", id);
      if (updateError) {
        throw new Error(`Failed to update RAG metadata: ${updateError.message}`);
      }
    }
  }
}

export const createRagStore = (supabase: SupabaseClient): RagStore => new RagStore(supabase);
