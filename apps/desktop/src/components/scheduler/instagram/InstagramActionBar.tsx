import { useState } from "react";
import { composeCaptionBody } from "./metadata";

type InstagramActionBarProps = {
  caption: string;
  hashtags: string[];
  isDirty: boolean;
  isSaving: boolean;
  isRecomposing: boolean;
  localSaveStatus: "idle" | "saved" | "error";
  downloadLabel?: string;
  onDownloadImage: () => void;
  onSave: () => void;
  onRegenerate: () => void;
};

/**
 * Bottom action row for download/copy/save/regenerate operations.
 */
export const InstagramActionBar = ({
  caption,
  hashtags,
  isDirty,
  isSaving,
  isRecomposing,
  localSaveStatus,
  downloadLabel = "Download image",
  onDownloadImage,
  onSave,
  onRegenerate
}: InstagramActionBarProps) => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(composeCaptionBody(caption, hashtags));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    } finally {
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  return (
    <div className="instagram-action-bar-wrap">
      <div className="instagram-action-bar">
        <button type="button" onClick={onDownloadImage} disabled={isRecomposing}>
          {downloadLabel}
        </button>
        <button type="button" onClick={() => void handleCopyCaption()}>
          {copyStatus === "copied" ? "Copied!" : copyStatus === "error" ? "Copy failed" : "Copy caption"}
        </button>
        <button type="button" className="primary" onClick={onSave} disabled={!isDirty || isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onRegenerate} disabled={isSaving}>
          Regenerate
        </button>
      </div>
      {localSaveStatus === "saved" ? <p className="sub-description">Local caption file saved.</p> : null}
      {localSaveStatus === "error" ? <p className="notice">Failed to save local caption file.</p> : null}
    </div>
  );
};
