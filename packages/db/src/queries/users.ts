import type { SupabaseClient } from "@supabase/supabase-js";
export const getUserById = async (client: SupabaseClient, id: string) =>
  client.from("users").select("*").eq("id", id).single();

export const getUserByEmail = async (client: SupabaseClient, email: string) =>
  client.from("users").select("*").eq("email", email).maybeSingle();
