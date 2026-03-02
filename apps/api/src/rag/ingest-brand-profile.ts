import crypto from "node:crypto";
import { chunkByHeading, type OrgBrandSettings, type RagChunk } from "@repo/rag";
import { getRagEmbedder, ragConfig, ragStore } from "../lib/rag";
import { supabaseAdmin } from "../lib/supabase-admin";
import { loadOrgBrandSettings, readReviewMarkdown } from "./data";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 5000, 15000] as const;
const RECOVERY_INTERVAL_MS = 60_000;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

const queuedOrgIds = new Set<string>();
const activeOrgIds = new Set<string>();

let workerStarted = false;
let recoveryTimer: NodeJS.Timeout | null = null;

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const normalizeForDedup = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"\\?<>[\]|+]/g, "")
    .trim();

const listToCsv = (items: string[]): string => items.filter((item) => item.trim()).join(", ");

const buildInterviewChunkCandidates = (
  brandSettings: OrgBrandSettings
): Array<{ chunk: RagChunk; dedupeTerms: string[] }> => {
  const candidates: Array<{ chunk: RagChunk; dedupeTerms: string[] }> = [];

  if (brandSettings.detected_tone || brandSettings.tone_description) {
    const tone = brandSettings.detected_tone?.trim() ?? "미설정";
    const toneDescription = brandSettings.tone_description?.trim() ?? "";
    const content = `브랜드 톤: ${tone}${toneDescription ? ` / 설명: ${toneDescription}` : ""}`;
    candidates.push({
      chunk: {
        source_type: "brand_profile",
        source_id: "interview",
        chunk_index: candidates.length,
        content,
        metadata: { interview_field: "tone" }
      },
      dedupeTerms: [tone, toneDescription].filter(Boolean)
    });
  }

  if (brandSettings.target_audience.length) {
    const audienceCsv = listToCsv(brandSettings.target_audience);
    candidates.push({
      chunk: {
        source_type: "brand_profile",
        source_id: "interview",
        chunk_index: candidates.length,
        content: `타겟 오디언스: ${audienceCsv}`,
        metadata: { interview_field: "target_audience" }
      },
      dedupeTerms: brandSettings.target_audience
    });
  }

  if (brandSettings.key_themes.length) {
    const themeCsv = listToCsv(brandSettings.key_themes);
    candidates.push({
      chunk: {
        source_type: "brand_profile",
        source_id: "interview",
        chunk_index: candidates.length,
        content: `핵심 테마: ${themeCsv}`,
        metadata: { interview_field: "key_themes" }
      },
      dedupeTerms: brandSettings.key_themes
    });
  }

  if (brandSettings.forbidden_words.length || brandSettings.forbidden_topics.length) {
    const lines: string[] = [];
    if (brandSettings.forbidden_words.length) {
      lines.push(`금지 단어: ${listToCsv(brandSettings.forbidden_words)}`);
    }
    if (brandSettings.forbidden_topics.length) {
      lines.push(`금지 주제: ${listToCsv(brandSettings.forbidden_topics)}`);
    }
    candidates.push({
      chunk: {
        source_type: "brand_profile",
        source_id: "interview",
        chunk_index: candidates.length,
        content: lines.join("\n"),
        metadata: { interview_field: "forbidden" }
      },
      dedupeTerms: [...brandSettings.forbidden_words, ...brandSettings.forbidden_topics]
    });
  }

  if (brandSettings.campaign_seasons.length) {
    const seasonCsv = listToCsv(brandSettings.campaign_seasons);
    candidates.push({
      chunk: {
        source_type: "brand_profile",
        source_id: "interview",
        chunk_index: candidates.length,
        content: `주요 캠페인 시즌: ${seasonCsv}`,
        metadata: { interview_field: "campaign_seasons" }
      },
      dedupeTerms: brandSettings.campaign_seasons
    });
  }

  return candidates;
};

