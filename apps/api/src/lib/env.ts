import fs from "node:fs";
import path from "node:path";

let loaded = false;

const loadEnvFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = value;
  }
};

const loadEnv = () => {
  if (loaded) {
    return;
  }

  loaded = true;

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".env"),
    path.join(cwd, ".env.local"),
    path.resolve(cwd, "../../.env"),
    path.resolve(cwd, "../../.env.local")
  ];

  for (const candidate of candidates) {
    loadEnvFile(candidate);
  }
};

const readEnv = (name: string, fallback = ""): string => {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
};

const requireEnv = (name: string): string => {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

loadEnv();

const apiPort = Number.parseInt(readEnv("API_PORT", "3001"), 10);
if (!Number.isFinite(apiPort) || apiPort <= 0) {
  throw new Error(`Invalid API_PORT: ${readEnv("API_PORT", "3001")}`);
}

export const env = {
  apiPort,
  apiSecret: requireEnv("API_SECRET"),
  supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: readEnv("ANTHROPIC_API_KEY"),
  anthropicModel: readEnv("ANTHROPIC_MODEL", "claude-opus-4-5"),
  openAiApiKey: readEnv("OPENAI_API_KEY"),
  openAiProfileModel: readEnv("OPENAI_PROFILE_MODEL", "gpt-4o-mini")
};
