import fs from "node:fs/promises";
import path from "node:path";
import { computeFileHash } from "./file-hash.mjs";

const IMAGE_INDEX_DEDUP_WINDOW_MS = 5_000;
const DEFAULT_VISION_MODEL = (process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
const DEFAULT_MAX_IMAGE_BYTES = Number.parseInt((process.env.IMAGE_INDEX_MAX_IMAGE_BYTES ?? "12582912").trim(), 10);

/** @type {Map<string, number>} */
const recentIndexByKey = new Map();

const normalizeBase = (value) => value.replace(/\/+$/, "");

const configuredApiBase = (process.env.ORCHESTRATOR_API_BASE ?? "").trim();
const configuredTriggerEndpoint = (process.env.PIPELINE_TRIGGER_ENDPOINT ?? "").trim();
const apiToken = (process.env.API_SECRET ?? process.env.PIPELINE_TRIGGER_TOKEN ?? "").trim();
const openAiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();

const resolveImageIndexEndpoint = (suffix) => {
  if (configuredApiBase) {
    return `${normalizeBase(configuredApiBase)}${suffix}`;
  }

  if (!configuredTriggerEndpoint) {
    return "";
  }

  try {
    const url = new URL(configuredTriggerEndpoint);
    if (url.pathname.endsWith("/trigger")) {
      url.pathname = url.pathname.slice(0, -"/trigger".length) + suffix;
    } else {
      url.pathname = suffix;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
};

const imageUpsertEndpoint = resolveImageIndexEndpoint("/image-index/upsert");
const imageDeleteEndpoint = resolveImageIndexEndpoint("/image-index/delete");
let warnedMissingEndpoint = false;
let warnedMissingOpenAiKey = false;

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

/**
 * @param {string} key
 * @returns {boolean}
 */
const isDuplicate = (key) => {
  const now = Date.now();
  const last = recentIndexByKey.get(key);
  if (last && now - last < IMAGE_INDEX_DEDUP_WINDOW_MS) {
    return true;
  }

  recentIndexByKey.set(key, now);
  for (const [entryKey, timestamp] of recentIndexByKey.entries()) {
    if (now - timestamp > IMAGE_INDEX_DEDUP_WINDOW_MS * 3) {
      recentIndexByKey.delete(entryKey);
    }
  }

  return false;
};

const normalizeText = (value, maxLength = 3000) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const parseJsonObject = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeVisionPayload = (raw) => {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const sceneTags = Array.isArray(row.scene_tags)
    ? row.scene_tags.map((entry) => normalizeText(entry, 64).toLowerCase()).filter(Boolean).slice(0, 32)
    : [];
  const objects = Array.isArray(row.objects)
    ? row.objects
        .map((entry) => {
          const item = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
          const label = normalizeText(item.label, 64).toLowerCase();
          const confidenceRaw =
            typeof item.confidence === "number"
              ? item.confidence
              : typeof item.confidence === "string"
                ? Number.parseFloat(item.confidence)
                : 0;
          if (!label) {
            return null;
          }
          return {
            label,
            confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0
          };
        })
        .filter((entry) => !!entry)
        .slice(0, 64)
    : [];

  const safetyRow = row.safety && typeof row.safety === "object" && !Array.isArray(row.safety) ? row.safety : {};
  const safety = {};
  for (const [key, value] of Object.entries(safetyRow)) {
    const normalizedKey = normalizeText(key, 48).toLowerCase();
    const normalizedValue = normalizeText(value, 48).toLowerCase();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    safety[normalizedKey] = normalizedValue;
    if (Object.keys(safety).length >= 24) {
      break;
    }
  }

  const summaryText = normalizeText(row.summary_text, 3000);
  if (!summaryText) {
    return null;
  }

  return {
    schema_version: normalizeText(row.schema_version || "1", 16) || "1",
    summary_text: summaryText,
    scene_tags: sceneTags,
    objects,
    ocr_text: normalizeText(row.ocr_text, 12000) || null,
    ocr_language: normalizeText(row.ocr_language, 16).toLowerCase() || null,
    safety
  };
};

const callVisionModel = async (params) => {
  if (!openAiApiKey) {
    if (!warnedMissingOpenAiKey) {
      warnedMissingOpenAiKey = true;
      console.warn("[Image-Indexer] OPENAI_API_KEY is missing. Image index rows will be marked failed.");
    }
    return {
      ok: false,
      error: "missing_openai_api_key"
    };
  }

  const extension = path.extname(params.fileName).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension] ?? "image/jpeg";

  let buffer;
  try {
    buffer = await fs.readFile(params.filePath);
  } catch (error) {
    return {
      ok: false,
      error: `read_failed:${error instanceof Error ? error.message : String(error)}`
    };
  }

  const maxBytes =
    Number.isFinite(DEFAULT_MAX_IMAGE_BYTES) && DEFAULT_MAX_IMAGE_BYTES > 0 ? DEFAULT_MAX_IMAGE_BYTES : 12 * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    return {
      ok: false,
      error: `file_too_large:${buffer.byteLength}`
    };
  }

  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content:
              "You are an image indexing model. Return strict JSON only. schema_version must be '1'. summary_text must be Korean one paragraph. Include scene_tags, objects(label/confidence), ocr_text, ocr_language, safety."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this image for marketing retrieval. Output JSON keys: schema_version, summary_text, scene_tags, objects, ocr_text, ocr_language, safety."
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl
                }
              }
            ]
          }
        ]
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string" && payload.error.message.trim()
          ? payload.error.message.trim()
          : `http_${response.status}`;
      return {
        ok: false,
        error: `vision_http_error:${message}`
      };
    }

    const content = payload?.choices?.[0]?.message?.content;
    const parsed = parseJsonObject(content);
    const normalized = normalizeVisionPayload(parsed);
    if (!normalized) {
      return {
        ok: false,
        error: "vision_parse_failed"
      };
    }

    return {
      ok: true,
      visionPayload: normalized
    };
  } catch (error) {
    return {
      ok: false,
      error: `vision_request_failed:${error instanceof Error ? error.message : String(error)}`
    };
  }
};