const dedupeInterviewChunks = (
  candidates: Array<{ chunk: RagChunk; dedupeTerms: string[] }>,
  reviewMarkdown: string
): RagChunk[] => {
  const reviewNormalized = normalizeForDedup(reviewMarkdown);
  if (!reviewNormalized) {
    return candidates.map((entry) => entry.chunk);
  }

  const deduped = candidates.filter((entry) => {
    const chunkNormalized = normalizeForDedup(entry.chunk.content);
    if (chunkNormalized && reviewNormalized.includes(chunkNormalized)) {
      return false;
    }

    const terms = entry.dedupeTerms.map(normalizeForDedup).filter((term) => term.length >= 2);
    if (terms.length && terms.every((term) => reviewNormalized.includes(term))) {
      return false;
    }
    return true;
  });

  return deduped.map((entry, index) => ({
    ...entry.chunk,
    chunk_index: index
  }));
};

const computeRagSourceHash = (brandSettings: OrgBrandSettings, reviewMarkdown: string): string => {
  const payload = {
    review_markdown: reviewMarkdown,
    detected_tone: brandSettings.detected_tone ?? "",
    tone_description: brandSettings.tone_description ?? "",
    target_audience: [...brandSettings.target_audience],
    key_themes: [...brandSettings.key_themes],
    forbidden_words: [...brandSettings.forbidden_words],
    forbidden_topics: [...brandSettings.forbidden_topics],
    campaign_seasons: [...brandSettings.campaign_seasons],
    brand_summary: brandSettings.brand_summary ?? ""
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

const setIngestionStatus = async (
  orgId: string,
  status: "pending" | "processing" | "done" | "failed",
  patch: Record<string, unknown> = {}
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("org_brand_settings")
    .update({
      rag_ingestion_status: status,
      ...patch
    })
    .eq("org_id", orgId);
  if (error) {
    throw new Error(`Failed to set RAG ingestion status (${status}): ${error.message}`);
  }
};

const scheduleRun = (orgId: string): void => {
  queueMicrotask(() => {
    void runQueuedOrg(orgId).catch((error) => {
      console.warn(`[RAG_INGEST] Unexpected queue runner error for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
};

const queueOrg = (orgId: string): void => {
  const normalized = orgId.trim();
  if (!normalized) {
    return;
  }
  if (queuedOrgIds.has(normalized)) {
    return;
  }
  if (activeOrgIds.has(normalized)) {
    queuedOrgIds.add(normalized);
    return;
  }

  queuedOrgIds.add(normalized);
  scheduleRun(normalized);
};

const runQueuedOrg = async (orgId: string): Promise<void> => {
  if (activeOrgIds.has(orgId)) {
    return;
  }
  if (!queuedOrgIds.has(orgId)) {
    return;
  }

  queuedOrgIds.delete(orgId);
  activeOrgIds.add(orgId);

  try {
    await ingestWithRetry(orgId);
  } catch (error) {
    console.warn(`[RAG_INGEST] Ingestion finished with error for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    activeOrgIds.delete(orgId);
    if (queuedOrgIds.has(orgId)) {
      scheduleRun(orgId);
    }
  }
};

const ingestBrandProfile = async (orgId: string): Promise<{ sourceHash: string }> => {
  const brandSettings = await loadOrgBrandSettings(orgId);
  if (!brandSettings) {
    throw new Error(`org_brand_settings row not found for org_id=${orgId}`);
  }

  const reviewMarkdown = readReviewMarkdown(brandSettings);
  const sourceHash = computeRagSourceHash(brandSettings, reviewMarkdown);
  if (brandSettings.rag_source_hash === sourceHash && brandSettings.rag_ingestion_status === "done") {
    return { sourceHash };
  }

  const embedder = getRagEmbedder();
  const profile = ragConfig.defaultEmbeddingProfile;

  const reviewChunks =
    reviewMarkdown.length > 100
      ? chunkByHeading(
          reviewMarkdown,
          {
            sourceType: "brand_profile",
            sourceId: "review",
            metadata: { segment: "review" }
          },
          { tagChannelSections: true }
        )
      : [];

  if (reviewChunks.length) {
    const reviewEmbeddings = await embedder.generateEmbeddings(
      reviewChunks.map((chunk) => chunk.content),
      profile
    );
    await ragStore.replaceBySource(orgId, "brand_profile", "review", reviewChunks, reviewEmbeddings, profile);
  } else {
    await ragStore.deleteBySource(orgId, "brand_profile", "review", profile);
  }

  const interviewCandidates = buildInterviewChunkCandidates(brandSettings);
  const interviewChunks = dedupeInterviewChunks(interviewCandidates, reviewMarkdown);
  if (interviewChunks.length) {
    const interviewEmbeddings = await embedder.generateEmbeddings(
      interviewChunks.map((chunk) => chunk.content),
      profile
    );
    await ragStore.replaceBySource(orgId, "brand_profile", "interview", interviewChunks, interviewEmbeddings, profile);
  } else {
    await ragStore.deleteBySource(orgId, "brand_profile", "interview", profile);
  }

  return { sourceHash };
};

const ingestWithRetry = async (orgId: string): Promise<void> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      await setIngestionStatus(orgId, "processing", {
        rag_ingestion_started_at: new Date().toISOString(),
        rag_ingestion_error: null
      });

      const { sourceHash } = await ingestBrandProfile(orgId);
      const nowIso = new Date().toISOString();
      await setIngestionStatus(orgId, "done", {
        rag_indexed_at: nowIso,
        rag_source_hash: sourceHash,
        rag_ingestion_started_at: null,
        rag_ingestion_error: null
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown ingestion error");
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
      }
    }
  }

  const message = (lastError?.message ?? "Unknown ingestion error").slice(0, MAX_ERROR_MESSAGE_LENGTH);
  await setIngestionStatus(orgId, "failed", {
    rag_ingestion_started_at: null,
    rag_ingestion_error: message
  });
  throw lastError ?? new Error(message);
};

const recoverPendingOrFailed = async (): Promise<void> => {
  const { data: pendingRows, error: pendingError } = await supabaseAdmin
    .from("org_brand_settings")
    .select("org_id")
    .in("rag_ingestion_status", ["pending", "failed"])
    .limit(100);
  if (pendingError) {
    console.warn(`[RAG_INGEST] Failed to load pending jobs: ${pendingError.message}`);
  }

  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: staleRows, error: staleError } = await supabaseAdmin
    .from("org_brand_settings")
    .select("org_id")
    .eq("rag_ingestion_status", "processing")
    .lt("rag_ingestion_started_at", staleCutoff)
    .limit(100);
  if (staleError) {
    console.warn(`[RAG_INGEST] Failed to load stale processing jobs: ${staleError.message}`);
  }

  const orgIds = new Set<string>();
  for (const row of [...(Array.isArray(pendingRows) ? pendingRows : []), ...(Array.isArray(staleRows) ? staleRows : [])]) {
    const orgId = typeof row?.org_id === "string" ? row.org_id.trim() : "";
    if (orgId) {
      orgIds.add(orgId);
    }
  }

  for (const orgId of orgIds) {
    await enqueueRagIngestion(orgId);
  }
};

export const startRagIngestionWorker = (): void => {
  if (workerStarted) {
    return;
  }
  workerStarted = true;

  void recoverPendingOrFailed().catch((error) => {
    console.warn(`[RAG_INGEST] Initial recovery failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  recoveryTimer = setInterval(() => {
    void recoverPendingOrFailed().catch((error) => {
      console.warn(`[RAG_INGEST] Periodic recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, RECOVERY_INTERVAL_MS);
  recoveryTimer.unref?.();
};

export const enqueueRagIngestion = async (orgId: string): Promise<void> => {
  const normalized = orgId.trim();
  if (!normalized) {
    return;
  }

  try {
    await setIngestionStatus(normalized, "pending", {
      rag_ingestion_started_at: null
    });
  } catch (error) {
    console.warn(
      `[RAG_INGEST] Failed to mark org as pending (${normalized}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  queueOrg(normalized);
};

export const onBrandReReview = async (orgId: string): Promise<void> => {
  await ragStore.deleteBySourceType(orgId, "brand_profile", ragConfig.defaultEmbeddingProfile);
  await enqueueRagIngestion(orgId);
};
