import { Router } from "express";
import { hasValidApiSecret, requireUserJwt } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { requireActiveSubscription } from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";
import { getMemoryMdForOrg } from "../rag/memory-service";

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
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const memory = await getMemoryMdForOrg(orgId);
    res.json({
      ok: true,
      memory_md: memory.memory_md,
      token_count: memory.token_count,
      generated_at: memory.generated_at,
      freshness_key: memory.freshness_key,
      cache_hit: memory.cache_hit
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
