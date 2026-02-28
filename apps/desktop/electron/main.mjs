import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_ORG_ID } from "./constants.mjs";
import { getDesktopConfig, saveOrgId, saveWatchPath } from "./config-store.mjs";
import {
  clearFileIndex,
  getActiveFiles,
  softDeleteFile,
  toRendererEntry,
  upsertFile
} from "./file-index.mjs";
import { writePipelineTrigger } from "./pipeline-trigger-relay.mjs";
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

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("chokidar").FSWatcher | null} */
let activeWatcher = null;
/** @type {Promise<void>} */
let runtimeTask = Promise.resolve();

const runtimeState = {
  watchPath: "",
  orgId: SEED_ORG_ID,
  isRunning: false,
  initialScanCount: 0
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

const buildIdempotencyKey = (action, id = "") =>
  `desktop:${action}:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

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
    throw new Error(typeof message === "string" ? message : `HTTP ${response.status}`);
  }

  return body;
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

const resolveSupabaseAccessToken = () => {
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

const getWatcherStatus = () => ({
  watchPath: runtimeState.watchPath || null,
  orgId: runtimeState.orgId,
  fileCount: getActiveFiles().length,
  isRunning: runtimeState.isRunning,
  requiresOnboarding: !runtimeState.watchPath
});

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

      emitWatcherStatus();
    },
    onDelete: async (deleted) => {
      softDeleteFile(deleted.filePath, deleted.detectedAt);
      mainWindow?.webContents.send("file:deleted", {
        relativePath: deleted.relativePath,
        fileName: deleted.fileName
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

const registerIpcHandlers = () => {
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
    if (!watchPath) {
      throw new Error("watchPath is required");
    }

    const resolvedPath = path.resolve(watchPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      throw new Error(`watchPath is invalid: ${resolvedPath}`);
    }

    saveWatchPath(resolvedPath);
    saveOrgId(SEED_ORG_ID);

    runtimeState.watchPath = resolvedPath;
    runtimeState.orgId = SEED_ORG_ID;

    await enqueueRuntimeStart(resolvedPath, SEED_ORG_ID);
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
          idempotency_key: buildIdempotencyKey("user_message", sessionId)
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
      throw new Error(message);
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
          idempotency_key: buildIdempotencyKey("campaign_approved", campaignId)
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
      throw new Error(message);
    }
  });

  ipcMain.handle("chat:approve-content", async (_, payload) => {
    const sessionId = (payload?.sessionId ?? "").trim();
    const contentId = (payload?.contentId ?? "").trim();
    if (!sessionId || !contentId) {
      throw new Error("sessionId and contentId are required.");
    }

    try {
      const body = await callOrchestratorApi(`/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          event_type: "content_approved",
          payload: { content_id: contentId },
          idempotency_key: buildIdempotencyKey("content_approved", contentId)
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
      throw new Error(message);
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
          idempotency_key: buildIdempotencyKey(eventType, id)
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
      throw new Error(message);
    }
  });
};

app.whenReady().then(async () => {
  mainWindow = await createWindow();
  registerIpcHandlers();
  await waitForWindowReady(mainWindow);

  const config = getDesktopConfig();
  runtimeState.orgId = (config.orgId || SEED_ORG_ID).trim() || SEED_ORG_ID;

  if (!config.watchPath) {
    emitWatcherStatus();
    mainWindow.webContents.send("app:show-onboarding");
  } else {
    runtimeState.watchPath = config.watchPath;
    emitWatcherStatus();
    await enqueueRuntimeStart(config.watchPath, runtimeState.orgId);
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
