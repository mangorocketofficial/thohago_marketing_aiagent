type TemplateSummary = {
  id: string;
  nameKo: string;
  description: string;
};

type TemplateImageControlsProps = {
  currentTemplateId: string;
  currentImageNames: string[];
  selectedImageCount: number;
  requiredImageCount: number;
  maxImageCount: number;
  availableTemplates: TemplateSummary[];
  onChangeTemplate: (templateId: string) => void;
  onAddImage: (slotIndex?: number) => void;
  onRemoveImage: (slotIndex: number) => void;
};

/**
 * Template switcher and image-slot management controls.
 */
export const TemplateImageControls = ({
  currentTemplateId,
  currentImageNames,
  selectedImageCount,
  requiredImageCount,
  maxImageCount,
  availableTemplates,
  onChangeTemplate,
  onAddImage,
  onRemoveImage
}: TemplateImageControlsProps) => {
  return (
    <div className="instagram-template-image-controls">
      <div className="instagram-control-group">
        <label htmlFor="instagram-template-select">Slide Template</label>
        <select
          id="instagram-template-select"
          value={currentTemplateId}
          onChange={(event) => onChangeTemplate(event.target.value)}
        >
          {availableTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.nameKo}
            </option>
          ))}
        </select>
      </div>

      <div className="instagram-control-group">
        <label>
          Images{" "}
          {maxImageCount > 0 ? (
            <span className="instagram-slot-count">
              ({selectedImageCount}/{maxImageCount}
              {maxImageCount !== requiredImageCount ? `, required ${requiredImageCount}` : ""})
            </span>
          ) : null}
        </label>
        <div className="instagram-image-slot-list">
          {currentImageNames.map((name, index) => (
            <span key={`${name}-${index}`} className="instagram-image-tag">
              {name}
              <button
                type="button"
                className="instagram-image-tag-remove"
                onClick={() => onRemoveImage(index)}
                aria-label={`Remove ${name}`}
              >
                x
              </button>
            </span>
          ))}

          {selectedImageCount < maxImageCount ? (
            <button
              type="button"
              className="instagram-image-add-btn"
              onClick={() => onAddImage(selectedImageCount)}
            >
              + Add
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
