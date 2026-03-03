import { Router } from "express";
import { chunkBySourceType, type RagChunk } from "@repo/rag";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { asRecord, parseOptionalString, parseRequiredString } from "../lib/request-parsers";
import { getRagEmbedder, ragConfig, ragStore } from "../lib/rag";
import { requireActiveSubscription } from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";
import { embedPendingContentBatch } from "../rag/ingest-content";

const MIN_TEXT_LENGTH = 50;
const VALID_FILE_TYPES = new Set(["document", "image", "video"]);
const RAG_TABLE = "org_rag_embeddings";

const parseRequiredBodyString = (value: unknown, field: string): string =>
  parseRequiredString(value, field, { code: "invalid_body" });

const parseFileType = (value: unknown): "document" | "image" | "video" => {
  if (typeof value !== "string") {
    return "document";
  }
  const normalized = value.trim().toLowerCase();
  if (VALID_FILE_TYPES.has(normalized)) {
    return normalized as "document" | "image" | "video";
  }
  return "document";
};

const parseExtractedText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseOptionalNonNegativeInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
};

const readMetadataString = (metadata: Record<string, unknown>, key: string): string | null => {
  const value = metadata[key];
  return parseOptionalString(value);
};

const readMetadataInt = (metadata: Record<string, unknown>, key: string): number | null => {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
};

type LocalDocSignature = {
  fileModifiedAt: string | null;
  fileSizeBytes: number | null;
  fileContentHash: string | null;
};

const getExistingSignature = async (
  orgId: string,
  sourceId: string,
  embeddingModel: string,
  embeddingDim: number
): Promise<LocalDocSignature | null> => {
  const { data, error } = await supabaseAdmin
    .from(RAG_TABLE)
    .select("metadata")
    .eq("org_id", orgId)
    .eq("source_type", "local_doc")
    .eq("source_id", sourceId)
    .eq("embedding_model", embeddingModel)
    .eq("embedding_dim", embeddingDim)
    .limit(1);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to read existing local_doc signature: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return null;
  }

  const metadata = asRecord(rows[0]?.metadata);
  return {
    fileModifiedAt: readMetadataString(metadata, "file_modified_at"),
    fileSizeBytes: readMetadataInt(metadata, "file_size_bytes"),
    fileContentHash: readMetadataString(metadata, "file_content_hash")?.toLowerCase() ?? null
  };
};

