/**
 * @typedef {"image"|"video"|"document"} FileType
 * @typedef {"active"|"deleted"} FileStatus
 *
 * @typedef {Object} FileEntry
 * @property {string} filePath
 * @property {string} relativePath
 * @property {string} fileName
 * @property {string} activityFolder
 * @property {FileType} fileType
 * @property {number} fileSize
 * @property {string} extension
 * @property {string} detectedAt
 * @property {string} modifiedAt
 * @property {FileStatus} status
 */

/** @type {Map<string, FileEntry>} */
const fileIndex = new Map();

export const clearFileIndex = () => {
  fileIndex.clear();
};

/**
 * @param {FileEntry} entry
 */
export const upsertFile = (entry) => {
  fileIndex.set(entry.filePath, {
    ...entry,
    status: "active"
  });
};

/**
 * @param {string} filePath
 * @param {string} detectedAt
 */
export const softDeleteFile = (filePath, detectedAt) => {
  const existing = fileIndex.get(filePath);
  if (!existing) {
    return;
  }

  fileIndex.set(filePath, {
    ...existing,
    detectedAt,
    status: "deleted"
  });
};

export const getFileCount = () => fileIndex.size;

/**
 * @returns {FileEntry[]}
 */
export const getActiveFiles = () =>
  Array.from(fileIndex.values())
    .filter((entry) => entry.status === "active")
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

/**
 * @param {FileEntry} entry
 */
export const toRendererEntry = (entry) => ({
  relativePath: entry.relativePath,
  fileName: entry.fileName,
  activityFolder: entry.activityFolder,
  fileType: entry.fileType,
  fileSize: entry.fileSize,
  extension: entry.extension,
  detectedAt: entry.detectedAt,
  status: entry.status
});
