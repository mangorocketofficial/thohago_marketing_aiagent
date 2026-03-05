import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { OverlayTextEdit } from "./OverlayTextEdit";

export type TemplateTextSlotPosition = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  align: "center" | "left" | "right";
};

type ImagePreviewProps = {
  imageUrl: string;
  width: number;
  height: number;
  textSlots: TemplateTextSlotPosition[];
  overlayTexts: Record<string, string>;
  isRecomposing: boolean;
  onEditOverlayText: (slotId: string, text: string) => void;
};

/**
 * Render composed instagram image and clickable inline overlay edit zones.
 */
export const ImagePreview = ({
  imageUrl,
  width,
  height,
  textSlots,
  overlayTexts,
  isRecomposing,
  onEditOverlayText
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
    () => (slot: TemplateTextSlotPosition): CSSProperties => ({
      position: "absolute",
      top: slot.y * displayScale,
      left: slot.x * displayScale,
      width: slot.width * displayScale,
      minHeight: slot.height * displayScale,
      fontSize: Math.max(10, slot.font_size * displayScale),
      textAlign: slot.align
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

      {textSlots.map((slot) => (
        <OverlayTextEdit
          key={slot.id}
          value={overlayTexts[slot.id] ?? ""}
          onChange={(next) => onEditOverlayText(slot.id, next)}
          style={toDisplayStyle(slot)}
          maxLength={120}
          placeholder={slot.label}
        />
      ))}

      {isRecomposing ? (
        <div className="instagram-image-preview-loading">
          <span>Re-composing image...</span>
        </div>
      ) : null}
    </div>
  );
};
