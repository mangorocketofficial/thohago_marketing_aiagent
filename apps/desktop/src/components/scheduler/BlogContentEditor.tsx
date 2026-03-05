import { useEffect, useMemo, useState } from "react";
import type { Content } from "@repo/types";
import type { ContentEditorProps } from "./ContentEditor";
import { BlogActionBar } from "./BlogActionBar";
import { EditorStatusBar } from "./EditorStatusBar";

type LocalSaveSuggestion = {
  relativePath: string;
  fileName: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const resolveStatusLabel = (slotStatus: ContentEditorProps["slotStatus"]): string => {
  if (slotStatus === "pending_approval") {
    return "Draft";
  }
  if (slotStatus === "generating") {
    return "Generating";
  }
  if (slotStatus === "failed") {
    return "Failed";
  }
  if (slotStatus === "scheduled") {
    return "Scheduled";
  }
  if (slotStatus === "approved") {
    return "Approved";
  }
  if (slotStatus === "published") {
    return "Published";
  }
  return "Skipped";
};

const resolveLocalSaveSuggestion = (content: Content): LocalSaveSuggestion => {
  const metadata = asRecord(content.metadata);
  const localSave = asRecord(metadata.local_save_suggestion);
  const relativePath = asString(localSave.relative_path, "").trim();
  const fileName = asString(localSave.file_name, "").trim();
  if (relativePath && fileName) {
    return {
      relativePath,
      fileName
    };
  }

  const datePart = (content.scheduled_at || content.created_at || "").slice(0, 10) || "content";
  return {
    relativePath: content.campaign_id ? `contents/campaign-${content.campaign_id.slice(0, 8)}` : "contents/ondemand",
    fileName: `${datePart}_naver-blog_${content.id.slice(0, 8)}.md`
  };
};

const resolveCampaignLabel = (content: Content): string => {
  if (content.campaign_id) {
    return `Campaign ${content.campaign_id.slice(0, 8)}`;
  }
  return "온디맨드";
};

/**
 * Blog-specific unified editor with copy/save/regenerate action bar.
 */
export const BlogContentEditor = ({
  content,
  slotStatus,
  onBack,
  onRegenerateRequest,
  onAfterSave
}: ContentEditorProps) => {
  const [body, setBody] = useState(content.body ?? "");
  const [savedBody, setSavedBody] = useState(content.body ?? "");
  const [updatedAt, setUpdatedAt] = useState(content.updated_at ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [localSaveStatus, setLocalSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    setBody(content.body ?? "");
    setSavedBody(content.body ?? "");
    setUpdatedAt(content.updated_at ?? "");
    setNotice("");
    setCopyStatus("idle");
    setLocalSaveStatus("idle");
  }, [content.body, content.id, content.updated_at]);

  const localSaveSuggestion = useMemo(() => resolveLocalSaveSuggestion(content), [content]);
  const isDirty = body !== savedBody;
  const charCount = body.length;

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const handleBack = () => {
    if (isDirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 나가시겠어요?")) {
      return;
    }
    onBack();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2_000);
    } catch {
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 2_000);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice("");
    setLocalSaveStatus("idle");

    try {
      const bodyResult = await window.desktopRuntime.content.saveBody({
        contentId: content.id,
        body,
        expectedUpdatedAt: updatedAt || undefined
      });

      if (!bodyResult.ok) {
        if (bodyResult.code === "version_conflict") {
          setNotice("다른 곳에서 수정되었습니다. 새로고침 후 다시 시도해주세요.");
          return;
        }
        setNotice(bodyResult.message || "저장에 실패했습니다.");
        return;
      }

      setSavedBody(bodyResult.content.body);
      setBody(bodyResult.content.body);
      setUpdatedAt(bodyResult.content.updated_at);

      const localSaveResult = await window.desktopRuntime.content.saveLocal({
        relativePath: localSaveSuggestion.relativePath,
        fileName: localSaveSuggestion.fileName,
        body: bodyResult.content.body,
        encoding: "utf8"
      });
      setLocalSaveStatus(localSaveResult.ok ? "saved" : "error");

      if (!localSaveResult.ok && localSaveResult.message) {
        setNotice(localSaveResult.message);
      }

      onAfterSave?.(content.id);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerate = () => {
    if (isDirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 재생성하면 현재 내용이 대체됩니다.")) {
      return;
    }

    if (onRegenerateRequest) {
      onRegenerateRequest(content.id);
      return;
    }

    window.dispatchEvent(new CustomEvent("ui:open-global-chat"));
  };

  return (
    <section className="ui-content-editor blog-content-editor">
      <div className="ui-content-editor-head">
        <div>
          <h2>네이버 블로그</h2>
          <p className="sub-description">
            Status: <strong>{resolveStatusLabel(slotStatus)}</strong> | {resolveCampaignLabel(content)}
          </p>
        </div>
        <button className="ui-content-editor-back-button" type="button" onClick={handleBack}>
          Back to Schedule
        </button>
      </div>

      <div className="blog-editor-surface">
        <textarea
          className="blog-editor-textarea"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          placeholder="블로그 내용을 편집하세요..."
        />
      </div>

      <EditorStatusBar charCount={charCount} isDirty={isDirty} lastSavedAt={updatedAt || null} />

      <BlogActionBar
        isDirty={isDirty}
        isSaving={isSaving}
        copyStatus={copyStatus}
        localSaveStatus={localSaveStatus}
        onCopy={() => {
          void handleCopy();
        }}
        onSave={() => {
          void handleSave();
        }}
        onRegenerate={handleRegenerate}
      />

      {notice ? <p className="notice">{notice}</p> : null}
    </section>
  );
};
