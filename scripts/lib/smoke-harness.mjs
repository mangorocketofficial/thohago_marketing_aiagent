import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const nowIso = () => new Date().toISOString();

export const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

export const tailLines = (value, maxLines = 50) => {
  const lines = String(value ?? "").split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
};

const quoteCmdArg = (value) => {
  if (/^[-a-zA-Z0-9_./:@]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
};

export const spawnProcess = (command, args, options = {}) => {
  if (process.platform === "win32") {
    const cmdLine = [command, ...args].map((item) => quoteCmdArg(item)).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", cmdLine], options);
  }
  return spawn(command, args, options);
};

export const runCommandCapture = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(" ")}): ${stderr || stdout}`));
    });
  });

export const parseEnvMap = (raw) => {
  const map = {};
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    const rawValue = rest.join("=").trim();
    const value =
      rawValue.startsWith("\"") && rawValue.endsWith("\"") ? rawValue.slice(1, rawValue.length - 1) : rawValue;
    map[key] = value;
  }
  return map;
};

export const readSupabaseStatusEnv = async ({ cwd, pnpmCommand = "pnpm" }) => {
  const { stdout } = await runCommandCapture(pnpmCommand, ["exec", "supabase", "status", "-o", "env"], { cwd });
  return parseEnvMap(stdout);
};

export const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = value;
  }
};

export const fetchJson = async (url, options = {}, { timeoutMs = 15_000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text ? { raw: text } : null;
    }

    return { response, body, text };
  } finally {
    clearTimeout(timer);
  }
};

export const requestJson = async (url, options = {}, { timeoutMs = 15_000 } = {}) => {
  const { response, body, text } = await fetchJson(url, options, { timeoutMs });
  return {
    ok: response.ok,
    status: response.status,
    text,
    json: body,
    response
  };
};

export const waitForHealth = async ({
  baseUrl,
  timeoutMs = 120_000,
  intervalMs = 1_000,
  requireBodyOk = false,
  requestTimeoutMs = 15_000
}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "health check not started";
  while (Date.now() < deadline) {
    try {
      const { response, body } = await fetchJson(`${baseUrl}/health`, { method: "GET" }, { timeoutMs: requestTimeoutMs });
      if (response.ok && (!requireBodyOk || body?.ok === true)) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`API health check timed out (${lastError})`);
};

export const startApiServer = ({
  cwd,
  env,
  pnpmArgs = ["--filter", "@repo/api", "dev"],
  maxLogLines = 300
}) => {
  const child = spawnProcess("pnpm", pnpmArgs, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = [];
  const pushLines = (prefix, chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      logs.push(`${prefix} ${line}`);
      if (logs.length > maxLogLines) {
        logs.shift();
      }
    }
  };

  child.stdout.on("data", (chunk) => pushLines("[stdout]", chunk));
  child.stderr.on("data", (chunk) => pushLines("[stderr]", chunk));

  return {
    child,
    getLogs: () => logs.join("\n"),
    getLogLines: () => [...logs]
  };
};

export const stopProcessTree = async (child, { graceMs = 10_000 } = {}) => {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await runCommandCapture("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(undefined);
    }, graceMs);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
};

export const createReport = (seed = {}) => ({
  run_id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  started_at: nowIso(),
  finished_at: null,
  success: false,
  checks: [],
  metrics: {},
  environment: {},
  artifacts: {},
  error: null,
  ...seed
});

export const addCheck = (report, name, pass, details = {}) => {
  report.checks.push({
    name,
    pass,
    checked_at: nowIso(),
    ...details
  });
};

export const withCheck = async (report, name, fn) => {
  const started = Date.now();
  try {
    const details = (await fn()) ?? {};
    addCheck(report, name, true, { duration_ms: Date.now() - started, details });
    return details;
  } catch (error) {
    addCheck(report, name, false, {
      duration_ms: Date.now() - started,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }
};

export const writeJsonReport = ({ report, latestPath, timestampPrefix }) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const timestampedPath = path.join(path.dirname(latestPath), `${timestampPrefix}-${timestamp}.json`);
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  const serialized = JSON.stringify(report, null, 2);
  fs.writeFileSync(latestPath, serialized, "utf8");
  fs.writeFileSync(timestampedPath, serialized, "utf8");
  return {
    latest: latestPath,
    timestamped: timestampedPath
  };
};

export const createUserWithToken = async ({ adminClient, anonClient, email, password }) => {
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create auth user (${email}): ${createError?.message ?? "unknown"}`);
  }

  const { data: signedIn, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password
  });
  if (signInError || !signedIn.session?.access_token) {
    throw new Error(`Failed to sign in user (${email}): ${signInError?.message ?? "unknown"}`);
  }

  return {
    userId: created.user.id,
    accessToken: signedIn.session.access_token
  };
};
