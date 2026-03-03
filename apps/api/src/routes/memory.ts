import { Router } from "express";
import { hasValidApiSecret, requireUserJwt } from "../lib/auth";
import { requireOrgMembership } from "../lib/org-membership";
import { toHttpError } from "../lib/errors";
import { parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";
import { getMemoryMdForOrg } from "../rag/memory-service";

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
