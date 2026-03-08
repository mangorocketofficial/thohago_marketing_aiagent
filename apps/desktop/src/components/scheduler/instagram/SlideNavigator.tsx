type SlideNavigatorProps = {
  slideCount: number;
  activeIndex: number;
  slideRoles: string[];
  onChangeIndex: (index: number) => void;
};

const toRoleLabel = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return "Slide";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

/**
 * Inline slide navigation for carousel editing.
 */
export const SlideNavigator = ({ slideCount, activeIndex, slideRoles, onChangeIndex }: SlideNavigatorProps) => {
  if (slideCount <= 1) {
    return null;
  }

  return (
    <div className="instagram-slide-navigator" aria-label="Carousel slide navigation">
      <button type="button" onClick={() => onChangeIndex(Math.max(0, activeIndex - 1))} disabled={activeIndex <= 0}>
        Prev
      </button>
      <div className="instagram-slide-navigator-center">
        <span className="instagram-slide-navigator-label">
          Slide {activeIndex + 1} / {slideCount} - {toRoleLabel(slideRoles[activeIndex] ?? "custom")}
        </span>
        <div className="instagram-slide-navigator-dots">
          {Array.from({ length: slideCount }, (_, index) => (
            <button
              key={index}
              type="button"
              className={index === activeIndex ? "active" : ""}
              aria-label={`Go to slide ${index + 1}`}
              onClick={() => onChangeIndex(index)}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChangeIndex(Math.min(slideCount - 1, activeIndex + 1))}
        disabled={activeIndex >= slideCount - 1}
      >
        Next
      </button>
    </div>
  );
};
