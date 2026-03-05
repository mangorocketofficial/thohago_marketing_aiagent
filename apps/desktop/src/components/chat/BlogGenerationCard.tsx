import { useState } from "react";
import type { ChatMessage } from "@repo/types";

export type BlogGenerationCardMeta = {
  contentId: string;
  slotId: string;
  topic: string;
  charCount: number | null;
  model: string;
  generatedBody: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const toModelLabel = (model: string): string => {
  if (model === "gpt-4o-mini") {
    return "GPT-4o mini";
  }
  if (model === "claude") {
    return "Claude";
  }
  return model || "AI";
};

export const readBlogGenerationCardMeta = (message: ChatMessage): BlogGenerationCardMeta | null => {
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

  const generatedBody = asString(metadata.generated_body, "").trim() || null;
  const topic = asString(metadata.topic, "").trim() || "생성된 블로그 글";
  const charCountRaw = metadata.char_count;
  const charCount =
    typeof charCountRaw === "number" && Number.isFinite(charCountRaw)
      ? Math.max(0, Math.floor(charCountRaw))
      : generatedBody
        ? generatedBody.length
        : null;

  return {
    contentId,
    slotId,
    topic,
    charCount,
    model,
    generatedBody
  };
};

type BlogGenerationCardProps = {
  meta: BlogGenerationCardMeta;
  onOpenEditor: (contentId: string) => void;
};

export const BlogGenerationCard = ({ meta, onOpenEditor }: BlogGenerationCardProps) => {
  const [copyNotice, setCopyNotice] = useState("");

  const handleCopy = async () => {
    if (!meta.generatedBody) {
      setCopyNotice("복사할 본문이 없어 에디터에서 복사해주세요.");
      window.setTimeout(() => setCopyNotice(""), 2_000);
      return;
    }

    try {
      await navigator.clipboard.writeText(meta.generatedBody);
      setCopyNotice("복사됨!");
    } catch {
      setCopyNotice("복사 실패");
    } finally {
      window.setTimeout(() => setCopyNotice(""), 2_000);
    }
  };

  return (
    <div className="chat-blog-generation-card">
      <p className="chat-blog-generation-title">네이버 블로그 글이 생성되었습니다.</p>
      <strong>{meta.topic}</strong>
      <p className="chat-blog-generation-meta">
        {meta.charCount !== null ? `${meta.charCount.toLocaleString()}자 | ` : ""}
        {toModelLabel(meta.model)} 생성
      </p>
      <div className="button-row">
        <button type="button" className="primary" onClick={() => onOpenEditor(meta.contentId)}>
          에디터에서 보기
        </button>
        <button type="button" onClick={() => void handleCopy()}>
          복사하기
        </button>
      </div>
      {copyNotice ? <small>{copyNotice}</small> : null}
    </div>
  );
};