/**
 * @param {{
 *   orgId: string,
 *   filePath: string,
 *   relativePath: string,
 *   fileName: string,
 *   activityFolder: string,
 *   fileSize: number,
 *   modifiedAt: string
 * }} params
 */
export const indexImageForSelection = async (params) => {
  const dedupeKey = `image-index:${params.orgId}:${params.relativePath}:${params.modifiedAt}`;
  if (isDuplicate(dedupeKey)) {
    return;
  }

  if (!imageUpsertEndpoint) {
    if (!warnedMissingEndpoint) {
      warnedMissingEndpoint = true;
      console.warn("[Image-Indexer] ORCHESTRATOR_API_BASE/PIPELINE_TRIGGER_ENDPOINT not set. Skipping image indexing.");
    }
    return;
  }

  const hash = (await computeFileHash(params.filePath, params.fileSize)) ?? `hashless:${params.modifiedAt}:${params.fileSize}`;
  const vision = await callVisionModel(params);
  const status = vision.ok ? "ready" : "failed";
  const lastError = vision.ok ? null : vision.error;

  try {
    const response = await fetch(imageUpsertEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiToken ? { "x-api-token": apiToken } : {})
      },
      body: JSON.stringify({
        org_id: params.orgId,
        source_id: params.relativePath,
        activity_folder: params.activityFolder,
        file_name: params.fileName,
        file_size_bytes: params.fileSize,
        file_modified_at: params.modifiedAt,
        file_content_hash: hash,
        status,
        last_error: lastError,
        vision_model: DEFAULT_VISION_MODEL,
        vision_payload: vision.ok ? vision.visionPayload : null
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Image-Indexer] Upsert failed (${response.status}): ${body}`);
    }
  } catch (error) {
    console.error(
      `[Image-Indexer] Upsert request failed for ${params.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * @param {{ orgId: string, relativePath: string }} params
 */
export const deleteImageFromSelectionIndex = async (params) => {
  if (!imageDeleteEndpoint) {
    return;
  }

  try {
    const response = await fetch(imageDeleteEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiToken ? { "x-api-token": apiToken } : {})
      },
      body: JSON.stringify({
        org_id: params.orgId,
        source_id: params.relativePath
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Image-Indexer] Delete failed (${response.status}): ${body}`);
    }
  } catch (error) {
    console.error(
      `[Image-Indexer] Delete request failed for ${params.relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
