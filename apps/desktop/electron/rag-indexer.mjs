import { extractText, isTextExtractable } from "./text-extractor.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";

const RAG_INDEX_DEDUP_WINDOW_MS = 5_000;
const MAX_HASH_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/** @type {Map<string, number>} */
const recentIndexByKey = new Map();

const normalizeBase = (value) => value.replace(/\/+$/, "");

const configuredApiBase = (process.env.ORCHESTRATOR_API_BASE ?? "").trim();
const configuredTriggerEndpoint = (process.env.PIPELINE_TRIGGER_ENDPOINT ?? "").trim();
const ragToken = (process.env.API_SECRET ?? process.env.PIPELINE_TRIGGER_TOKEN ?? "").trim();

const resolveRagIndexEndpoint = () => {
  if (configuredApiBase) {
    return `${normalizeBase(configuredApiBase)}/rag/index-document`;
  }

  if (!configuredTriggerEndpoint) {
    return "";
  }

  try {
    const url = new URL(configuredTriggerEndpoint);
    if (url.pathname.endsWith("/trigger")) {
      url.pathname = url.pathname.slice(0, -"/trigger".length) + "/rag/index-document";
    } else {
      url.pathname = "/rag/index-document";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
};

const ragIndexEndpoint = resolveRagIndexEndpoint();
let warnedMissingEndpoint = false;

/**
 * @param {string} key
 * @returns {boolean}
 */
const isDuplicate = (key) => {
  const now = Date.now();
  const last = recentIndexByKey.get(key);
  if (last && now - last < RAG_INDEX_DEDUP_WINDOW_MS) {
    return true;
  }

  recentIndexByKey.set(key, now);
  for (const [entryKey, timestamp] of recentIndexByKey.entries()) {
    if (now - timestamp > RAG_INDEX_DEDUP_WINDOW_MS * 3) {
      recentIndexByKey.delete(entryKey);
    }
  }

  return false;
};

/**
 * @param {string} filePath
 * @param {number | null} fileSize
 * @returns {Promise<string | null>}
 */
const computeFileHash = async (filePath, fileSize) => {
  if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > MAX_HASH_FILE_SIZE_BYTES) {
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

/**
 * @param {{
 *   orgId: string,
 *   filePath: string,
 *   relativePath: string,
 *   fileName: string,
 *   activityFolder: string,
 *   fileType: "image" | "video" | "document",
 *   fileSize: number,
 *   extension: string,
 *   modifiedAt: string
 * }} params
 */
export const indexFileForRag = async (params) => {
  const dedupeKey = `rag:${params.orgId}:${params.relativePath}:${params.modifiedAt}`;
  if (isDuplicate(dedupeKey)) {
    return;
  }

  if (!ragIndexEndpoint) {
    if (!warnedMissingEndpoint) {
      warnedMissingEndpoint = true;
      console.warn(
        "[RAG-Indexer] ORCHESTRATOR_API_BASE/PIPELINE_TRIGGER_ENDPOINT not set. Skipping RAG indexing."
      );
    }
    return;
  }

  let extractedText = null;
  const fileContentHash = await computeFileHash(params.filePath, params.fileSize);
  if (isTextExtractable(params.extension)) {
    extractedText = await extractText(params.filePath, params.extension);
  }

  try {
    const response = await fetch(ragIndexEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ragToken ? { "x-api-token": ragToken } : {})
      },
      body: JSON.stringify({
        org_id: params.orgId,
        source_id: params.relativePath,
        activity_folder: params.activityFolder,
        file_name: params.fileName,
        file_type: params.fileType,
        file_size_bytes: params.fileSize,
        file_modified_at: params.modifiedAt,
        file_content_hash: fileContentHash,
        extracted_text: extractedText
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[RAG-Indexer] Index failed (${response.status}): ${body}`);
    }
  } catch (error) {
    console.error(
      `[RAG-Indexer] Request failed for ${params.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * @param {{ orgId: string, relativePath: string }} params
 */
export const deleteFileFromRag = async (params) => {
  if (!ragIndexEndpoint) {
    return;
  }

  try {
    const response = await fetch(ragIndexEndpoint, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        ...(ragToken ? { "x-api-token": ragToken } : {})
      },
      body: JSON.stringify({
        org_id: params.orgId,
        source_id: params.relativePath
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[RAG-Indexer] Delete failed (${response.status}): ${body}`);
    }
  } catch (error) {
    console.error(
      `[RAG-Indexer] Delete request failed for ${params.relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
