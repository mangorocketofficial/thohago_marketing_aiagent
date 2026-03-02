import { Router } from "express";
import { requireApiSecret, requireUserJwt } from "../lib/auth";
import { env } from "../lib/env";
import { HttpError, toHttpError } from "../lib/errors";
import {
  ensureOrgSubscription,
  getOrgEntitlement,
  getOrgSubscription,
  parseStatusInput,
  type SubscriptionStatus
} from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";

const parseRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} is required.`);
  }
  return value.trim();
};

const parseOptionalIsoPatch = (
  row: Record<string, unknown>,
  field: "trial_ends_at" | "current_period_end" | "canceled_at"
): { provided: boolean; value: string | null } => {
  if (!Object.prototype.hasOwnProperty.call(row, field)) {
    return { provided: false, value: null };
  }

  const value = row[field];
  if (value === null) {
    return { provided: true, value: null };
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} must be an ISO datetime string or null.`);
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "invalid_payload", `${field} must be a valid ISO datetime string.`);
  }
  return { provided: true, value: parsed.toISOString() };
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

const computeDefaultTrialEndsAt = (status: SubscriptionStatus): string | null => {
  if (status !== "trial" || env.subscriptionTrialDays <= 0) {
    return null;
  }
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + env.subscriptionTrialDays);
  return next.toISOString();
};

export const entitlementRouter: Router = Router();

entitlementRouter.get("/orgs/:orgId/entitlement", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    await requireOrgMembership(user.userId, orgId);

    const entitlement = await getOrgEntitlement(orgId);
    res.json({
      ok: true,
      ...entitlement
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

entitlementRouter.post("/orgs/:orgId/entitlement/dev-set", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const status = parseStatusInput(body.status);
    const trialEndsAtPatch = parseOptionalIsoPatch(body, "trial_ends_at");
    const currentPeriodEndPatch = parseOptionalIsoPatch(body, "current_period_end");
    const canceledAtPatch = parseOptionalIsoPatch(body, "canceled_at");

    await ensureOrgSubscription(orgId);
    const existing = await getOrgSubscription(orgId);

    const updatePayload: Record<string, unknown> = {
      status,
      trial_ends_at: trialEndsAtPatch.provided
        ? trialEndsAtPatch.value
        : status === "trial"
          ? existing.trial_ends_at ?? computeDefaultTrialEndsAt(status)
          : null,
      current_period_end: currentPeriodEndPatch.provided ? currentPeriodEndPatch.value : existing.current_period_end,
      canceled_at: canceledAtPatch.provided ? canceledAtPatch.value : existing.canceled_at
    };

    const { error } = await supabaseAdmin.from("org_subscriptions").update(updatePayload).eq("org_id", orgId);
    if (error) {
      throw new HttpError(500, "db_error", `Failed to update org subscription: ${error.message}`);
    }

    const entitlement = await getOrgEntitlement(orgId);
    res.json({
      ok: true,
      ...entitlement
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
