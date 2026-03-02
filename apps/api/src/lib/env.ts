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

type RagEmbeddingProvider = "openai" | "voyage";
type RagEmbeddingModel = "text-embedding-3-small" | "text-embedding-3-large";
type RagEmbeddingDim = 512 | 768 | 1536;

const parseEmbeddingProvider = (value: string): RagEmbeddingProvider => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "voyage") {
    return "voyage";
  }
  return "openai";
};

const parseEmbeddingModel = (value: string): RagEmbeddingModel => {
  const normalized = value.trim();
  if (normalized === "text-embedding-3-large") {
    return "text-embedding-3-large";
  }
  return "text-embedding-3-small";
};

const parseEmbeddingDim = (value: string, fallback: RagEmbeddingDim): RagEmbeddingDim => {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 512 || parsed === 768 || parsed === 1536) {
    return parsed;
  }
  return fallback;
};

const parseAllowedEmbeddingDims = (value: string, fallback: RagEmbeddingDim[]): RagEmbeddingDim[] => {
  const dims = value
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry): entry is RagEmbeddingDim => entry === 512 || entry === 768 || entry === 1536);

  if (!dims.length) {
    return fallback;
  }

  return [...new Set(dims)] as RagEmbeddingDim[];
};

const parsePositiveInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseNonNegativeInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const parseBoolean = (value: string, fallback: boolean): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled";

const parseSubscriptionStatus = (value: string, fallback: SubscriptionStatus): SubscriptionStatus => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "trial" || normalized === "active" || normalized === "past_due" || normalized === "canceled") {
    return normalized;
  }
  return fallback;
};

const ragEmbeddingProvider = parseEmbeddingProvider(readEnv("RAG_EMBEDDING_PROVIDER", "openai"));
const ragEmbeddingModel = parseEmbeddingModel(readEnv("RAG_EMBEDDING_MODEL", "text-embedding-3-small"));
const ragEmbeddingDimensions = parseEmbeddingDim(readEnv("RAG_EMBEDDING_DIMENSIONS", "1536"), 1536);
const ragAllowedEmbeddingDimensions = parseAllowedEmbeddingDims(
  readEnv("RAG_ALLOWED_EMBEDDING_DIMENSIONS", "512,768,1536"),
  [512, 768, 1536]
);
const ragTier1TokenBudget = parsePositiveInt(readEnv("RAG_TIER1_TOKEN_BUDGET", "2000"), 2000);
const ragTier2TotalBudget = parsePositiveInt(
  readEnv("RAG_TIER2_TOTAL_BUDGET", readEnv("RAG_TIER2_TOKEN_BUDGET", "4000")),
  4000
);
const ragContextTotalBudget = parsePositiveInt(
  readEnv("RAG_CONTEXT_TOTAL_BUDGET", String(ragTier1TokenBudget + ragTier2TotalBudget)),
  ragTier1TokenBudget + ragTier2TotalBudget
);
const ragTier2BrandProfileBudget = parsePositiveInt(readEnv("RAG_TIER2_BRAND_PROFILE_BUDGET", "800"), 800);
const ragTier2ContentBudget = parsePositiveInt(readEnv("RAG_TIER2_CONTENT_BUDGET", "1500"), 1500);
const ragTier2LocalDocBudget = parsePositiveInt(readEnv("RAG_TIER2_LOCAL_DOC_BUDGET", "1200"), 1200);
const ragTier2ChatPatternBudget = parsePositiveInt(readEnv("RAG_TIER2_CHAT_PATTERN_BUDGET", "500"), 500);
const ragForbiddenCheckEnabled = parseBoolean(readEnv("RAG_FORBIDDEN_CHECK_ENABLED", "true"), true);
const ragForbiddenMaxRetries = parseNonNegativeInt(readEnv("RAG_FORBIDDEN_MAX_RETRIES", "1"), 1);
const subscriptionBypass = parseBoolean(readEnv("SUBSCRIPTION_BYPASS", "false"), false);
const subscriptionDefaultStatus = parseSubscriptionStatus(readEnv("SUBSCRIPTION_DEFAULT_STATUS", "active"), "active");
const subscriptionTrialDays = parseNonNegativeInt(readEnv("SUBSCRIPTION_TRIAL_DAYS", "14"), 14);

export const env = {
  apiPort,
  apiSecret: requireEnv("API_SECRET"),
  supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: readEnv("ANTHROPIC_API_KEY"),
  anthropicModel: readEnv("ANTHROPIC_MODEL", "claude-opus-4-5"),
  openAiApiKey: readEnv("OPENAI_API_KEY"),
  openAiProfileModel: readEnv("OPENAI_PROFILE_MODEL", "gpt-4o-mini"),
  onboardingPinnedReviewPath: readEnv("ONBOARDING_PINNED_REVIEW_PATH"),
  ragEmbeddingProvider,
  ragEmbeddingModel,
  ragEmbeddingDimensions,
  ragAllowedEmbeddingDimensions,
  ragTier1TokenBudget,
  ragTier2TotalBudget,
  ragContextTotalBudget,
  ragTier2BrandProfileBudget,
  ragTier2ContentBudget,
  ragTier2LocalDocBudget,
  ragTier2ChatPatternBudget,
  ragForbiddenCheckEnabled,
  ragForbiddenMaxRetries,
  subscriptionBypass,
  subscriptionDefaultStatus,
  subscriptionTrialDays
};
