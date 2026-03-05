import { createHash } from "node:crypto";
import fs from "node:fs";

export const DEFAULT_MAX_HASH_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * Compute sha256 hash for local file. Returns null on IO errors or size guard.
 * @param {string} filePath
 * @param {number | null | undefined} fileSize
 * @param {{ maxFileSizeBytes?: number }} [options]
 * @returns {Promise<string | null>}
 */
export const computeFileHash = async (filePath, fileSize, options = {}) => {
  const maxFileSizeBytes =
    typeof options.maxFileSizeBytes === "number" && Number.isFinite(options.maxFileSizeBytes)
      ? Math.max(1, Math.floor(options.maxFileSizeBytes))
      : DEFAULT_MAX_HASH_FILE_SIZE_BYTES;

  if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > maxFileSizeBytes) {
    return null;
  }

  return new Promise((resolve) => {
    const hasher = createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("error", () => resolve(null));
    stream.on("data", (chunk) => hasher.update(chunk));
    stream.on("end", () => resolve(hasher.digest("hex")));
  });
};
