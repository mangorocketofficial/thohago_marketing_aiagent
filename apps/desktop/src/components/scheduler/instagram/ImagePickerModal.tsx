export type ActivityImageThumbnail = {
  fileId: string;
  fileName: string;
  relativePath: string;
  thumbnailDataUrl: string;
};

type ImagePickerModalProps = {
  images: ActivityImageThumbnail[];
  isLoading: boolean;
  targetSlotIndex: number | null;
  onSelect: (fileId: string, slotIndex: number | null) => void;
  onClose: () => void;
};

/**
 * Modal for selecting activity images to fill template image slots.
 */
export const ImagePickerModal = ({ images, isLoading, targetSlotIndex, onSelect, onClose }: ImagePickerModalProps) => {
  return (
    <div className="instagram-modal-overlay" onClick={onClose}>
      <div className="instagram-image-picker-modal" onClick={(event) => event.stopPropagation()}>
        <h3>
          Select image
          {targetSlotIndex !== null ? <span className="instagram-slot-label"> (slot {targetSlotIndex + 1})</span> : null}
        </h3>

        {isLoading ? (
          <div className="instagram-image-picker-loading">Loading images...</div>
        ) : images.length === 0 ? (
          <div className="instagram-image-picker-empty">No images found in the activity folder.</div>
        ) : (
          <div className="instagram-image-grid">
            {images.map((image) => (
              <button
                key={image.fileId}
                type="button"
                className="instagram-image-grid-item"
                onClick={() => {
                  onSelect(image.fileId, targetSlotIndex);
                  onClose();
                }}
              >
                <img src={image.thumbnailDataUrl} alt={image.fileName} />
                <span>{image.fileName}</span>
              </button>
            ))}
          </div>
        )}

        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};
