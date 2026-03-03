import fs from "node:fs";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialCrawlState, runOnboardingCrawl } from "./crawler/index.mjs";
import { SEED_ORG_ID } from "./constants.mjs";
import {
  getDesktopConfig,
  saveLanguage,
  saveLastAuthUserId,
  saveOnboardingCompleted,
  saveOnboardingDraft,
  saveOrgId,
  saveWatchPath
} from "./config-store.mjs";
import {
  clearFileIndex,
  getActiveFiles,
  softDeleteFile,
  toRendererEntry,
  upsertFile
} from "./file-index.mjs";
import { writePipelineTrigger } from "./pipeline-trigger-relay.mjs";
import { deleteFileFromRag, indexFileForRag } from "./rag-indexer.mjs";
import { clearAuthSession, loadAuthSession, saveAuthSession } from "./secure-auth-store.mjs";
import { collectInitialFiles, startWatcher } from "./watcher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electron = require("electron");
const { app, BrowserWindow, dialog, ipcMain, shell } = electron;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const triggerEndpoint = (process.env.PIPELINE_TRIGGER_ENDPOINT ?? "").trim();
const configuredApiBase = (process.env.ORCHESTRATOR_API_BASE ?? "").trim();
const configuredApiToken = (process.env.API_SECRET ?? process.env.PIPELINE_TRIGGER_TOKEN ?? "").trim();
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const configuredDesktopToken = (process.env.DESKTOP_SUPABASE_ACCESS_TOKEN ?? "").trim();
const fallbackRlsToken = (process.env.RLS_TEST_USER_TOKEN ?? "").trim();
const oauthCallbackPort = Number.parseInt((process.env.DESKTOP_OAUTH_CALLBACK_PORT ?? "48721").trim(), 10);
const oauthCallbackHost = (process.env.DESKTOP_OAUTH_CALLBACK_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const oauthCallbackTimeoutMs = Number.parseInt((process.env.DESKTOP_OAUTH_TIMEOUT_MS ?? "90000").trim(), 10);
const billingCheckoutUrl = (process.env.BILLING_CHECKOUT_URL ?? "").trim();
const INITIAL_SCAN_RAG_MAX_CONCURRENCY = 2;
const AUTH_REFRESH_TIMEOUT_MS = Number.parseInt((process.env.DESKTOP_AUTH_REFRESH_TIMEOUT_MS ?? "10000").trim(), 10);

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("chokidar").FSWatcher | null} */
let activeWatcher = null;
/** @type {Promise<void>} */
let runtimeTask = Promise.resolve();
/** @type {Promise<void> | null} */
let onboardingCrawlTask = null;

const runtimeState = {
  watchPath: "",
  orgId: SEED_ORG_ID,
  language: "ko",
  onboardingCompleted: false,
  authUserId: "",
  authSession: null,
  isRunning: false,
  initialScanCount: 0,
  onboardingCrawlState: createInitialCrawlState(),
  onboardingLastSynthesis: null
};

const resolveOrchestratorApiBase = () => {
  if (configuredApiBase) {
    return configuredApiBase.replace(/\/+$/, "");
  }

  if (!triggerEndpoint) {
    return "";
  }

  try {
    const url = new URL(triggerEndpoint);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const orchestratorApiBase = resolveOrchestratorApiBase();

const buildIdempotencyKey = (action, parts = []) => {
  const normalized = parts.map((part) => String(part ?? "").trim()).join("|");
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `desktop:${action}:${digest}`;
};

const normalizeEditableInput = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const parsePositiveInteger = (value) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
};

const buildChatActionIdempotencyKey = (params) => {
  const expectedVersion = Math.max(1, Math.floor(params.expectedVersion));
  const base = `chat_action:${params.sessionId}:${params.workflowItemId}:${params.actionId}:v${expectedVersion}`;
  const normalizedInputs = (params.editableInputs ?? [])
    .map((entry) => normalizeEditableInput(entry))
    .filter((entry) => !!entry);
  if (normalizedInputs.length === 0) {
    return base;
  }

  const digest = createHash("sha256").update(normalizedInputs.join("|")).digest("hex").slice(0, 16);
  return `${base}:${digest}`;
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const callOrchestratorApi = async (path, options = {}) => {
  if (!orchestratorApiBase) {
    throw new Error("ORCHESTRATOR_API_BASE (or PIPELINE_TRIGGER_ENDPOINT) is not configured.");
  }

  const response = await fetch(`${orchestratorApiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(configuredApiToken ? { "x-api-token": configuredApiToken } : {}),
      ...(options.headers ?? {})
    }
  });

  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const message = body?.message ?? body?.error ?? `HTTP ${response.status}`;
    const error = new Error(typeof message === "string" ? message : `HTTP ${response.status}`);
    error.status = response.status;
    if (typeof body?.error === "string") {
      error.code = body.error;
    }
    if (body?.details && typeof body.details === "object" && !Array.isArray(body.details)) {
      error.details = body.details;
    }
    throw error;
  }

  return body;
};

const toRuntimeError = (error, fallbackMessage) => {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const runtimeError = new Error(message);
  if (error && typeof error === "object") {
    if (typeof error.code === "string") {
      runtimeError.code = error.code;
    }
    if (typeof error.status === "number" && Number.isFinite(error.status)) {
      runtimeError.status = Math.floor(error.status);
    }
    if (error.details && typeof error.details === "object" && !Array.isArray(error.details)) {
      runtimeError.details = error.details;
    }
  }
  return runtimeError;
};

const parseJwtExpiration = (token) => {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
};

const parseJwtSubject = (token) => {
  if (!token) {
    return "";
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return "";
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub.trim() : "";
  } catch {
    return "";
  }
};

const parseAuthSessionPayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const row = payload;
  const accessToken = typeof row.accessToken === "string" ? row.accessToken.trim() : "";
  const refreshToken = typeof row.refreshToken === "string" ? row.refreshToken.trim() : "";
  const expiresAt = typeof row.expiresAt === "number" && Number.isFinite(row.expiresAt) ? row.expiresAt : null;

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt
  };
};

const isStorageUnavailableError = (error) => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("encryption") || message.includes("safestorage") || message.includes("safe storage");
};

const isSessionExpired = (sessionPayload) => {
  if (!sessionPayload?.accessToken) {
    return true;
  }

  const expFromPayload =
    typeof sessionPayload.expiresAt === "number" && Number.isFinite(sessionPayload.expiresAt)
      ? sessionPayload.expiresAt
      : parseJwtExpiration(sessionPayload.accessToken);
  if (!expFromPayload) {
    return false;
  }

  return Date.now() >= expFromPayload * 1000;
};

const persistAuthSessionWithFallback = (payload, context = "session update") => {
  const normalized = parseAuthSessionPayload(payload);
  if (!normalized) {
    throw new Error("Invalid auth session payload.");
  }

  try {
    return saveAuthSession(normalized);
  } catch (error) {
    if (!isStorageUnavailableError(error)) {
      throw error;
    }

    console.warn(`[Auth] secure session persistence unavailable during ${context}; using in-memory session only.`);
    return normalized;
  }
};

const parseTokenResponse = (payload) => {
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken = typeof payload?.refresh_token === "string" ? payload.refresh_token.trim() : "";
  const expiresIn =
    typeof payload?.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in : null;

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt:
      expiresIn !== null ? Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresIn)) : parseJwtExpiration(accessToken)
  };
};

const refreshStoredAuthSession = async (sessionPayload) => {
  const refreshToken = typeof sessionPayload?.refreshToken === "string" ? sessionPayload.refreshToken.trim() : "";
  if (!refreshToken || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const tokenUrl = new URL("/auth/v1/token?grant_type=refresh_token", supabaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, AUTH_REFRESH_TIMEOUT_MS));

  try {
    const response = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseAnonKey
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      }),
      signal: controller.signal
    });

    const body = await parseJsonResponse(response);
    if (!response.ok) {
      const message = body?.error_description ?? body?.error ?? `HTTP ${response.status}`;
      throw new Error(typeof message === "string" ? message : `HTTP ${response.status}`);
    }

    return parseTokenResponse(body);
  } finally {
    clearTimeout(timeout);
  }
};

const resolveStoredAuthSession = async () => {
  const stored = loadAuthSession();
  if (!stored) {
    return null;
  }

  if (!isSessionExpired(stored)) {
    return stored;
  }

  try {
    const refreshed = await refreshStoredAuthSession(stored);
    if (!refreshed) {
      return null;
    }

    const persisted = persistAuthSessionWithFallback(refreshed, "startup refresh");
    return persisted;
  } catch (error) {
    console.warn(
      `[Auth] Failed to refresh stored session on startup: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
};

const randomBase64Url = (bytes = 32) => {
  return randomBytes(bytes).toString("base64url");
};

const toCodeChallenge = (codeVerifier) =>
  createHash("sha256").update(String(codeVerifier || ""), "utf8").digest("base64url");

const parseIntegerString = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const resolveSupabaseAccessToken = () => {
  const runtimeToken = runtimeState.authSession?.accessToken ?? "";
  if (runtimeToken) {
    if (isSessionExpired(runtimeState.authSession)) {
      return {
        token: "",
        message: "Desktop user session is expired. Sign in again to restore Realtime/data access."
      };
    }
    return {
      token: runtimeToken,
      message: null
    };
  }

  const candidate = configuredDesktopToken || fallbackRlsToken;
  if (!candidate) {
    return {
      token: "",
      message: "No desktop auth token set. Realtime/data reads may be restricted by RLS."
    };
  }

  const exp = parseJwtExpiration(candidate);
  if (exp && Date.now() >= exp * 1000) {
    return {
      token: "",
      message: `Desktop auth token expired at ${new Date(exp * 1000).toISOString()}. Refresh token and retry.`
    };
  }

  return {
    token: candidate,
    message: null
  };
};

const emitChatActionResult = (payload) => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("chat:action-result", payload);
};

const emitChatActionError = (payload) => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("chat:action-error", payload);
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value ?? null));
const CRAWL_PAYLOAD_MAX_CHARS = 95_000;

