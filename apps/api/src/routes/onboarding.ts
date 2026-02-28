import { Router } from "express";
import { requireUserJwt } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";

const parseOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const resolveOrgName = (value: unknown, fallbackEmail: string | null): string => {
  const direct = parseOptionalString(value);
  if (direct) {
    return direct.slice(0, 120);
  }

  if (fallbackEmail) {
    const username = fallbackEmail.split("@")[0]?.trim();
    if (username) {
      return `${username} Organization`;
    }
  }

  return "My Organization";
};

const ensureUserProfile = async (params: {
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<void> => {
  const email = params.email ?? `${params.userId}@local.invalid`;
  const payload = {
    id: params.userId,
    email,
    name: params.name ?? null
  };

  const { error } = await supabaseAdmin.from("users").upsert(payload, {
    onConflict: "id"
  });

  if (error) {
    throw new HttpError(500, "db_error", `Failed to upsert user profile: ${error.message}`);
  }
};

type MembershipRow = {
  org_id: string;
  role: "owner" | "admin" | "member";
  organizations?: {
    id: string;
    name: string;
    org_type: string;
  } | null;
};

const getExistingMembership = async (userId: string): Promise<MembershipRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("org_id, role, organizations(id, name, org_type)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }

  return (data as MembershipRow | null) ?? null;
};

const createInitialOrg = async (params: {
  userId: string;
  orgName: string;
}): Promise<{ orgId: string; orgName: string; orgType: string }> => {
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .insert({
      name: params.orgName,
      org_type: "nonprofit"
    })
    .select("id, name, org_type")
    .single();

  if (orgError || !org) {
    throw new HttpError(500, "db_error", `Failed to create organization: ${orgError?.message ?? "unknown"}`);
  }

  const { error: memberError } = await supabaseAdmin.from("organization_members").insert({
    org_id: org.id,
    user_id: params.userId,
    role: "owner"
  });

  if (memberError) {
    throw new HttpError(500, "db_error", `Failed to create organization membership: ${memberError.message}`);
  }

  return {
    orgId: org.id,
    orgName: org.name,
    orgType: org.org_type
  };
};

export const onboardingRouter: Router = Router();

onboardingRouter.post("/onboarding/bootstrap-org", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const inputName = parseOptionalString(body.name);
    await ensureUserProfile({
      userId: user.userId,
      email: user.email,
      name: inputName ?? user.name
    });

    const existing = await getExistingMembership(user.userId);
    if (existing?.org_id) {
      res.json({
        ok: true,
        created: false,
        org: {
          id: existing.org_id,
          name: existing.organizations?.name ?? "Organization",
          org_type: existing.organizations?.org_type ?? "nonprofit"
        },
        membership: {
          role: existing.role
        }
      });
      return;
    }

    const created = await createInitialOrg({
      userId: user.userId,
      orgName: resolveOrgName(body.org_name, user.email)
    });

    res.json({
      ok: true,
      created: true,
      org: {
        id: created.orgId,
        name: created.orgName,
        org_type: created.orgType
      },
      membership: {
        role: "owner"
      }
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
