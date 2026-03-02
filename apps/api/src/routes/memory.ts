import { Router } from "express";
import { buildMemoryMd, countTokens } from "@repo/rag";
import { hasValidApiSecret, requireUserJwt } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { loadActiveCampaigns, loadOrgBrandSettings, parseAccumulatedInsights } from "../rag/data";

const parseRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} is required.`);
  }
  return value.trim();
};

const requireOrgMembership = async (userId: string, orgId: string): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }
  if (!data?.role) {
    throw new HttpError(403, "forbidden", "You are not a member of this organization.");
  }
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

export const memoryRouter: Router = Router();

memoryRouter.get("/orgs/:orgId/memory", async (req, res) => {
  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const internalTokenRequest = hasValidApiSecret(req);

    if (!internalTokenRequest) {
      const user = await requireUserJwt(req, res);
      if (!user) {
        return;
      }
      await requireOrgMembership(user.userId, orgId);
    }

    const brandSettings = await loadOrgBrandSettings(orgId);
    if (!brandSettings) {
      throw new HttpError(404, "not_found", "Organization brand settings not found.");
    }

    const campaigns = await loadActiveCampaigns(orgId);
    const insights = parseAccumulatedInsights(brandSettings.accumulated_insights);
    const next = buildMemoryMd(brandSettings, campaigns, insights);

    if (
      brandSettings.memory_md &&
      brandSettings.memory_md_generated_at &&
      brandSettings.memory_freshness_key &&
      brandSettings.memory_freshness_key === next.freshness_key
    ) {
      res.json({
        ok: true,
        memory_md: brandSettings.memory_md,
        token_count: countTokens(brandSettings.memory_md),
        generated_at: brandSettings.memory_md_generated_at,
        freshness_key: brandSettings.memory_freshness_key,
        cache_hit: true
      });
      return;
    }

    void persistMemoryMdCache(orgId, {
      markdown: next.markdown,
      generatedAt: next.generated_at,
      freshnessKey: next.freshness_key
    }).catch((error) => {
      console.warn(`[MEMORY_CACHE] Persist failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    });

    res.json({
      ok: true,
      memory_md: next.markdown,
      token_count: next.token_count,
      generated_at: next.generated_at,
      freshness_key: next.freshness_key,
      cache_hit: false
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});
