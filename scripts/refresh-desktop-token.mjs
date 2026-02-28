import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.join(process.cwd(), ".env");

const loadEnvMap = () => {
  const map = {};
  if (!fs.existsSync(envPath)) {
    throw new Error(".env file not found.");
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    map[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return map;
};

const upsertEnvValue = (content, key, value) => {
  const escaped = value.replace(/\r?\n/g, "");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${escaped}`);
  }
  return `${content.trimEnd()}\n${key}=${escaped}\n`;
};

const required = (map, name) => {
  const value = (map[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const map = loadEnvMap();
const supabaseUrl = required(map, "NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = required(map, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
const email = required(map, "RLS_TEST_USER_EMAIL");
const password = required(map, "RLS_TEST_USER_PASSWORD");

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});

if (error || !data.session?.access_token) {
  throw new Error(`Failed to sign in for desktop token refresh: ${error?.message ?? "unknown error"}`);
}

const token = data.session.access_token;
const expiresAt = data.session.expires_at ? new Date(data.session.expires_at * 1000).toISOString() : "unknown";

let envContent = fs.readFileSync(envPath, "utf8");
envContent = upsertEnvValue(envContent, "DESKTOP_SUPABASE_ACCESS_TOKEN", token);
envContent = upsertEnvValue(envContent, "RLS_TEST_USER_TOKEN", token);
fs.writeFileSync(envPath, envContent, "utf8");

console.log("Desktop token refreshed and saved to .env");
console.log(`Token expires at: ${expiresAt}`);

