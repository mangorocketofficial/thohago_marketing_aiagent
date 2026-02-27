import type { SupabaseClient } from "@supabase/supabase-js";
export const listOrganizations = async (client: SupabaseClient) =>
  client.from("organizations").select("*");

export const getOrganizationById = async (client: SupabaseClient, id: string) =>
  client.from("organizations").select("*").eq("id", id).single();
