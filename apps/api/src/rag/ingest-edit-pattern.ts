import crypto from "node:crypto";
import { chunkBySourceType } from "@repo/rag";
import { getRagEmbedder, ragConfig, ragStore } from "../lib/rag";

type EditType = "minor_polish" | "tone_change" | "structure_change" | "major_rewrite";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const classifyEdit = (original: string, edited: string): EditType => {
  const left = normalizeText(original);
  const right = normalizeText(edited);
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) {
    return "minor_polish";
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;

  let matchCount = 0;
  let j = 0;
  for (let i = 0; i < shorter.length && j < longer.length; i += 1) {
    while (j < longer.length && shorter[i] !== longer[j]) {
      j += 1;
    }
    if (j < longer.length) {
      matchCount += 1;
      j += 1;
    }
  }

  const similarity = matchCount / maxLen;
  if (similarity > 0.9) {
    return "minor_polish";
  }
  if (similarity > 0.7) {
    return "tone_change";
  }
  if (similarity > 0.4) {
    return "structure_change";
  }
  return "major_rewrite";
};

const MAX_EDIT_PREVIEW_LENGTH = 600;

export const onContentEdited = async (
  orgId: string,
  originalDraft: string,
  editedBody: string,
  channel: string
): Promise<void> => {
  const original = originalDraft.trim();
  const edited = editedBody.trim();
  if (!original || !edited) {
    return;
  }
  if (original === edited) {
    return;
  }

  const editType = classifyEdit(original, edited);
  const patternText = [
    `채널: ${channel}`,
    `수정 유형: ${editType}`,
    "",
    "원본 초안:",
    original.slice(0, MAX_EDIT_PREVIEW_LENGTH),
    "",
    "사용자 수정본:",
    edited.slice(0, MAX_EDIT_PREVIEW_LENGTH)
  ]
    .join("\n")
    .trim();

  const sourceId = `edit_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const chunks = chunkBySourceType(patternText, {
    sourceType: "chat_pattern",
    sourceId,
    metadata: {
      channel,
      edit_type: editType,
      original_length: original.length,
      edited_length: edited.length,
      recorded_at: new Date().toISOString()
    }
  });
  if (!chunks.length) {
    return;
  }

  const embedder = getRagEmbedder();
  const profile = ragConfig.defaultEmbeddingProfile;
  const embeddings = await embedder.generateEmbeddings(
    chunks.map((chunk) => chunk.content),
    profile
  );

  await ragStore.insertBatch(orgId, chunks, embeddings, profile);
};
