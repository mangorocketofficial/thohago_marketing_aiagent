import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { SUPPORTED_EXTENSIONS } from "./constants.mjs";

/**
 * @param {string} watchRoot
 * @param {string} filePath
 */
const toRelativePath = (watchRoot, filePath) =>
  path.relative(watchRoot, filePath).split(path.sep).join("/");

/**
 * @param {string} extension
 * @returns {"image"|"video"|"document"}
 */
const getFileType = (extension) => {
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
    return "image";
  }
  if ([".mp4", ".mov", ".avi"].includes(extension)) {
    return "video";
  }
  return "document";
};

/**
 * @param {string} relativePath
 * @param {string} watchRoot
 * @returns {string | null}
 */
const parseActivityFolder = (relativePath, watchRoot) => {
  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    // Root-level files are mapped to the watch folder name.
    return path.basename(watchRoot);
  }

  // Nested files inherit activity folder from the first directory under watch root.
  return parts[0];
};

/**
 * @param {string} filePath
 * @param {string} watchRoot
 * @returns {Promise<import("./file-index.mjs").FileEntry | null>}
 */
export const buildFileEntry = async (filePath, watchRoot) => {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null;
  }

  const relativePath = toRelativePath(watchRoot, filePath);
  if (relativePath.startsWith("..")) {
    return null;
  }

  const activityFolder = parseActivityFolder(relativePath, watchRoot);
  if (!activityFolder) {
    console.warn(`[Watcher] Skipping (invalid relative path): ${filePath}`);
    return null;
  }

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return null;
  }

  if (!stats.isFile()) {
    return null;
  }

  const detectedAt = new Date().toISOString();

  return {
    filePath,
    relativePath,
    fileName: path.basename(filePath),
    activityFolder,
    fileType: getFileType(extension),
    fileSize: stats.size,
    extension,
    detectedAt,
    modifiedAt: new Date(stats.mtimeMs).toISOString(),
    status: "active"
  };
};

/**
 * @param {string} filePath
 * @param {string} watchRoot
 * @returns {{
 *   filePath: string,
 *   relativePath: string,
 *   fileName: string,
 *   activityFolder: string | null,
 *   extension: string,
 *   detectedAt: string
 * } | null}
 */
export const buildDeletedDescriptor = (filePath, watchRoot) => {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null;
  }

  const relativePath = toRelativePath(watchRoot, filePath);
  if (relativePath.startsWith("..")) {
    return null;
  }

  const activityFolder = parseActivityFolder(relativePath, watchRoot);
  if (!activityFolder) {
    console.warn(`[Watcher] Deletion skipped (invalid relative path): ${filePath}`);
    return null;
  }

  return {
    filePath,
    relativePath,
    fileName: path.basename(filePath),
    activityFolder,
    extension,
    detectedAt: new Date().toISOString()
  };
};

/**
 * @param {string} watchRoot
 * @returns {Promise<import("./file-index.mjs").FileEntry[]>}
 */
export const collectInitialFiles = async (watchRoot) => {
  /** @type {import("./file-index.mjs").FileEntry[]} */
  const entries = [];

  /** @type {string[]} */
  const pendingDirectories = [watchRoot];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    let directoryEntries;
    try {
      directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      console.warn(
        `[Scan] Failed to read directory ${currentDirectory}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }

    for (const directoryEntry of directoryEntries) {
      if (directoryEntry.name.startsWith(".")) {
        continue;
      }

      const entryPath = path.join(currentDirectory, directoryEntry.name);

      if (directoryEntry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (!directoryEntry.isFile()) {
        continue;
      }

      const fileEntry = await buildFileEntry(entryPath, watchRoot);
      if (fileEntry) {
        entries.push(fileEntry);
      }
    }
  }

  return entries;
};

/**
 * @param {{
 *   watchRoot: string,
 *   onUpsert: (entry: import("./file-index.mjs").FileEntry, eventType: "add" | "change") => Promise<void> | void,
 *   onDelete: (entry: {
 *     filePath: string,
 *     relativePath: string,
 *     fileName: string,
 *     activityFolder: string,
 *     detectedAt: string
 *   }) => Promise<void> | void
 * }} params
 */
export const startWatcher = ({ watchRoot, onUpsert, onDelete }) => {
  const watcher = chokidar.watch(watchRoot, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  });

  watcher.on("add", (filePath) => {
    void (async () => {
      const entry = await buildFileEntry(filePath, watchRoot);
      if (!entry) {
        return;
      }
      await onUpsert(entry, "add");
    })();
  });

  watcher.on("change", (filePath) => {
    void (async () => {
      const entry = await buildFileEntry(filePath, watchRoot);
      if (!entry) {
        return;
      }
      await onUpsert(entry, "change");
    })();
  });

  watcher.on("unlink", (filePath) => {
    void (async () => {
      const deleted = buildDeletedDescriptor(filePath, watchRoot);
      if (!deleted || !deleted.activityFolder) {
        return;
      }

      await onDelete({
        filePath: deleted.filePath,
        relativePath: deleted.relativePath,
        fileName: deleted.fileName,
        activityFolder: deleted.activityFolder,
        detectedAt: deleted.detectedAt
      });
    })();
  });

  watcher.on("error", (error) => {
    console.error("[Watcher] Runtime error:", error);
  });

  console.log(`[Watcher] Monitoring: ${watchRoot}`);
  return watcher;
};
