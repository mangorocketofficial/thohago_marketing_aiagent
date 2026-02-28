import { TRIGGER_DEDUP_WINDOW_MS } from "./constants.mjs";

const relayEndpoint = (process.env.PIPELINE_TRIGGER_ENDPOINT ?? "").trim();
const relayToken = (process.env.PIPELINE_TRIGGER_TOKEN ?? "").trim();

let warnedMissingRelay = false;

/** @type {Map<string, number>} */
const recentTriggerByKey = new Map();

/**
 * @param {string} key
 */
const isDuplicateTrigger = (key) => {
  const now = Date.now();
  const last = recentTriggerByKey.get(key);
  if (last && now - last < TRIGGER_DEDUP_WINDOW_MS) {
    return true;
  }

  recentTriggerByKey.set(key, now);

  // Cleanup old dedupe keys.
  for (const [dedupeKey, ts] of recentTriggerByKey.entries()) {
    if (now - ts > TRIGGER_DEDUP_WINDOW_MS * 3) {
      recentTriggerByKey.delete(dedupeKey);
    }
  }

  return false;
};

/**
 * @param {{
 *   orgId: string,
 *   relativePath: string,
 *   fileName: string,
 *   activityFolder: string,
 *   fileType: "image" | "video" | "document",
 *   dedupeKey: string
 * }} payload
 */
export const writePipelineTrigger = async (payload) => {
  if (isDuplicateTrigger(payload.dedupeKey)) {
    return;
  }

  if (!relayEndpoint) {
    if (!warnedMissingRelay) {
      warnedMissingRelay = true;
      console.warn(
        "[Trigger] PIPELINE_TRIGGER_ENDPOINT is not set. " +
          "Skipping remote trigger writes in desktop runtime."
      );
    }
    return;
  }

  try {
    const response = await fetch(relayEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(relayToken ? { "x-trigger-token": relayToken } : {})
      },
      body: JSON.stringify({
        org_id: payload.orgId,
        relative_path: payload.relativePath,
        file_name: payload.fileName,
        activity_folder: payload.activityFolder,
        file_type: payload.fileType,
        source_event_id: payload.dedupeKey
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Trigger] Relay failed (${response.status}): ${body}`);
    }
  } catch (error) {
    console.error("[Trigger] Relay request failed:", error);
  }
};
