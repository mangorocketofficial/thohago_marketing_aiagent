import type { Response } from "express";
import { env } from "./env";
import { HttpError } from "./errors";
import { supabaseAdmin } from "./supabase-admin";

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled";
export type SubscriptionProvider = "manual" | "stripe" | "paddle";

export type OrgSubscription = {
  id: string;
  org_id: string;
  provider: SubscriptionProvider;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrgEntitlement = {
  org_id: string;
  status: SubscriptionStatus;
  is_entitled: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

const parseString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseSubscriptionStatus = (value: unknown): SubscriptionStatus => {
  const normalized = parseString(value)?.toLowerCase();
  if (normalized === "trial" || normalized === "active" || normalized === "past_due" || normalized === "canceled") {
    return normalized;
  }
  throw new HttpError(500, "invalid_subscription", "Subscription status is invalid.");
};

const parseSubscriptionProvider = (value: unknown): SubscriptionProvider => {
  const normalized = parseString(value)?.toLowerCase();
  if (normalized === "manual" || normalized === "stripe" || normalized === "paddle") {
    return normalized;
  }
  throw new HttpError(500, "invalid_subscription", "Subscription provider is invalid.");
};

const parseRequiredString = (value: unknown, field: string): string => {
  const parsed = parseString(value);
  if (!parsed) {
    throw new HttpError(500, "invalid_subscription", `Subscription field ${field} is missing.`);
  }
  return parsed;
};

const toIsoOrNull = (value: unknown): string | null => {
  const parsed = parseString(value);
  if (!parsed) {
    return null;
  }
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const toOrgSubscription = (row: Record<string, unknown>): OrgSubscription => ({
  id: parseRequiredString(row.id, "id"),
  org_id: parseRequiredString(row.org_id, "org_id"),
  provider: parseSubscriptionProvider(row.provider),
  provider_customer_id: parseString(row.provider_customer_id),
  provider_subscription_id: parseString(row.provider_subscription_id),
  status: parseSubscriptionStatus(row.status),
  trial_ends_at: toIsoOrNull(row.trial_ends_at),
  current_period_end: toIsoOrNull(row.current_period_end),
  canceled_at: toIsoOrNull(row.canceled_at),
  created_at: parseRequiredString(row.created_at, "created_at"),
  updated_at: parseRequiredString(row.updated_at, "updated_at")
});

const readSubscriptionRow = async (orgId: string): Promise<OrgSubscription | null> => {
  const { data, error } = await supabaseAdmin
    .from("org_subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query org subscription: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return toOrgSubscription(data as Record<string, unknown>);
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const defaultTrialEndsAt = (status: SubscriptionStatus): string | null => {
  if (status !== "trial" || env.subscriptionTrialDays <= 0) {
    return null;
  }
  return addDays(new Date(), env.subscriptionTrialDays).toISOString();
};

export const ensureOrgSubscription = async (orgId: string): Promise<OrgSubscription> => {
  const existing = await readSubscriptionRow(orgId);
  if (existing) {
    return existing;
  }

  const insertPayload = {
    org_id: orgId,
    provider: "manual" as const,
    status: env.subscriptionDefaultStatus,
    trial_ends_at: defaultTrialEndsAt(env.subscriptionDefaultStatus)
  };

  const { data, error } = await supabaseAdmin.from("org_subscriptions").insert(insertPayload).select("*").single();

  if (!error && data) {
    return toOrgSubscription(data as Record<string, unknown>);
  }

  if ((error as { code?: string } | null)?.code === "23505") {
    const raced = await readSubscriptionRow(orgId);
    if (raced) {
      return raced;
    }
  }

  throw new HttpError(500, "db_error", `Failed to create org subscription: ${error?.message ?? "unknown"}`);
};

export const getOrgSubscription = async (orgId: string): Promise<OrgSubscription> => ensureOrgSubscription(orgId);

export const isActiveSubscription = (subscription: Pick<OrgSubscription, "status" | "trial_ends_at">): boolean => {
  if (subscription.status === "active") {
    return true;
  }
  if (subscription.status !== "trial") {
    return false;
  }
  if (!subscription.trial_ends_at) {
    return true;
  }
  const trialEndsAt = new Date(subscription.trial_ends_at);
  if (Number.isNaN(trialEndsAt.getTime())) {
    return false;
  }
  return Date.now() <= trialEndsAt.getTime();
};

export const getOrgEntitlement = async (orgId: string): Promise<OrgEntitlement> => {
  const subscription = await getOrgSubscription(orgId);
  return {
    org_id: orgId,
    status: subscription.status,
    is_entitled: env.subscriptionBypass ? true : isActiveSubscription(subscription),
    trial_ends_at: subscription.trial_ends_at,
    current_period_end: subscription.current_period_end
  };
};

export const requireActiveSubscription = async (res: Response, orgId: string): Promise<boolean> => {
  if (env.subscriptionBypass) {
    return true;
  }

  const entitlement = await getOrgEntitlement(orgId);
  if (entitlement.is_entitled) {
    return true;
  }

  res.status(402).json({
    ok: false,
    error: "payment_required",
    message: "Active subscription is required to use this feature.",
    org_id: orgId,
    entitlement_status: entitlement.status
  });
  return false;
};

export const parseStatusInput = (value: unknown): SubscriptionStatus => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", "status is required.");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "trial" || normalized === "active" || normalized === "past_due" || normalized === "canceled") {
    return normalized;
  }
  throw new HttpError(400, "invalid_payload", "status must be trial, active, past_due, or canceled.");
};
