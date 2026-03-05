import { useEffect, useRef, useState, type CSSProperties } from "react";

type OverlayTextEditProps = {
  value: string;
  onChange: (text: string) => void;
  style: CSSProperties;
  maxLength: number;
  placeholder: string;
};

/**
 * Inline edit control positioned over composed image by template coordinates.
 */
export const OverlayTextEdit = ({ value, onChange, style, maxLength, placeholder }: OverlayTextEditProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(value);
    }
  }, [isEditing, value]);

  const openEditor = () => {
    setIsEditing(true);
    setDraft(value);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeEditor = () => {
    setIsEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="overlay-text-edit editing"
        style={style}
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, maxLength))}
        onBlur={closeEditor}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            inputRef.current?.blur();
          }
          if (event.key === "Escape") {
            setDraft(value);
            setIsEditing(false);
          }
        }}
        maxLength={maxLength}
      />
    );
  }

  return (
    <span className="overlay-text-edit display" style={style} onClick={openEditor} title="Click to edit">
      {value || placeholder}
    </span>
  );
};
