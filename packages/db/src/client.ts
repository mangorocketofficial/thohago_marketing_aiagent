import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

let anonClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (anonClient) return anonClient;

  anonClient = createClient(
    readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  return anonClient;
};

export const getServiceSupabaseClient = (): SupabaseClient => {
  if (serviceClient) return serviceClient;

  serviceClient = createClient(
    readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  return serviceClient;
};

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    const client = getSupabaseClient() as any;
    const value = Reflect.get(client, property, receiver);

    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }

    return value;
  }
});
