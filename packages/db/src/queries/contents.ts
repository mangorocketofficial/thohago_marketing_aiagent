import type { SupabaseClient } from "@supabase/supabase-js";
import type { Content } from "@repo/types";

export const listContentsByOrg = async (client: SupabaseClient, orgId: string) =>
  client
    .from("contents")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

export const createContent = async (
  client: SupabaseClient,
  content: Omit<Content, "id" | "created_at" | "updated_at">
) => client.from("contents").insert(content).select("*").single();
