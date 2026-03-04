import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import electronPath from "electron";

const loadEnvFile = (filePath, targetEnv) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key || targetEnv[key]) {
      continue;
    }

    targetEnv[key] = value;
  }
};

const childEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173"
};

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env"), childEnv);
loadEnvFile(path.join(cwd, ".env.local"), childEnv);
loadEnvFile(path.resolve(cwd, "../../.env"), childEnv);
loadEnvFile(path.resolve(cwd, "../../.env.local"), childEnv);

const parseApiPort = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`[run-dev-electron] Invalid API_PORT: ${raw}`);
    process.exit(1);
  }
  return Math.floor(parsed);
};

const readPortFromBaseUrl = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    if (url.port) {
      return Number.parseInt(url.port, 10);
    }
    if (url.protocol === "https:") {
      return 443;
    }
    if (url.protocol === "http:") {
      return 80;
    }
    return null;
  } catch {
    console.error(`[run-dev-electron] Invalid ORCHESTRATOR_API_BASE: ${baseUrl}`);
    process.exit(1);
  }
};

const apiPort = parseApiPort(childEnv.API_PORT);

if (!childEnv.ORCHESTRATOR_API_BASE) {
  childEnv.ORCHESTRATOR_API_BASE =
    apiPort !== null ? `http://127.0.0.1:${apiPort}` : "http://127.0.0.1:3001";
}

if (apiPort !== null) {
  const basePort = readPortFromBaseUrl(childEnv.ORCHESTRATOR_API_BASE);
  if (basePort !== apiPort) {
    console.error(
      `[run-dev-electron] ORCHESTRATOR_API_BASE port (${basePort}) does not match API_PORT (${apiPort}).`
    );
    process.exit(1);
  }
}

if (!childEnv.DESKTOP_CHAT_TIMELINE_SCOPE) {
  childEnv.DESKTOP_CHAT_TIMELINE_SCOPE = "session";
}

const timelineScope = childEnv.DESKTOP_CHAT_TIMELINE_SCOPE.trim().toLowerCase();
if (timelineScope !== "session" && timelineScope !== "org") {
  console.error(
    `[run-dev-electron] Invalid DESKTOP_CHAT_TIMELINE_SCOPE: ${childEnv.DESKTOP_CHAT_TIMELINE_SCOPE}. Use "session" or "org".`
  );
  process.exit(1);
}
childEnv.DESKTOP_CHAT_TIMELINE_SCOPE = timelineScope;

if (!childEnv.PIPELINE_TRIGGER_ENDPOINT) {
  childEnv.PIPELINE_TRIGGER_ENDPOINT = `${childEnv.ORCHESTRATOR_API_BASE.replace(/\/+$/, "")}/trigger`;
}

delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["./electron/main.mjs"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: childEnv
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
