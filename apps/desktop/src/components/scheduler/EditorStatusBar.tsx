type EditorStatusBarProps = {
  charCount: number;
  isDirty: boolean;
  lastSavedAt: string | null;
};

const formatSavedAt = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
};

export const EditorStatusBar = ({ charCount, isDirty, lastSavedAt }: EditorStatusBarProps) => {
  return (
    <div className="blog-status-bar">
      <span>
        글자수: <strong>{charCount.toLocaleString()}</strong>
      </span>
      <span>{isDirty ? "저장되지 않은 변경사항 있음" : `마지막 저장: ${formatSavedAt(lastSavedAt)}`}</span>
    </div>
  );
};
