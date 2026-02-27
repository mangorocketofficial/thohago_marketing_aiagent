import type { SupabaseClient } from "@supabase/supabase-js";
export const listChatMessagesByOrg = async (client: SupabaseClient, orgId: string) =>
  client
    .from("chat_messages")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
