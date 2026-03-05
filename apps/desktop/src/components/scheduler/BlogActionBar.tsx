type BlogActionBarProps = {
  isDirty: boolean;
  isSaving: boolean;
  copyStatus: "idle" | "copied" | "error";
  localSaveStatus: "idle" | "saved" | "error";
  onCopy: () => void;
  onSave: () => void;
  onRegenerate: () => void;
};

const copyStatusLabel = (value: BlogActionBarProps["copyStatus"]): string => {
  if (value === "copied") {
    return "복사됨!";
  }
  if (value === "error") {
    return "복사 실패";
  }
  return "";
};

const localSaveLabel = (value: BlogActionBarProps["localSaveStatus"]): string => {
  if (value === "saved") {
    return "로컬 파일 저장 완료";
  }
  if (value === "error") {
    return "로컬 파일 저장 실패";
  }
  return "";
};

export const BlogActionBar = ({
  isDirty,
  isSaving,
  copyStatus,
  localSaveStatus,
  onCopy,
  onSave,
  onRegenerate
}: BlogActionBarProps) => {
  const copyLabel = copyStatusLabel(copyStatus);
  const localLabel = localSaveLabel(localSaveStatus);

  return (
    <div className="blog-action-bar-wrap">
      <div className="blog-action-bar">
        <button type="button" onClick={onCopy}>
          복사하기
        </button>
        <button type="button" className="primary" onClick={onSave} disabled={isSaving || !isDirty}>
          {isSaving ? "저장 중..." : "저장"}
        </button>
        <button type="button" onClick={onRegenerate} disabled={isSaving}>
          재생성
        </button>
      </div>
      {copyLabel ? <p className="sub-description">{copyLabel}</p> : null}
      {localLabel ? <p className={`sub-description ${localSaveStatus === "error" ? "notice" : ""}`}>{localLabel}</p> : null}
    </div>
  );
};
