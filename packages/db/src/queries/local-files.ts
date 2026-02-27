import type { SupabaseClient } from "@supabase/supabase-js";
export const listLocalFilesByOrg = async (client: SupabaseClient, orgId: string) =>
  client
    .from("local_files")
    .select("*")
    .eq("org_id", orgId)
    .order("indexed_at", { ascending: false });
