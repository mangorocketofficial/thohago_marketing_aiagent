import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { SEED_ORG_ID } from "./constants.mjs";
import { getDesktopConfig, saveOrgId, saveWatchPath } from "./config-store.mjs";
import {
  clearFileIndex,
  getActiveFiles,
  getFileCount,
  softDeleteFile,
  toRendererEntry,
  upsertFile
} from "./file-index.mjs";
import { writePipelineTrigger } from "./pipeline-trigger-relay.mjs";
import { collectInitialFiles, startWatcher } from "./watcher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

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
      preload: path.join(__dirname, "preload.mjs"),
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
  fileCount: getFileCount(),
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
