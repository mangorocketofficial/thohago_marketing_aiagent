import { HashtagEditor } from "./HashtagEditor";

type CaptionEditorProps = {
  caption: string;
  hashtags: string[];
  onChangeCaption: (caption: string) => void;
  onChangeHashtags: (hashtags: string[]) => void;
};

const INSTAGRAM_MAX = 2200;

/**
 * Caption textarea with character count and hashtag chip editor.
 */
export const CaptionEditor = ({ caption, hashtags, onChangeCaption, onChangeHashtags }: CaptionEditorProps) => {
  const charCount = caption.length;

  return (
    <div className="instagram-caption-editor">
      <label className="ui-content-editor-label" htmlFor="instagram-caption-textarea">
        Caption
      </label>
      <textarea
        id="instagram-caption-textarea"
        className="instagram-caption-textarea"
        value={caption}
        onChange={(event) => onChangeCaption(event.target.value)}
        placeholder="Write Instagram caption..."
        rows={6}
      />
      <div className="instagram-caption-status-bar">
        <span className={charCount > INSTAGRAM_MAX ? "instagram-char-over" : ""}>
          {charCount.toLocaleString()} / {INSTAGRAM_MAX.toLocaleString()}
        </span>
        {charCount > INSTAGRAM_MAX ? <span className="instagram-char-warning">Character limit exceeded</span> : null}
      </div>
      <HashtagEditor hashtags={hashtags} onChange={onChangeHashtags} />
    </div>
  );
};
