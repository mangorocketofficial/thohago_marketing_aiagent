import { useEffect, useState } from "react";
import type { ChatMessage } from "@repo/types";

export type InstagramGenerationCardMeta = {
  contentId: string;
  slotId: string;
  topic: string;
  templateId: string;
  model: string;
  generatedCaption: string | null;
  charCount: number | null;
  overlayTexts: Record<string, string>;
  imageFileIds: string[];
  imagePaths: string[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => !!entry)
    : [];

const asStringMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const slotId = key.trim();
    const text = asString(entry, "").trim();
    if (!slotId || !text) {
      continue;
    }
    next[slotId] = text;
  }
  return next;
};

const toModelLabel = (value: string): string => {
  if (value === "gpt-4o-mini") {
    return "GPT-4o mini";
  }
  if (value === "claude") {
    return "Claude";
  }
  return value || "AI";
};

export const readInstagramGenerationCardMeta = (message: ChatMessage): InstagramGenerationCardMeta | null => {
  if (message.role !== "assistant") {
    return null;
  }

  const metadata = asRecord(message.metadata);
  const contentId = asString(metadata.content_id, "").trim();
  const slotId = asString(metadata.slot_id, "").trim();
  const model = asString(metadata.generation_model, "").trim().toLowerCase();
  if (!contentId || !slotId || !model) {
    return null;
  }

  const generatedCaption = asString(metadata.generated_caption, "").trim() || null;
  const charCountRaw = metadata.char_count;
  const charCount =
    typeof charCountRaw === "number" && Number.isFinite(charCountRaw)
      ? Math.max(0, Math.floor(charCountRaw))
      : generatedCaption
        ? generatedCaption.length
        : null;
  const overlayTexts = asStringMap(metadata.overlay_texts);

  return {
    contentId,
    slotId,
    topic: asString(metadata.topic, "").trim() || "Instagram draft",
    templateId: asString(metadata.template_id, "").trim() || "koica_cover_01",
    model,
    generatedCaption,
    charCount,
    overlayTexts,
    imageFileIds: asStringArray(metadata.image_file_ids),
    imagePaths: asStringArray(metadata.selected_image_paths)
  };
};

type InstagramGenerationCardProps = {
  meta: InstagramGenerationCardMeta;
  onOpenEditor: (contentId: string) => void;
};

/**
 * Compact card shown in chat timeline when instagram draft generation completes.
 */
export const InstagramGenerationCard = ({ meta, onOpenEditor }: InstagramGenerationCardProps) => {
  const [copyNotice, setCopyNotice] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const overlayTextsKey = JSON.stringify(meta.overlayTexts);

  useEffect(() => {
    let active = true;
    const composePreview = async () => {
      const result = await window.desktopRuntime.content.composeLocal({
        contentId: meta.contentId,
        templateId: meta.templateId,
        overlayTexts: meta.overlayTexts,
        ...(meta.imagePaths.length > 0 ? { imagePaths: meta.imagePaths } : {}),
        ...(meta.imageFileIds.length > 0 ? { imageFileIds: meta.imageFileIds } : {}),
        clientRequestId: `chat-card:${meta.contentId}`
      });
      if (!active) {
        return;
      }
      setPreviewDataUrl(result.ok ? result.thumbnailDataUrl : null);
    };
    void composePreview();
    return () => {
      active = false;
    };
  }, [meta.contentId, meta.imageFileIds, meta.imagePaths, overlayTextsKey, meta.templateId]);

  const handleCopy = async () => {
    if (!meta.generatedCaption) {
      setCopyNotice("Caption is not available.");
      window.setTimeout(() => setCopyNotice(""), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(meta.generatedCaption);
      setCopyNotice("Copied!");
    } catch {
      setCopyNotice("Copy failed");
    } finally {
      window.setTimeout(() => setCopyNotice(""), 2000);
    }
  };

  return (
    <div className="chat-instagram-generation-card">
      <p className="chat-instagram-generation-title">Instagram image draft generated</p>
      <strong>{meta.topic}</strong>
      <p className="chat-instagram-generation-meta">
        {meta.charCount !== null ? `${meta.charCount.toLocaleString()} chars | ` : ""}
        {meta.templateId} | {toModelLabel(meta.model)}
      </p>
      {previewDataUrl ? (
        <div className="chat-instagram-generation-preview">
          <img src={previewDataUrl} alt={`${meta.topic} preview`} />
        </div>
      ) : null}
      <div className="button-row">
        <button type="button" className="primary" onClick={() => onOpenEditor(meta.contentId)}>
          Open in editor
        </button>
        <button type="button" onClick={() => void handleCopy()}>
          Copy caption
        </button>
      </div>
      {copyNotice ? <small>{copyNotice}</small> : null}
    </div>
  );
};
