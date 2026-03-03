import { HttpError } from "./errors";
import { supabaseAdmin } from "./supabase-admin";

export type OrgMembershipRole = "owner" | "admin" | "member";

const ROLE_SET = new Set<OrgMembershipRole>(["owner", "admin", "member"]);

export const requireOrgMembership = async (userId: string, orgId: string): Promise<OrgMembershipRole> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }

  const role = typeof data?.role === "string" ? data.role.trim().toLowerCase() : "";
  if (!ROLE_SET.has(role as OrgMembershipRole)) {
    throw new HttpError(403, "forbidden", "You are not a member of this organization.");
  }

  return role as OrgMembershipRole;
};
