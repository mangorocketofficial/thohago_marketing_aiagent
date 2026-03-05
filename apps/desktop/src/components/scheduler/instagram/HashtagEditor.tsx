import { useRef, useState } from "react";

type HashtagEditorProps = {
  hashtags: string[];
  onChange: (hashtags: string[]) => void;
};

const normalizeTag = (value: string): string => value.trim().replace(/^#/, "").replace(/\s+/g, "");

/**
 * Chip input for adding/removing hashtag tokens.
 */
export const HashtagEditor = ({ hashtags, onChange }: HashtagEditorProps) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = () => {
    const nextTag = normalizeTag(inputValue);
    if (!nextTag || hashtags.some((entry) => entry.toLowerCase() === nextTag.toLowerCase())) {
      setInputValue("");
      return;
    }
    onChange([...hashtags, nextTag]);
    setInputValue("");
    inputRef.current?.focus();
  };

  const removeTag = (index: number) => {
    onChange(hashtags.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="instagram-hashtag-editor">
      <label className="ui-content-editor-label">Hashtags ({hashtags.length})</label>
      <div className="instagram-hashtag-input-area">
        {hashtags.map((tag, index) => (
          <span key={`${tag}-${index}`} className="instagram-hashtag-chip">
            #{tag}
            <button
              type="button"
              className="instagram-hashtag-remove"
              onClick={() => removeTag(index)}
              aria-label={`Remove #${tag}`}
            >
              x
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="instagram-hashtag-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              addTag();
              return;
            }
            if (event.key === "Backspace" && !inputValue && hashtags.length > 0) {
              removeTag(hashtags.length - 1);
            }
          }}
          onBlur={addTag}
          placeholder={hashtags.length === 0 ? "Type hashtag and press Enter" : ""}
          size={Math.max(inputValue.length + 2, 8)}
        />
      </div>
    </div>
  );
};