const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clampText = (value, maxLength = 500) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

const sanitizeCrawlValue = (
  value,
  options = {
    depth: 0,
    // Keep per-post objects in crawl_payload (e.g. naver_blog.recent_posts[*]).
    // Depth path: root(0)->sources(1)->naver_blog(2)->data(3)->recent_posts(4)->post(5).
    maxDepth: 6,
    maxArray: 24,
    maxKeys: 36,
    maxStringLength: 500
  }
) => {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string") {
    return clampText(value, options.maxStringLength);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (options.depth >= options.maxDepth) {
    if (Array.isArray(value)) {
      return [];
    }
    if (isPlainObject(value)) {
      return {};
    }
    return null;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArray)
      .map((item) =>
        sanitizeCrawlValue(item, {
          ...options,
          depth: options.depth + 1
        })
      );
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const key of Object.keys(value).slice(0, options.maxKeys)) {
      next[key] = sanitizeCrawlValue(value[key], {
        ...options,
        depth: options.depth + 1
      });
    }
    return next;
  }
  return clampText(String(value), options.maxStringLength);
};

const buildCrawlPayloadForSynthesis = (crawlState) => {
  const attemptA = sanitizeCrawlValue(crawlState);
  if (JSON.stringify(attemptA ?? null).length <= CRAWL_PAYLOAD_MAX_CHARS) {
    return attemptA;
  }

  const attemptB = sanitizeCrawlValue(crawlState, {
    depth: 0,
    maxDepth: 5,
    maxArray: 8,
    maxKeys: 20,
    maxStringLength: 220
  });
  if (JSON.stringify(attemptB ?? null).length <= CRAWL_PAYLOAD_MAX_CHARS) {
    return attemptB;
  }

  const sources = isPlainObject(attemptB?.sources) ? attemptB.sources : {};
  const summarizeSource = (key) => {
    const source = isPlainObject(sources[key]) ? sources[key] : {};
    return {
      source: key,
      url: typeof source.url === "string" ? clampText(source.url, 300) : "",
      status: typeof source.status === "string" ? source.status : "unknown",
      error: typeof source.error === "string" ? clampText(source.error, 220) : null,
      data: {
        truncated: true
      }
    };
  };

  return {
    state: typeof attemptB?.state === "string" ? attemptB.state : "done",
    started_at: typeof attemptB?.started_at === "string" ? attemptB.started_at : null,
    finished_at: typeof attemptB?.finished_at === "string" ? attemptB.finished_at : null,
    sources: {
      website: summarizeSource("website"),
      naver_blog: summarizeSource("naver_blog"),
      instagram: summarizeSource("instagram")
    },
    truncated: true,
    reason: "crawl_payload_too_large"
  };
};

const getOnboardingCrawlState = () => cloneJson(runtimeState.onboardingCrawlState);

const emitOnboardingCrawlProgress = (payload) => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("onboarding:crawl-progress", payload);
};

const emitOnboardingCrawlComplete = (payload) => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("onboarding:crawl-complete", payload);
};

const resolveOnboardingAccessToken = (rawToken) => {
  const direct = String(rawToken ?? "").trim();
  if (direct) {
    return direct;
  }
  const runtimeToken = String(runtimeState.authSession?.accessToken ?? "").trim();
  return runtimeToken;
};

const resolveOrgIdForBilling = (rawOrgId) => {
  const direct = String(rawOrgId ?? "").trim();
  if (direct) {
    return direct;
  }
  return String(runtimeState.orgId ?? "").trim();
};