const getExistingChunkCount = async (
  orgId: string,
  sourceId: string,
  embeddingModel: string,
  embeddingDim: number
): Promise<number> => {
  const { count, error } = await supabaseAdmin
    .from(RAG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("source_type", "local_doc")
    .eq("source_id", sourceId)
    .eq("embedding_model", embeddingModel)
    .eq("embedding_dim", embeddingDim);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to count local_doc chunks: ${error.message}`);
  }

  return typeof count === "number" ? count : 0;
};

const isUnchangedSignature = (incoming: LocalDocSignature, existing: LocalDocSignature | null): boolean => {
  if (!existing) {
    return false;
  }

  const hasHash = !!incoming.fileContentHash;
  const hasMtime = !!incoming.fileModifiedAt;
  const hasSize = incoming.fileSizeBytes !== null;
  if (!hasHash && !hasMtime && !hasSize) {
    return false;
  }

  const sameHash = hasHash && incoming.fileContentHash === existing.fileContentHash;
  const sameMtime = hasMtime && incoming.fileModifiedAt === existing.fileModifiedAt;
  const sameSize = hasSize && incoming.fileSizeBytes === existing.fileSizeBytes;

  if (hasHash && hasMtime) {
    return sameHash && sameMtime;
  }
  if (hasHash) {
    return sameHash && (!hasSize || sameSize);
  }
  if (hasMtime && hasSize) {
    return sameMtime && sameSize;
  }
  if (hasMtime) {
    return sameMtime;
  }
  return hasSize ? sameSize : false;
};

const buildMetadataChunk = (
  sourceId: string,
  fileName: string,
  fileType: "document" | "image" | "video",
  activityFolder: string,
  baseMetadata: Record<string, unknown>
): RagChunk[] => {
  const metadataText = [`file: ${fileName}`, `type: ${fileType}`, `activity_folder: ${activityFolder}`].join("\n");

  return [
    {
      source_type: "local_doc",
      source_id: sourceId,
      chunk_index: 0,
      content: metadataText,
      metadata: {
        ...baseMetadata,
        text_extracted: false
      }
    }
  ];
};

export const ragRouter: Router = Router();

ragRouter.post("/rag/index-document", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredBodyString(req.body?.org_id, "org_id");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const sourceId = parseRequiredBodyString(req.body?.source_id, "source_id");
    const activityFolder = parseRequiredBodyString(req.body?.activity_folder, "activity_folder");
    const fileName = parseRequiredBodyString(req.body?.file_name, "file_name");
    const fileType = parseFileType(req.body?.file_type);
    const extractedText = parseExtractedText(req.body?.extracted_text);
    const fileModifiedAt = parseOptionalString(req.body?.file_modified_at);
    const fileSizeBytes = parseOptionalNonNegativeInt(req.body?.file_size_bytes);
    const fileContentHash = parseOptionalString(req.body?.file_content_hash)?.toLowerCase() ?? null;
    const profile = ragConfig.defaultEmbeddingProfile;

    const incomingSignature: LocalDocSignature = {
      fileModifiedAt,
      fileSizeBytes,
      fileContentHash
    };
    const existingSignature = await getExistingSignature(orgId, sourceId, profile.model, profile.dimensions);
    if (isUnchangedSignature(incomingSignature, existingSignature)) {
      const chunkCount = await getExistingChunkCount(orgId, sourceId, profile.model, profile.dimensions);
      res.json({
        indexed: true,
        skipped: true,
        reason: "unchanged",
        chunk_count: chunkCount
      });
      return;
    }

    const baseMetadata: Record<string, unknown> = {
      activity_folder: activityFolder,
      file_name: fileName,
      file_type: fileType,
      ...(fileModifiedAt ? { file_modified_at: fileModifiedAt } : {}),
      ...(fileSizeBytes !== null ? { file_size_bytes: fileSizeBytes } : {}),
      ...(fileContentHash ? { file_content_hash: fileContentHash } : {}),
      indexed_at: new Date().toISOString()
    };

    const chunks =
      extractedText && extractedText.length >= MIN_TEXT_LENGTH
        ? chunkBySourceType(extractedText, {
            sourceType: "local_doc",
            sourceId,
            metadata: {
              ...baseMetadata,
              text_extracted: true
            }
          })
        : buildMetadataChunk(sourceId, fileName, fileType, activityFolder, baseMetadata);

    if (!chunks.length) {
      await ragStore.deleteBySource(orgId, "local_doc", sourceId, profile);
      res.json({ indexed: true, chunk_count: 0 });
      return;
    }

    const embedder = getRagEmbedder();
    const embeddings = await embedder.generateEmbeddings(
      chunks.map((chunk) => chunk.content),
      profile
    );

    await ragStore.replaceBySource(orgId, "local_doc", sourceId, chunks, embeddings, profile);

    res.json({
      indexed: true,
      chunk_count: chunks.length
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});

ragRouter.post("/rag/embed-pending-content", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredBodyString(req.body?.org_id, "org_id");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const batchLimit = parseOptionalNonNegativeInt(req.body?.batch_limit) ?? 100;
    const result = await embedPendingContentBatch(orgId, Math.max(1, batchLimit));
    res.json(result);
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});

ragRouter.delete("/rag/index-document", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredBodyString(req.body?.org_id, "org_id");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const sourceId = parseRequiredBodyString(req.body?.source_id, "source_id");
    await ragStore.deleteBySource(orgId, "local_doc", sourceId, ragConfig.defaultEmbeddingProfile);

    res.json({
      deleted: true,
      source_id: sourceId
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});
