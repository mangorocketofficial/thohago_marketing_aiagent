import { buildMemoryMd, countTokens } from "@repo/rag";
import { toLatestAnalysisSummary } from "../analytics/report-repository";
import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { getLatestAnalysisReport } from "../analytics/report-repository";
import { loadActiveCampaigns, loadOrgBrandSettings, parseAccumulatedInsights } from "./data";

export type MemoryMdResponse = {
  memory_md: string;
  token_count: number;
  generated_at: string;
  freshness_key: string;
  cache_hit: boolean;
};

const persistMemoryMdCache = async (
  orgId: string,
  payload: {
    markdown: string;
    generatedAt: string;
    freshnessKey: string;
  }
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("org_brand_settings")
    .update({
      memory_md: payload.markdown,
      memory_md_generated_at: payload.generatedAt,
      memory_freshness_key: payload.freshnessKey
    })
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Failed to persist memory cache: ${error.message}`);
  }
};

export const invalidateMemoryCache = async (orgId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("org_brand_settings")
    .update({ memory_freshness_key: null })
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Failed to invalidate memory cache: ${error.message}`);
  }
};

export const getMemoryMdForOrg = async (orgId: string): Promise<MemoryMdResponse> => {
  const brandSettings = await loadOrgBrandSettings(orgId);
  if (!brandSettings) {
    throw new HttpError(404, "not_found", "Organization brand settings not found.");
  }

  const [campaigns, latestReport] = await Promise.all([loadActiveCampaigns(orgId), getLatestAnalysisReport(orgId)]);
  const insights = parseAccumulatedInsights(brandSettings.accumulated_insights);
  const next = buildMemoryMd(brandSettings, campaigns, insights, toLatestAnalysisSummary(latestReport));

  if (
    brandSettings.memory_md &&
    brandSettings.memory_md_generated_at &&
    brandSettings.memory_freshness_key &&
    brandSettings.memory_freshness_key === next.freshness_key
  ) {
    return {
      memory_md: brandSettings.memory_md,
      token_count: countTokens(brandSettings.memory_md),
      generated_at: brandSettings.memory_md_generated_at,
      freshness_key: brandSettings.memory_freshness_key,
      cache_hit: true
    };
  }

  void persistMemoryMdCache(orgId, {
    markdown: next.markdown,
    generatedAt: next.generated_at,
    freshnessKey: next.freshness_key
  }).catch((error) => {
    console.warn(`[MEMORY_CACHE] Persist failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
  });

  return {
    memory_md: next.markdown,
    token_count: next.token_count,
    generated_at: next.generated_at,
    freshness_key: next.freshness_key,
    cache_hit: false
  };
};
