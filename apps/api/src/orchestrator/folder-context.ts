import fs from "node:fs/promises";
import path from "node:path";

type FolderFileType = "image" | "video" | "document";

export type FolderContext = {
  activity_folder: string;
  total_files: number;
  images: string[];
  videos: string[];
  documents: string[];
  scanned_at: string;
};

export type FolderDiff = {
  added: string[];
  removed: string[];
  is_first_scan: boolean;
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".pdf",
  ".csv",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".hwp",
  ".hwpx"
]);
const DEFAULT_MAX_FILES = 2000;

const normalizeFileName = (value: string): string => value.trim();

const sortAsc = (values: string[]): string[] => [...values].sort((left, right) => left.localeCompare(right));

const ensureSafeFolderPath = (watchRoot: string, activityFolder: string): string => {
  const root = path.resolve(watchRoot);
  const folder = path.resolve(root, activityFolder);
  if (folder === root || folder.startsWith(`${root}${path.sep}`)) {
    return folder;
  }
  throw new Error("activity_folder path escapes watch root.");
};

const classifyFileType = (fileName: string): FolderFileType | null => {
  const extension = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }
  return null;
};

const allFiles = (context: FolderContext): string[] =>
  sortAsc([...context.images, ...context.videos, ...context.documents]);

export const buildLiveFolderContext = async (
  watchRoot: string,
  activityFolder: string,
  options?: { maxFiles?: number }
): Promise<FolderContext> => {
  const normalizedFolder = activityFolder.trim();
  if (!normalizedFolder) {
    throw new Error("activity_folder is required.");
  }

  const maxFiles =
    typeof options?.maxFiles === "number" && Number.isFinite(options.maxFiles) && options.maxFiles > 0
      ? Math.floor(options.maxFiles)
      : DEFAULT_MAX_FILES;
  const folderPath = ensureSafeFolderPath(watchRoot, normalizedFolder);
  const entries = await fs.readdir(folderPath, { withFileTypes: true });

  const images: string[] = [];
  const videos: string[] = [];
  const documents: string[] = [];

  let scannedFiles = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = normalizeFileName(entry.name);
    if (!fileName) {
      continue;
    }
    scannedFiles += 1;
    if (scannedFiles > maxFiles) {
      break;
    }

    const fileType = classifyFileType(fileName);
    if (fileType === "image") {
      images.push(fileName);
    } else if (fileType === "video") {
      videos.push(fileName);
    } else if (fileType === "document") {
      documents.push(fileName);
    }
  }

  return {
    activity_folder: normalizedFolder,
    total_files: images.length + videos.length + documents.length,
    images: sortAsc(images),
    videos: sortAsc(videos),
    documents: sortAsc(documents),
    scanned_at: new Date().toISOString()
  };
};

export const detectFolderChanges = (previous: FolderContext | null, current: FolderContext): FolderDiff => {
  if (!previous) {
    return {
      added: allFiles(current),
      removed: [],
      is_first_scan: true
    };
  }

  const previousFiles = allFiles(previous);
  const currentFiles = allFiles(current);
  const previousSet = new Set(previousFiles);
  const currentSet = new Set(currentFiles);

  return {
    added: currentFiles.filter((fileName) => !previousSet.has(fileName)),
    removed: previousFiles.filter((fileName) => !currentSet.has(fileName)),
    is_first_scan: false
  };
};
