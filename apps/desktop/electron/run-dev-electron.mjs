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

if (!childEnv.ORCHESTRATOR_API_BASE) {
  childEnv.ORCHESTRATOR_API_BASE = "http://127.0.0.1:3001";
}

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