const normalizeSubscriptionStatus = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "trial" || normalized === "active" || normalized === "past_due" || normalized === "canceled") {
    return normalized;
  }
  return "past_due";
};

const normalizeEntitlementResponse = (row, orgId) => ({
  ok: true,
  org_id: String(row?.org_id ?? orgId ?? "").trim(),
  status: normalizeSubscriptionStatus(row?.status),
  is_entitled: row?.is_entitled === true,
  trial_ends_at: typeof row?.trial_ends_at === "string" ? row.trial_ends_at : null,
  current_period_end: typeof row?.current_period_end === "string" ? row.current_period_end : null
});

const normalizeInterviewAnswers = (input) => {
  const fallback = {
    q1: "",
    q2: "",
    q3: "",
    q4: ""
  };
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const row = input;
  for (const key of Object.keys(fallback)) {
    const value = row[key];
    fallback[key] = typeof value === "string" ? value.trim() : "";
  }
  return fallback;
};

const resolveReviewMarkdown = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = typeof payload.review_markdown === "string" ? payload.review_markdown.trim() : "";
  if (direct) {
    return direct;
  }

  const document = payload.onboarding_result_document;
  if (!document || typeof document !== "object") {
    return "";
  }

  const nested = typeof document.review_markdown === "string" ? document.review_markdown.trim() : "";
  return nested;
};

const exportBrandReviewToFolder = async ({ watchPath, synthesisPayload }) => {
  const normalizedPath = String(watchPath ?? "").trim();
  if (!normalizedPath) {
    return null;
  }

  const markdown = resolveReviewMarkdown(synthesisPayload);
  if (!markdown) {
    return null;
  }

  try {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(normalizedPath, `브랜드리뷰_${date}.md`);
    await fs.promises.writeFile(filePath, markdown, "utf8");
    return filePath;
  } catch (error) {
    console.warn("[Onboarding] Failed to export brand review markdown:", error);
    return null;
  }
};

const waitForWindowReady = (win) =>
  win.webContents.isLoadingMainFrame()
    ? new Promise((resolve) => win.webContents.once("did-finish-load", resolve))
    : Promise.resolve();

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
};

const normalizeWatchPath = (candidatePath) => {
  const trimmed = String(candidatePath ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const resolved = path.resolve(trimmed);
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return "";
    }
    return resolved;
  } catch {
    return "";
  }
};

const getDesktopRuntimeConfig = () => {
  const config = getDesktopConfig();
  const normalizedWatchPath = normalizeWatchPath(config.watchPath);
  const normalizedOnboardingCompleted = !!config.onboardingCompleted && !!normalizedWatchPath;
  const rawWatchPath = String(config.watchPath ?? "").trim();

  if (rawWatchPath !== normalizedWatchPath) {
    saveWatchPath(normalizedWatchPath);
  }
  if (!!config.onboardingCompleted !== normalizedOnboardingCompleted) {
    saveOnboardingCompleted(normalizedOnboardingCompleted);
  }

  return {
    watchPath: normalizedWatchPath,
    orgId: (config.orgId || SEED_ORG_ID).trim() || SEED_ORG_ID,
    language: (config.language || "ko").trim().toLowerCase() === "en" ? "en" : "ko",
    onboardingCompleted: normalizedOnboardingCompleted,
    onboardingDraft: {
      websiteUrl: config.onboardingDraft?.websiteUrl ?? "",
      naverBlogUrl: config.onboardingDraft?.naverBlogUrl ?? "",
      instagramUrl: config.onboardingDraft?.instagramUrl ?? "",
      facebookUrl: config.onboardingDraft?.facebookUrl ?? "",
      youtubeUrl: config.onboardingDraft?.youtubeUrl ?? "",
      threadsUrl: config.onboardingDraft?.threadsUrl ?? ""
    }
  };
};

const getWatcherStatus = () => {
  const hasValidAuthSession = !!(runtimeState.authSession && !isSessionExpired(runtimeState.authSession));
  const normalizedWatchPath = normalizeWatchPath(runtimeState.watchPath);
  const hasWatchPath = !!normalizedWatchPath;
  return {
    watchPath: normalizedWatchPath || null,
    orgId: runtimeState.orgId,
    fileCount: getActiveFiles().length,
    isRunning: runtimeState.isRunning,
    requiresOnboarding: !runtimeState.onboardingCompleted || !hasValidAuthSession || !hasWatchPath
  };
};

const emitWatcherStatus = () => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("watcher:status-changed", getWatcherStatus());
};

const stopWatcher = async () => {
  if (activeWatcher) {
    await activeWatcher.close();
    activeWatcher = null;
  }
  runtimeState.isRunning = false;
  emitWatcherStatus();
};

const resetLocalOnboardingState = async () => {
  await stopWatcher();
  clearFileIndex();
  saveWatchPath("");
  saveOnboardingCompleted(false);
  runtimeState.watchPath = "";
  runtimeState.onboardingCompleted = false;
  runtimeState.onboardingLastSynthesis = null;
};

/**
 * @param {number} maxConcurrency
 * @returns {(task: () => Promise<void>) => Promise<void>}
 */
