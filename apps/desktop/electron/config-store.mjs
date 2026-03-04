import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { SEED_ORG_ID } from "./constants.mjs";

const require = createRequire(import.meta.url);
const electron = require("electron");
const { app } = electron;

const CONFIG_FILENAME = "desktop-config.json";

const defaultOnboardingDraft = () => ({
  websiteUrl: "",
  naverBlogUrl: "",
  instagramUrl: "",
  facebookUrl: "",
  youtubeUrl: "",
  threadsUrl: ""
});

const defaultConfig = () => ({
  watchPath: "",
  orgId: SEED_ORG_ID,
  language: "ko",
  lastAuthUserId: "",
  onboardingCompleted: false,
  onboardingDraft: defaultOnboardingDraft()
});

const getConfigPath = () => path.join(app.getPath("userData"), CONFIG_FILENAME);

const readConfig = () => {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const parsedDraft =
      parsed?.onboardingDraft && typeof parsed.onboardingDraft === "object"
        ? parsed.onboardingDraft
        : {};

    return {
      ...defaultConfig(),
      ...parsed,
      onboardingDraft: {
        ...defaultOnboardingDraft(),
        ...parsedDraft
      }
    };
  } catch {
    return defaultConfig();
  }
};

const writeConfig = (nextConfig) => {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
  return nextConfig;
};

export const getDesktopConfig = () => readConfig();

export const saveWatchPath = (watchPath) => {
  const current = readConfig();
  return writeConfig({
    ...current,
    watchPath
  });
};

export const saveOrgId = (orgId) => {
  const current = readConfig();
  return writeConfig({
    ...current,
    orgId
  });
};

export const saveLanguage = (language) => {
  const normalized = String(language || "").trim().toLowerCase() === "en" ? "en" : "ko";
  const current = readConfig();
  return writeConfig({
    ...current,
    language: normalized
  });
};

export const saveOnboardingCompleted = (onboardingCompleted) => {
  const current = readConfig();
  return writeConfig({
    ...current,
    onboardingCompleted: !!onboardingCompleted
  });
};

export const saveLastAuthUserId = (lastAuthUserId) => {
  const current = readConfig();
  return writeConfig({
    ...current,
    lastAuthUserId: String(lastAuthUserId ?? "").trim()
  });
};

export const saveOnboardingDraft = (patch) => {
  const current = readConfig();
  const nextPatch = patch && typeof patch === "object" ? patch : {};
  return writeConfig({
    ...current,
    onboardingDraft: {
      ...defaultOnboardingDraft(),
      ...current.onboardingDraft,
      ...nextPatch
    }
  });
};
