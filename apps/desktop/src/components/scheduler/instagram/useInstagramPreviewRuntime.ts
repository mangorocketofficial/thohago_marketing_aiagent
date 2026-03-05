import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityImageThumbnail } from "./ImagePickerModal";

type TemplatePhotoSlot = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fit: "cover" | "contain";
  optional?: boolean;
};

type TemplateTextSlot = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  font_color: string;
  font_weight?: "normal" | "bold";
  align: "left" | "center" | "right";
};

type TemplateDefinition = {
  id: string;
  nameKo: string;
  description: string;
  thumbnail: string;
  size: {
    width: number;
    height: number;
  };
  photos: TemplatePhotoSlot[];
  texts: TemplateTextSlot[];
  meta?: Record<string, unknown> | null;
};

const RECOMPOSE_DEBOUNCE_MS = 800;

export const DEFAULT_TEMPLATE: TemplateDefinition = {
  id: "koica_cover_01",
  nameKo: "KOICA Cover Card",
  description: "",
  thumbnail: "thumbnails/koica_cover_01.png",
  size: {
    width: 1080,
    height: 1080
  },
  photos: [
    {
      id: "main_photo",
      label: "Main photo",
      x: 100,
      y: 130,
      width: 850,
      height: 530,
      fit: "cover"
    }
  ],
  texts: [
    {
      id: "title",
      label: "Title",
      x: 60,
      y: 760,
      width: 960,
      height: 100,
      font_size: 52,
      font_color: "#222222",
      font_weight: "bold",
      align: "center"
    }
  ],
  meta: null
};

const asTemplateDefinitionArray = (value: unknown): TemplateDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (entry && typeof entry === "object" ? (entry as TemplateDefinition) : null))
    .filter((entry): entry is TemplateDefinition => !!entry && typeof entry.id === "string" && !!entry.id.trim());
};

type UseInstagramPreviewRuntimeParams = {
  contentId: string;
  templateId: string;
  overlayTexts: Record<string, string>;
  imageFileIds: string[] | null;
  imagePaths: string[] | null;
  activityFolder: string;
  expectedUpdatedAt: string;
  onMetadataUpdatedAt: (nextUpdatedAt: string) => void;
  onNotice: (message: string) => void;
};

type RecomposePatch = Partial<{
  templateId: string;
  overlayTexts: Record<string, string>;
  imageFileIds: string[] | null;
  imagePaths: string[] | null;
}>;

type RecomposeOptions = {
  persistMetadata?: boolean;
};

/**
 * Owns template loading, local compose execution, image picker thumbnails, and metadata persistence.
 */
export const useInstagramPreviewRuntime = ({
  contentId,
  templateId,
  overlayTexts,
  imageFileIds,
  imagePaths,
  activityFolder,
  expectedUpdatedAt,
  onMetadataUpdatedAt,
  onNotice
}: UseInstagramPreviewRuntimeParams) => {
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [isRecomposing, setIsRecomposing] = useState(false);
  const [pickerImages, setPickerImages] = useState<ActivityImageThumbnail[]>([]);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const metadataUpdatedAtRef = useRef(expectedUpdatedAt);

  useEffect(() => {
    metadataUpdatedAtRef.current = expectedUpdatedAt;
  }, [expectedUpdatedAt]);

  const loadTemplates = useCallback(async () => {
    const result = await window.desktopRuntime.content.listInstagramTemplates();
    if (!result.ok) {
      onNotice(result.message || "Failed to load instagram templates.");
      return;
    }
    const rows = asTemplateDefinitionArray(result.templates);
    if (rows.length > 0) {
      setTemplates(rows);
    }
  }, [onNotice]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const currentTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? DEFAULT_TEMPLATE,
    [templateId, templates]
  );
  const requiredImageCount = currentTemplate.photos.filter((slot) => !slot.optional).length;
  const maxImageCount = currentTemplate.photos.length;

  const requestRecompose = useCallback(
    async (patch?: RecomposePatch, options?: RecomposeOptions) => {
      const nextTemplateId = patch?.templateId ?? templateId;
      const nextOverlayTexts =
        patch && Object.prototype.hasOwnProperty.call(patch, "overlayTexts")
          ? patch.overlayTexts ?? {}
          : overlayTexts;
      const nextImageFileIds =
        patch && Object.prototype.hasOwnProperty.call(patch, "imageFileIds") ? patch.imageFileIds : imageFileIds;
      const nextImagePaths =
        patch && Object.prototype.hasOwnProperty.call(patch, "imagePaths") ? patch.imagePaths : imagePaths;

      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      setIsRecomposing(true);

      const composeResult = await window.desktopRuntime.content.composeLocal({
        contentId,
        templateId: nextTemplateId,
        overlayTexts: nextOverlayTexts,
        ...(Array.isArray(nextImagePaths) ? { imagePaths: nextImagePaths } : {}),
        ...(Array.isArray(nextImageFileIds) ? { imageFileIds: nextImageFileIds } : {}),
        clientRequestId: `${contentId}:${seq}`
      });

      if (seq !== requestSeqRef.current) {
        return;
      }

      if (!composeResult.ok) {
        setIsRecomposing(false);
        onNotice(composeResult.message || "Failed to compose image.");
        return;
      }

      setImageUrl(composeResult.thumbnailDataUrl);

      if (options?.persistMetadata !== false) {
        const saveResult = await window.desktopRuntime.content.saveInstagramMetadata({
          contentId,
          templateId: nextTemplateId,
          overlayTexts: nextOverlayTexts,
          ...(Array.isArray(nextImageFileIds) ? { imageFileIds: nextImageFileIds } : {}),
          ...(metadataUpdatedAtRef.current ? { expectedUpdatedAt: metadataUpdatedAtRef.current } : {})
        });

        if (seq !== requestSeqRef.current) {
          return;
        }

        if (!saveResult.ok) {
          setIsRecomposing(false);
          onNotice(saveResult.message || "Failed to save instagram metadata.");
          return;
        }

        if (saveResult.updatedAt) {
          metadataUpdatedAtRef.current = saveResult.updatedAt;
          onMetadataUpdatedAt(saveResult.updatedAt);
        }
      }

      setIsRecomposing(false);
      onNotice("");
    },
    [contentId, imageFileIds, imagePaths, onMetadataUpdatedAt, onNotice, overlayTexts, templateId]
  );

  const queueRecompose = useCallback(
    (patch?: RecomposePatch, options?: RecomposeOptions) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        void requestRecompose(patch, options);
      }, RECOMPOSE_DEBOUNCE_MS);
    },
    [requestRecompose]
  );

  useEffect(
    () => () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [contentId]);

  useEffect(() => {
    void requestRecompose(undefined, { persistMetadata: false });
    // Intentionally only on content switch; edit-triggered recompose is user-action driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  const loadPickerImages = useCallback(async () => {
    setIsPickerLoading(true);
    const result = await window.desktopRuntime.content.loadActivityThumbnails({
      ...(activityFolder ? { activityFolder } : {}),
      limit: 90
    });
    setIsPickerLoading(false);

    if (!result.ok) {
      onNotice(result.message || "Failed to load image thumbnails.");
      return;
    }
    setPickerImages(result.images);
  }, [activityFolder, onNotice]);

  return {
    templates,
    currentTemplate,
    requiredImageCount,
    maxImageCount,
    imageUrl,
    isRecomposing,
    pickerImages,
    isPickerLoading,
    requestRecompose,
    queueRecompose,
    loadPickerImages
  };
};