const createTaskQueue = (maxConcurrency) => {
  const limit = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
  /** @type {Array<{ task: () => Promise<void>, resolve: () => void, reject: (error: unknown) => void }>} */
  const pending = [];
  let active = 0;

  const runNext = () => {
    if (active >= limit) {
      return;
    }

    const next = pending.shift();
    if (!next) {
      return;
    }

    active += 1;
    void Promise.resolve()
      .then(() => next.task())
      .then(() => next.resolve())
      .catch((error) => next.reject(error))
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (task) =>
    new Promise((resolve, reject) => {
      pending.push({ task, resolve, reject });
      runNext();
    });
};

/**
 * @param {string} watchPath
 * @param {string} orgId
 */
const startWatcherRuntime = async (watchPath, orgId) => {
  if (!mainWindow) {
    return;
  }

  const resolvedPath = path.resolve(watchPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Watch path is not a directory: ${resolvedPath}`);
  }

  await stopWatcher();
  clearFileIndex();

  runtimeState.watchPath = resolvedPath;
  runtimeState.orgId = orgId;
  runtimeState.initialScanCount = 0;

  // Non-blocking async scan to rebuild runtime cache.
  const initialEntries = await collectInitialFiles(resolvedPath);
  const enqueueInitialRagIndex = createTaskQueue(INITIAL_SCAN_RAG_MAX_CONCURRENCY);
  for (const entry of initialEntries) {
    upsertFile(entry);
    const dedupeKey = `${runtimeState.orgId}:${entry.relativePath}:${entry.fileSize}:${entry.modifiedAt}`;
    await writePipelineTrigger({
      orgId: runtimeState.orgId,
      relativePath: entry.relativePath,
      fileName: entry.fileName,
      activityFolder: entry.activityFolder,
      fileType: entry.fileType,
      dedupeKey: `scan:${dedupeKey}`
    });

    void enqueueInitialRagIndex(async () => {
      await indexFileForRag({
        orgId: runtimeState.orgId,
        filePath: entry.filePath,
        relativePath: entry.relativePath,
        fileName: entry.fileName,
        activityFolder: entry.activityFolder,
        fileType: entry.fileType,
        fileSize: entry.fileSize,
        extension: entry.extension,
        modifiedAt: entry.modifiedAt
      });
    }).catch((error) => {
      console.warn(
        `[RAG-Indexer] Initial scan index failed for ${entry.fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }
  runtimeState.initialScanCount = initialEntries.length;
  mainWindow.webContents.send("file:scan-complete", { count: initialEntries.length });

  activeWatcher = startWatcher({
    watchRoot: resolvedPath,
    onUpsert: async (entry, eventType) => {
      upsertFile(entry);
      const rendererEntry = toRendererEntry(entry);
      mainWindow?.webContents.send("file:indexed", rendererEntry);

      const dedupeKey = `${runtimeState.orgId}:${rendererEntry.relativePath}:${entry.fileSize}:${entry.modifiedAt}`;
      await writePipelineTrigger({
        orgId: runtimeState.orgId,
        relativePath: rendererEntry.relativePath,
        fileName: rendererEntry.fileName,
        activityFolder: rendererEntry.activityFolder,
        fileType: rendererEntry.fileType,
        dedupeKey: `${eventType}:${dedupeKey}`
      });

      void indexFileForRag({
        orgId: runtimeState.orgId,
        filePath: entry.filePath,
        relativePath: rendererEntry.relativePath,
        fileName: rendererEntry.fileName,
        activityFolder: rendererEntry.activityFolder,
        fileType: rendererEntry.fileType,
        fileSize: entry.fileSize,
        extension: entry.extension,
        modifiedAt: entry.modifiedAt
      }).catch((error) => {
        console.warn(
          `[RAG-Indexer] Background index failed for ${rendererEntry.fileName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

      emitWatcherStatus();
    },
    onDelete: async (deleted) => {
      softDeleteFile(deleted.filePath, deleted.detectedAt);
      mainWindow?.webContents.send("file:deleted", {
        relativePath: deleted.relativePath,
        fileName: deleted.fileName
      });

      void deleteFileFromRag({
        orgId: runtimeState.orgId,
        relativePath: deleted.relativePath
      }).catch((error) => {
        console.warn(
          `[RAG-Indexer] Background delete failed for ${deleted.fileName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

      emitWatcherStatus();
    }
  });

  runtimeState.isRunning = true;
  emitWatcherStatus();
};

const enqueueRuntimeStart = (watchPath, orgId) => {
  runtimeTask = runtimeTask.then(() => startWatcherRuntime(watchPath, orgId)).catch((error) => {
    console.error("[Runtime] Failed to start watcher runtime:", error);
  });
  return runtimeTask;
};

const resumeWatcherRuntimeAfterAuth = async () => {
  emitWatcherStatus();

  if (!runtimeState.onboardingCompleted) {
    return;
  }
  if (!runtimeState.watchPath) {
    return;
  }
  if (runtimeState.isRunning) {
    return;
  }

  await enqueueRuntimeStart(runtimeState.watchPath, runtimeState.orgId);
};

const saveRuntimeAuthSession = async (payload, context = "session update") => {
  const persisted = persistAuthSessionWithFallback(payload, context);
  const previousUserId = String(runtimeState.authUserId ?? "").trim();
  const nextUserId = parseJwtSubject(persisted.accessToken);
  const isAccountSwitch = !!previousUserId && !!nextUserId && previousUserId !== nextUserId;

  runtimeState.authSession = persisted;
  if (nextUserId && nextUserId !== previousUserId) {
    runtimeState.authUserId = nextUserId;
    saveLastAuthUserId(nextUserId);
  }

  if (isAccountSwitch) {
    await resetLocalOnboardingState();
    emitWatcherStatus();
    return persisted;
  }

  await resumeWatcherRuntimeAfterAuth();
  return persisted;
};

const getChatRuntimeConfig = () => ({
  ...(() => {
    const resolvedToken = resolveSupabaseAccessToken();
    return {
      supabaseAccessToken: resolvedToken.token,
      tokenMessage: resolvedToken.message
    };
  })(),
  orgId: runtimeState.orgId,
  apiBaseUrl: orchestratorApiBase,
  apiToken: configuredApiToken,
  supabaseUrl,
  supabaseAnonKey,
  enabled: !!(orchestratorApiBase && supabaseUrl && supabaseAnonKey),
  message: (() => {
    const baseMessage =
      orchestratorApiBase && supabaseUrl && supabaseAnonKey
        ? null
        : "API/Supabase env is incomplete. Check ORCHESTRATOR_API_BASE, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.";

    const resolvedToken = resolveSupabaseAccessToken();
    if (baseMessage && resolvedToken.message) {
      return `${baseMessage} ${resolvedToken.message}`;
    }
    return baseMessage ?? resolvedToken.message;
  })()
});

const runGoogleOAuthWithSystemBrowser = async () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase env is incomplete for OAuth.");
  }
  if (!Number.isFinite(oauthCallbackPort) || oauthCallbackPort <= 0) {
    throw new Error("DESKTOP_OAUTH_CALLBACK_PORT is invalid.");
  }
  if (!Number.isFinite(oauthCallbackTimeoutMs) || oauthCallbackTimeoutMs <= 0) {
    throw new Error("DESKTOP_OAUTH_TIMEOUT_MS is invalid.");
  }

  const codeVerifier = randomBase64Url(64);
  const codeChallenge = toCodeChallenge(codeVerifier);
  const redirectUri = `http://${oauthCallbackHost}:${oauthCallbackPort}/auth/callback`;
  console.log(`[Auth] Starting Google OAuth. callback=${redirectUri}`);

  const callbackResult = await new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
      void server.close();
    };
    const settleReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
      void server.close();
    };

    const server = createServer((req, res) => {
      try {
        const base = "http://127.0.0.1";
        const requestUrl = new URL(req.url || "/", base);
        const normalizedPath = requestUrl.pathname.replace(/\/+$/, "");
        console.log(`[Auth] OAuth callback request: path=${requestUrl.pathname} query=${requestUrl.search}`);
        if (normalizedPath !== "/auth/callback") {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not Found");
          return;
        }

        const code = requestUrl.searchParams.get("code") ?? "";
        const error = requestUrl.searchParams.get("error");
        const errorDescription = requestUrl.searchParams.get("error_description");
        const accessToken = requestUrl.searchParams.get("access_token") ?? "";
        const refreshToken = requestUrl.searchParams.get("refresh_token") ?? "";
        const expiresAtRaw = requestUrl.searchParams.get("expires_at");
        const expiresInRaw = requestUrl.searchParams.get("expires_in");

        if (error) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<h1>Sign-in failed</h1><p>You can close this tab and return to Thohago.</p>");
          settleReject(new Error(errorDescription || error));
          return;
        }

        if (code) {
          console.log("[Auth] OAuth callback received auth code.");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<h1>Sign-in complete</h1><p>You can close this tab and return to Thohago.</p>");
          settleResolve({
            kind: "code",
            code,
            redirectUri
          });
          return;
        }

        if (accessToken && refreshToken) {
          const expiresAtFromQuery = parseIntegerString(expiresAtRaw);
          const expiresInSeconds = parseIntegerString(expiresInRaw);
          const expiresAt =
            expiresAtFromQuery ??
            (expiresInSeconds !== null
              ? Math.floor(Date.now() / 1000) + Math.max(1, expiresInSeconds)
              : parseJwtExpiration(accessToken));

          console.log("[Auth] OAuth callback received implicit tokens.");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<h1>Sign-in complete</h1><p>You can close this tab and return to Thohago.</p>");
          settleResolve({
            kind: "tokens",
            accessToken: accessToken.trim(),
            refreshToken: refreshToken.trim(),
            expiresAt
          });
          return;
        }

        if (!requestUrl.search || requestUrl.search === "?") {
          // Some OAuth flows return tokens in URL hash (#...), not query params.
          // Hash is not sent to the server, so we rewrite hash data into query params.
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Completing sign-in</title>
  </head>
  <body>
    <h1>Completing sign-in...</h1>
    <p>If this does not continue, close this tab and retry Google sign-in.</p>
    <script>
      (() => {
        const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
        if (!hash) {
          document.body.innerHTML = "<h1>Sign-in failed</h1><p>No authorization data was returned.</p>";
          return;
        }
        const params = new URLSearchParams(hash);
        const nextUrl = new URL(window.location.href);
        params.forEach((value, key) => {
          nextUrl.searchParams.set(key, value);
        });
        window.location.replace(nextUrl.pathname + "?" + nextUrl.searchParams.toString());
      })();
    </script>
  </body>
</html>`);
          return;
        }

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<h1>Invalid callback</h1><p>You can close this tab and try again.</p>");
        settleReject(new Error("OAuth callback did not include code or tokens."));
      } catch (error) {
        settleReject(error);
      }
    });

    const timeout = setTimeout(() => {
      settleReject(
        new Error(
          `OAuth callback timed out. Expected ${redirectUri}. Confirm this exact URL is in Supabase Auth Redirect URLs and try again.`
        )
      );
    }, oauthCallbackTimeoutMs);

    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        settleReject(
          new Error(
            `OAuth callback port ${oauthCallbackPort} is already in use. Close the conflicting process or change DESKTOP_OAUTH_CALLBACK_PORT.`
          )
        );
        return;
      }
      settleReject(error);
    });

    server.once("close", () => {
      clearTimeout(timeout);
    });

    server.listen(oauthCallbackPort, async () => {
      try {
        const authorizeUrl = new URL("/auth/v1/authorize", supabaseUrl);
        authorizeUrl.searchParams.set("provider", "google");
        authorizeUrl.searchParams.set("redirect_to", redirectUri);
        authorizeUrl.searchParams.set("code_challenge", codeChallenge);
        authorizeUrl.searchParams.set("code_challenge_method", "s256");
        authorizeUrl.searchParams.set("flow_type", "pkce");
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("scope", "email profile");

        console.log("[Auth] Opening system browser for Google OAuth.");
        console.log(`[Auth] Authorize URL: ${authorizeUrl.toString()}`);
        await shell.openExternal(authorizeUrl.toString());
      } catch (error) {
        settleReject(error);
      }
    });
  });

  if (callbackResult?.kind === "tokens") {
    return {
      accessToken: callbackResult.accessToken,
      refreshToken: callbackResult.refreshToken,
      expiresAt: callbackResult.expiresAt ?? parseJwtExpiration(callbackResult.accessToken)
    };
  }

  const tokenUrl = new URL("/auth/v1/token?grant_type=pkce", supabaseUrl);
  const tokenResponse = await fetch(tokenUrl.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabaseAnonKey
    },
    body: JSON.stringify({
      auth_code: callbackResult.code,
      code_verifier: codeVerifier,
      redirect_uri: callbackResult.redirectUri
    })
  });

  const tokenBody = await parseJsonResponse(tokenResponse);
  if (!tokenResponse.ok) {
    const message = tokenBody?.error_description ?? tokenBody?.error ?? `HTTP ${tokenResponse.status}`;
    throw new Error(typeof message === "string" ? message : `HTTP ${tokenResponse.status}`);
  }

  const accessToken = typeof tokenBody?.access_token === "string" ? tokenBody.access_token.trim() : "";
  const refreshToken = typeof tokenBody?.refresh_token === "string" ? tokenBody.refresh_token.trim() : "";
  const expiresIn =
    typeof tokenBody?.expires_in === "number" && Number.isFinite(tokenBody.expires_in)
      ? tokenBody.expires_in
      : null;
  if (!accessToken || !refreshToken) {
    throw new Error("OAuth token exchange failed: missing access/refresh token.");
  }

  const expiresAt =
    expiresIn !== null
      ? Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresIn))
      : parseJwtExpiration(accessToken);
  return {
    accessToken,
    refreshToken,
    expiresAt
  };
};

const registerIpcHandlers = () => {
  ipcMain.handle("app:get-config", () => getDesktopRuntimeConfig());

  ipcMain.handle("app:set-language", async (_, payload) => {
    const language = (payload?.language ?? "").trim().toLowerCase() === "en" ? "en" : "ko";
    saveLanguage(language);
    runtimeState.language = language;
    return getDesktopRuntimeConfig();
  });

  ipcMain.handle("auth:get-stored-session", async () => {
    if (runtimeState.authSession && !isSessionExpired(runtimeState.authSession)) {
      const sessionUserId = parseJwtSubject(runtimeState.authSession.accessToken);
      if (sessionUserId && sessionUserId !== runtimeState.authUserId) {
        runtimeState.authUserId = sessionUserId;
        saveLastAuthUserId(sessionUserId);
      }
      await resumeWatcherRuntimeAfterAuth();
      return runtimeState.authSession;
    }

    const stored = await resolveStoredAuthSession();
    if (!stored) {
      runtimeState.authSession = null;
      emitWatcherStatus();
      return null;
    }

    runtimeState.authSession = stored;
    const storedUserId = parseJwtSubject(stored.accessToken);
    if (storedUserId && storedUserId !== runtimeState.authUserId) {
      runtimeState.authUserId = storedUserId;
      saveLastAuthUserId(storedUserId);
    }
    await resumeWatcherRuntimeAfterAuth();
    return stored;
  });

  ipcMain.handle("auth:save-session", async (_, payload) => saveRuntimeAuthSession(payload, "manual save"));

  ipcMain.handle("auth:clear-session", async () => {
    clearAuthSession();
    runtimeState.authSession = null;
    await stopWatcher();
    emitWatcherStatus();
    return { ok: true };
  });

  ipcMain.handle("auth:start-google-oauth", async () => {
    const sessionPayload = await runGoogleOAuthWithSystemBrowser();
    return saveRuntimeAuthSession(sessionPayload, "google oauth");
  });

  const fetchEntitlement = async (payload) => {
    const accessToken = resolveOnboardingAccessToken(payload?.accessToken);
    if (!accessToken) {
      throw new Error("A valid user access token is required.");
    }

    const orgId = resolveOrgIdForBilling(payload?.orgId);
    if (!orgId) {
      throw new Error("orgId is required.");
    }

    const body = await callOrchestratorApi(`/orgs/${orgId}/entitlement`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return normalizeEntitlementResponse(body, orgId);
  };

  ipcMain.handle("billing:get-entitlement", async (_, payload) => fetchEntitlement(payload));
  ipcMain.handle("billing:refresh-entitlement", async (_, payload) => fetchEntitlement(payload));

  ipcMain.handle("billing:open-checkout", async (_, payload) => {
    const orgId = resolveOrgIdForBilling(payload?.orgId);
    if (!billingCheckoutUrl) {
      return {
        ok: false,
        message: "BILLING_CHECKOUT_URL is not configured.",
        url: null
      };
    }

    const checkoutUrl = new URL(billingCheckoutUrl);
    if (orgId && !checkoutUrl.searchParams.get("org_id")) {
      checkoutUrl.searchParams.set("org_id", orgId);
    }

    await shell.openExternal(checkoutUrl.toString());
    return {
      ok: true,
      message: null,
      url: checkoutUrl.toString()
    };
  });

  ipcMain.handle("watcher:get-status", () => getWatcherStatus());

  ipcMain.handle("watcher:get-files", () => getActiveFiles().map((entry) => toRendererEntry(entry)));

  ipcMain.handle("watcher:open-folder", async () => {
    if (!runtimeState.watchPath) {
      return { ok: false, message: "watchPath is not configured." };
    }

    const result = await shell.openPath(runtimeState.watchPath);
    return {
      ok: result === "",
      message: result || null
    };
  });

  ipcMain.handle("onboarding:save-draft", async (_, payload) => {
    const rawPatch = payload?.draftPatch;
    const patch = rawPatch && typeof rawPatch === "object" ? rawPatch : {};
    saveOnboardingDraft(patch);
    const nextConfig = getDesktopRuntimeConfig();
    if (!onboardingCrawlTask && runtimeState.onboardingCrawlState?.state !== "running") {
      runtimeState.onboardingCrawlState = createInitialCrawlState({
        websiteUrl: nextConfig.onboardingDraft?.websiteUrl ?? "",
        naverBlogUrl: nextConfig.onboardingDraft?.naverBlogUrl ?? "",
        instagramUrl: nextConfig.onboardingDraft?.instagramUrl ?? ""
      });
    }
    return nextConfig;
  });

  ipcMain.handle("onboarding:set-org-id", async (_, payload) => {
    const orgId = (payload?.orgId ?? "").trim();
    if (!orgId) {
      throw new Error("orgId is required.");
    }

    const previousOrgId = String(runtimeState.orgId ?? "").trim();
    const orgChanged = previousOrgId !== orgId;
    saveOrgId(orgId);
    runtimeState.orgId = orgId;
    if (orgChanged) {
      await resetLocalOnboardingState();
    }
    emitWatcherStatus();
    return getDesktopRuntimeConfig();
  });

  ipcMain.handle("onboarding:bootstrap-org", async (_, payload) => {
    const accessToken = (payload?.accessToken ?? "").trim();
    if (!accessToken) {
      throw new Error("accessToken is required.");
    }

    const body = await callOrchestratorApi("/onboarding/bootstrap-org", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        name: typeof payload?.name === "string" ? payload.name.trim() : "",
        org_name: typeof payload?.orgName === "string" ? payload.orgName.trim() : ""
      })
    });

    const orgId = (body?.org?.id ?? "").trim();
    if (orgId) {
      saveOrgId(orgId);
      runtimeState.orgId = orgId;
    }

    return body;
  });

  ipcMain.handle("onboarding:get-crawl-state", () => getOnboardingCrawlState());

  ipcMain.handle("onboarding:start-crawl", async (_, payload) => {
    const rawUrls = payload?.urls && typeof payload.urls === "object" ? payload.urls : {};
    const urls = {
      websiteUrl: typeof rawUrls.websiteUrl === "string" ? rawUrls.websiteUrl.trim() : "",
      naverBlogUrl: typeof rawUrls.naverBlogUrl === "string" ? rawUrls.naverBlogUrl.trim() : "",
      instagramUrl: typeof rawUrls.instagramUrl === "string" ? rawUrls.instagramUrl.trim() : ""
    };

    if (onboardingCrawlTask && runtimeState.onboardingCrawlState?.state === "running") {
      return getOnboardingCrawlState();
    }

    runtimeState.onboardingCrawlState = createInitialCrawlState(urls);
    runtimeState.onboardingLastSynthesis = null;
    emitOnboardingCrawlProgress({
      source: null,
      sourceState: null,
      crawlState: getOnboardingCrawlState()
    });

    onboardingCrawlTask = (async () => {
      try {
        const finalState = await runOnboardingCrawl({
          urls,
          onSourceProgress: (source, sourceState, crawlState) => {
            runtimeState.onboardingCrawlState = cloneJson(crawlState);
            emitOnboardingCrawlProgress({
              source,
              sourceState: cloneJson(sourceState),
              crawlState: getOnboardingCrawlState()
            });
          }
        });

        runtimeState.onboardingCrawlState = cloneJson(finalState);
        emitOnboardingCrawlComplete({
          crawlState: getOnboardingCrawlState()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Onboarding crawl failed.";
        runtimeState.onboardingCrawlState = {
          ...createInitialCrawlState(urls),
          state: "done",
          started_at: runtimeState.onboardingCrawlState?.started_at ?? new Date().toISOString(),
          finished_at: new Date().toISOString(),
          sources: {
            website: {
              ...createInitialCrawlState(urls).sources.website,
              status: urls.websiteUrl ? "failed" : "skipped",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              error: urls.websiteUrl ? message : null
            },
            naver_blog: {
              ...createInitialCrawlState(urls).sources.naver_blog,
              status: urls.naverBlogUrl ? "failed" : "skipped",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              error: urls.naverBlogUrl ? message : null
            },
            instagram: {
              ...createInitialCrawlState(urls).sources.instagram,
              status: urls.instagramUrl ? "failed" : "skipped",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              error: urls.instagramUrl ? message : null
            }
          }
        };
        emitOnboardingCrawlComplete({
          crawlState: getOnboardingCrawlState()
        });
      }
    })().finally(() => {
      onboardingCrawlTask = null;
    });

    return getOnboardingCrawlState();
  });

  ipcMain.handle("onboarding:save-interview", async (_, payload) => {
    const token = resolveOnboardingAccessToken(payload?.accessToken);
    if (!token) {
      throw new Error("A valid user access token is required.");
    }

    const orgId = (payload?.orgId ?? runtimeState.orgId ?? "").trim();
    if (!orgId) {
      throw new Error("orgId is required.");
    }

    const interviewAnswers = normalizeInterviewAnswers(payload?.interviewAnswers);
    const body = await callOrchestratorApi("/onboarding/interview", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        org_id: orgId,
        interview_answers: interviewAnswers
      })
    });

    return body;
  });

  ipcMain.handle("onboarding:synthesize", async (_, payload) => {
    const token = resolveOnboardingAccessToken(payload?.accessToken);
    if (!token) {
      throw new Error("A valid user access token is required.");
    }

    const orgId = (payload?.orgId ?? runtimeState.orgId ?? "").trim();
    if (!orgId) {
      throw new Error("orgId is required.");
    }

    if (onboardingCrawlTask) {
      await onboardingCrawlTask;
    }

    const interviewAnswers = normalizeInterviewAnswers(payload?.interviewAnswers);
    const urlMetadata = payload?.urlMetadata && typeof payload.urlMetadata === "object" ? payload.urlMetadata : {};
    const synthesisModeRaw = typeof payload?.synthesisMode === "string" ? payload.synthesisMode.trim() : "";
    const synthesisMode = synthesisModeRaw || "phase_1_7b";
    const crawlPayload = buildCrawlPayloadForSynthesis(getOnboardingCrawlState());
    const body = await callOrchestratorApi("/onboarding/synthesize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        org_id: orgId,
        crawl_result: crawlPayload,
        interview_answers: interviewAnswers,
        url_metadata: urlMetadata,
        synthesis_mode: synthesisMode
      })
    });

    const reviewExportPath = await exportBrandReviewToFolder({
      watchPath: runtimeState.watchPath,
      synthesisPayload: body
    });
    const responseWithExport =
      reviewExportPath && body && typeof body === "object"
        ? {
            ...body,
            review_export_path: reviewExportPath
          }
        : body;

    runtimeState.onboardingLastSynthesis = responseWithExport ?? null;
    return responseWithExport;
  });

  ipcMain.handle("onboarding:get-last-synthesis", () => cloneJson(runtimeState.onboardingLastSynthesis));

  ipcMain.handle("onboarding:choose-folder", async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Marketing Folder",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("onboarding:create-folder", async () => {
    if (!mainWindow) {
      return null;
    }

    const defaultPath = path.join(app.getPath("documents"), "WFK_Marketing");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Create Marketing Folder",
      defaultPath
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    fs.mkdirSync(result.filePath, { recursive: true });
    return result.filePath;
  });

  ipcMain.handle("onboarding:complete", async (_, payload) => {
    const watchPath = (payload?.watchPath ?? "").trim();
    const payloadOrgId = (payload?.orgId ?? "").trim();
    if (!watchPath) {
      throw new Error("watchPath is required");
    }

    const resolvedPath = path.resolve(watchPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      throw new Error(`watchPath is invalid: ${resolvedPath}`);
    }

    const resolvedOrgId = payloadOrgId || runtimeState.orgId || SEED_ORG_ID;
    saveWatchPath(resolvedPath);
    saveOrgId(resolvedOrgId);
    saveOnboardingCompleted(true);

    runtimeState.watchPath = resolvedPath;
    runtimeState.orgId = resolvedOrgId;
    runtimeState.onboardingCompleted = true;
    const reviewExportPath = await exportBrandReviewToFolder({
      watchPath: resolvedPath,
      synthesisPayload: runtimeState.onboardingLastSynthesis
    });
    if (reviewExportPath && runtimeState.onboardingLastSynthesis && typeof runtimeState.onboardingLastSynthesis === "object") {
      runtimeState.onboardingLastSynthesis = {
        ...runtimeState.onboardingLastSynthesis,
        review_export_path: reviewExportPath
      };
    }

    await enqueueRuntimeStart(resolvedPath, resolvedOrgId);
    return getWatcherStatus();
  });

  ipcMain.handle("chat:get-config", () => getChatRuntimeConfig());

  ipcMain.handle("chat:get-active-session", async () => {
    try {
      const body = await callOrchestratorApi(`/orgs/${runtimeState.orgId}/sessions/active`, {
        method: "GET"
      });

      return {
        ok: true,
        session: body?.session ?? null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load active session.";
      emitChatActionError({
        action: "get-active-session",
        message,
        sessionId: null
      });
      return {
        ok: false,
        session: null,
        message
      };
    }
  });

  ipcMain.handle("chat:send-message", async (_, payload) => {
    const sessionId = (payload?.sessionId ?? "").trim();
    const content = (payload?.content ?? "").trim();
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }
    if (!content) {
      throw new Error("content is required.");
    }

    try {
      const body = await callOrchestratorApi(`/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          event_type: "user_message",
          payload: { content },
          idempotency_key: buildIdempotencyKey("user_message", [sessionId, content])
        })
      });

      emitChatActionResult({
        action: "send-message",
        ok: true,
        sessionId
      });
      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message.";
      emitChatActionError({
        action: "send-message",
        message,
        sessionId
      });
      throw toRuntimeError(error, "Failed to send message.");
    }
  });

  ipcMain.handle("chat:approve-campaign", async (_, payload) => {
    const sessionId = (payload?.sessionId ?? "").trim();
    const campaignId = (payload?.campaignId ?? "").trim();
    if (!sessionId || !campaignId) {
      throw new Error("sessionId and campaignId are required.");
    }

    try {
      const body = await callOrchestratorApi(`/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          event_type: "campaign_approved",
          payload: { campaign_id: campaignId },
          idempotency_key: buildIdempotencyKey("campaign_approved", [sessionId, campaignId])
        })
      });

      emitChatActionResult({
        action: "approve-campaign",
        ok: true,
        sessionId
      });
      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve campaign.";
      emitChatActionError({
        action: "approve-campaign",
        message,
        sessionId
      });
      throw toRuntimeError(error, "Failed to approve campaign.");
    }
  });

  ipcMain.handle("chat:approve-content", async (_, payload) => {
    const sessionId = (payload?.sessionId ?? "").trim();
    const contentId = (payload?.contentId ?? "").trim();
    const editedBody = typeof payload?.editedBody === "string" ? payload.editedBody.trim() : "";
    if (!sessionId || !contentId) {
      throw new Error("sessionId and contentId are required.");
    }

    try {
      const body = await callOrchestratorApi(`/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          event_type: "content_approved",
          payload: {
            content_id: contentId,
            ...(editedBody ? { edited_body: editedBody } : {})
          },
          idempotency_key: buildIdempotencyKey("content_approved", [sessionId, contentId, editedBody])
        })
      });

      emitChatActionResult({
        action: "approve-content",
        ok: true,
        sessionId
      });
      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve content.";
      emitChatActionError({
        action: "approve-content",
        message,
        sessionId
      });
      throw toRuntimeError(error, "Failed to approve content.");
    }
  });

  ipcMain.handle("chat:reject", async (_, payload) => {
    const sessionId = (payload?.sessionId ?? "").trim();
    const targetType = (payload?.type ?? "").trim();
    const id = (payload?.id ?? "").trim();
    const reason = (payload?.reason ?? "").trim();

    if (!sessionId || !targetType || !id) {
      throw new Error("sessionId, type, and id are required.");
    }

    const eventType =
      targetType === "campaign"
        ? "campaign_rejected"
        : targetType === "content"
          ? "content_rejected"
          : "";

    if (!eventType) {
      throw new Error('type must be "campaign" or "content".');
    }

    try {
      const body = await callOrchestratorApi(`/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          event_type: eventType,
          payload: {
            ...(targetType === "campaign" ? { campaign_id: id } : { content_id: id }),
            ...(reason ? { reason } : {})
          },
          idempotency_key: buildIdempotencyKey(eventType, [sessionId, id, reason])
        })
      });

      emitChatActionResult({
        action: "reject",
        ok: true,
        sessionId
      });
      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reject item.";
      emitChatActionError({
        action: "reject",
        message,
        sessionId
      });
      throw toRuntimeError(error, "Failed to reject item.");
    }
  });

  ipcMain.handle("chat:dispatch-action", async (_, payload) => {
    const sessionId = (payload?.sessionId ?? "").trim();
    const workflowItemId = (payload?.workflowItemId ?? "").trim();
    const actionId = (payload?.actionId ?? "").trim();
    const eventType = (payload?.eventType ?? "").trim();
    const expectedVersion = parsePositiveInteger(payload?.expectedVersion);
    const campaignId = (payload?.campaignId ?? "").trim();
    const contentId = (payload?.contentId ?? "").trim();
    const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
    const editedBody = typeof payload?.editedBody === "string" ? payload.editedBody.trim() : "";
    const mode = typeof payload?.mode === "string" ? payload.mode.trim().toLowerCase() : "";

    if (!sessionId || !workflowItemId || !actionId || !eventType || !expectedVersion) {
      throw new Error("sessionId, workflowItemId, actionId, eventType, expectedVersion are required.");
    }

    const allowedEventTypes = new Set([
      "campaign_approved",
      "campaign_rejected",
      "content_approved",
      "content_rejected"
    ]);
    if (!allowedEventTypes.has(eventType)) {
      throw new Error("Unsupported eventType for chat action dispatch.");
    }

    const eventPayload = {
      expected_version: expectedVersion
    };
    if (eventType.startsWith("campaign_")) {
      if (!campaignId) {
        throw new Error("campaignId is required for campaign events.");
      }
      eventPayload.campaign_id = campaignId;
    }
    if (eventType.startsWith("content_")) {
      if (!contentId) {
        throw new Error("contentId is required for content events.");
      }
      eventPayload.content_id = contentId;
    }
    if (eventType === "content_approved" && editedBody) {
      eventPayload.edited_body = editedBody;
    }

    if (mode === "revision") {
      if (!reason) {
        throw new Error("reason is required when mode is revision.");
      }
      eventPayload.mode = "revision";
      eventPayload.reason = reason;
    } else if ((eventType === "campaign_rejected" || eventType === "content_rejected") && reason) {
      eventPayload.reason = reason;
    }

    const idempotencyKey = buildChatActionIdempotencyKey({
      sessionId,
      workflowItemId,
      actionId,
      expectedVersion,
      editableInputs: [reason, editedBody]
    });

    try {
      const body = await callOrchestratorApi(`/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          event_type: eventType,
          payload: eventPayload,
          idempotency_key: idempotencyKey
        })
      });

      emitChatActionResult({
        action: "dispatch-action",
        ok: true,
        sessionId
      });
      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to dispatch chat action.";
      emitChatActionError({
        action: "dispatch-action",
        message,
        sessionId
      });
      throw toRuntimeError(error, "Failed to dispatch chat action.");
    }
  });
};

