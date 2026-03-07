import { supabaseAdmin } from "../lib/supabase-admin";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Sync normalized performance score into RAG embedding metadata.
 */
export const syncPerformanceScoreToRag = async (
  orgId: string,
  contentId: string,
  score: number
): Promise<{ updated: number }> => {
  const roundedScore = Math.round(score * 100) / 100;
  const { data, error } = await supabaseAdmin
    .from("org_rag_embeddings")
    .select("id,metadata")
    .eq("org_id", orgId)
    .eq("source_type", "content")
    .eq("source_id", contentId);

  if (error) {
    throw new Error(`Failed to load content embeddings for score sync: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return { updated: 0 };
  }

  let updated = 0;
  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id : "";
    if (!id) {
      continue;
    }

    const currentMetadata = asRecord(row.metadata);
    const currentScore =
      typeof currentMetadata.performance_score === "number" && Number.isFinite(currentMetadata.performance_score)
        ? currentMetadata.performance_score
        : null;
    if (currentScore !== null && Math.abs(currentScore - roundedScore) < 0.001) {
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("org_rag_embeddings")
      .update({
        metadata: {
          ...currentMetadata,
          performance_score: roundedScore
        }
      })
      .eq("id", id)
      .eq("org_id", orgId);

    if (updateError) {
      throw new Error(`Failed to update embedding metadata score: ${updateError.message}`);
    }

    updated += 1;
  }

  return { updated };
};

