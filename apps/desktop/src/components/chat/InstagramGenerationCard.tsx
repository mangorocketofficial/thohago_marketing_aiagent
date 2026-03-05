import { useState } from "react";
import type { ChatMessage } from "@repo/types";

export type InstagramGenerationCardMeta = {
  contentId: string;
  slotId: string;
  topic: string;
  templateId: string;
  model: string;
  previewUrl: string | null;
  generatedCaption: string | null;
  charCount: number | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

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

  return {
    contentId,
    slotId,
    topic: asString(metadata.topic, "").trim() || "Instagram draft",
    templateId: asString(metadata.template_id, "").trim() || "unknown",
    model,
    previewUrl: asString(metadata.preview_url, "").trim() || null,
    generatedCaption,
    charCount
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
      {meta.previewUrl ? (
        <div className="chat-instagram-generation-preview">
          <img src={meta.previewUrl} alt={`${meta.topic} preview`} />
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
