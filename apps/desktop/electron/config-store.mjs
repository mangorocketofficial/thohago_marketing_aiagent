import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { SEED_ORG_ID } from "./constants.mjs";

const CONFIG_FILENAME = "desktop-config.json";

const defaultConfig = () => ({
  watchPath: "",
  orgId: SEED_ORG_ID
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
    return {
      ...defaultConfig(),
      ...parsed
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
