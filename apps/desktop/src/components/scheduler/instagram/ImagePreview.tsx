import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { OverlayTextEdit } from "./OverlayTextEdit";

export type TemplateTextPosition = {
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  align: "center" | "left" | "right";
};

type ImagePreviewProps = {
  imageUrl: string;
  width: number;
  height: number;
  overlayMain: string;
  overlaySub: string;
  mainTextPosition: TemplateTextPosition;
  subTextPosition: TemplateTextPosition | null;
  isRecomposing: boolean;
  onEditOverlayMain: (text: string) => void;
  onEditOverlaySub: (text: string) => void;
};

/**
 * Render composed instagram image and clickable inline overlay edit zones.
 */
export const ImagePreview = ({
  imageUrl,
  width,
  height,
  overlayMain,
  overlaySub,
  mainTextPosition,
  subTextPosition,
  isRecomposing,
  onEditOverlayMain,
  onEditOverlaySub
}: ImagePreviewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const containerWidth = entries[0]?.contentRect.width ?? width;
      setDisplayScale(containerWidth / width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [width]);

  const toDisplayStyle = useMemo(
    () => (position: TemplateTextPosition): CSSProperties => ({
      position: "absolute",
      top: position.y * displayScale,
      left: position.x * displayScale,
      width: position.maxWidth * displayScale,
      fontSize: Math.max(10, position.fontSize * displayScale),
      textAlign: position.align
    }),
    [displayScale]
  );

  return (
    <div className="instagram-image-preview-container" ref={containerRef}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="Instagram post preview"
          className="instagram-image-preview-img"
          style={{ width: "100%", aspectRatio: `${width}/${height}` }}
        />
      ) : (
        <div className="instagram-image-preview-empty" style={{ aspectRatio: `${width}/${height}` }}>
          Preview image is not ready yet.
        </div>
      )}

      <OverlayTextEdit
        value={overlayMain}
        onChange={onEditOverlayMain}
        style={toDisplayStyle(mainTextPosition)}
        maxLength={15}
        placeholder="Main text"
      />
      {subTextPosition ? (
        <OverlayTextEdit
          value={overlaySub}
          onChange={onEditOverlaySub}
          style={toDisplayStyle(subTextPosition)}
          maxLength={25}
          placeholder="Sub text"
        />
      ) : null}

      {isRecomposing ? (
        <div className="instagram-image-preview-loading">
          <span>Re-composing image...</span>
        </div>
      ) : null}
    </div>
  );
};