app.whenReady().then(async () => {
  const config = getDesktopRuntimeConfig();
  const rawConfig = getDesktopConfig();
  runtimeState.orgId = config.orgId;
  runtimeState.watchPath = config.watchPath;
  runtimeState.language = config.language;
  runtimeState.onboardingCompleted = config.onboardingCompleted;
  runtimeState.authUserId = String(rawConfig.lastAuthUserId ?? "").trim();
  runtimeState.onboardingCrawlState = createInitialCrawlState({
    websiteUrl: config.onboardingDraft?.websiteUrl ?? "",
    naverBlogUrl: config.onboardingDraft?.naverBlogUrl ?? "",
    instagramUrl: config.onboardingDraft?.instagramUrl ?? ""
  });
  runtimeState.onboardingLastSynthesis = null;
  const storedAuth = await resolveStoredAuthSession();
  runtimeState.authSession = storedAuth;
  const storedAuthUserId = parseJwtSubject(storedAuth?.accessToken ?? "");
  if (storedAuthUserId && storedAuthUserId !== runtimeState.authUserId) {
    runtimeState.authUserId = storedAuthUserId;
    saveLastAuthUserId(storedAuthUserId);
  }

  mainWindow = await createWindow();
  registerIpcHandlers();
  await waitForWindowReady(mainWindow);

  const hasValidAuthSession = !!(runtimeState.authSession && !isSessionExpired(runtimeState.authSession));
  if (!config.onboardingCompleted || !hasValidAuthSession || !config.watchPath) {
    emitWatcherStatus();
    mainWindow.webContents.send("app:show-onboarding");
  } else {
    emitWatcherStatus();
    if (config.watchPath) {
      await enqueueRuntimeStart(config.watchPath, runtimeState.orgId);
    }
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createWindow();
      await waitForWindowReady(mainWindow);
      emitWatcherStatus();
    }
  });
});

app.on("before-quit", () => {
  if (activeWatcher) {
    void activeWatcher.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
