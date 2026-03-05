import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityImageThumbnail } from "./ImagePickerModal";
import type { TemplateTextPosition } from "./ImagePreview";

type TemplateDefinition = {
  id: string;
  nameKo: string;
  description: string;
  width: number;
  height: number;
  layers: {
    mainText: TemplateTextPosition;
    subText?: TemplateTextPosition;
    userImageAreas?: Array<{ x: number; y: number; w: number; h: number }>;
  };
};

const SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const RECOMPOSE_DEBOUNCE_MS = 800;

export const DEFAULT_TEMPLATE: TemplateDefinition = {
  id: "center-image-bottom-text",
  nameKo: "Default",
  description: "",
  width: 1080,
  height: 1080,
  layers: {
    mainText: { x: 60, y: 790, maxWidth: 960, fontSize: 52, align: "center" },
    subText: { x: 60, y: 870, maxWidth: 960, fontSize: 42, align: "center" },
    userImageAreas: [{ x: 140, y: 120, w: 800, h: 620 }]
  }
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
  overlayMain: string;
  overlaySub: string;
  imageFileIds: string[] | null;
  activityFolder: string;
  onNotice: (message: string) => void;
};

type RecomposePatch = Partial<{
  templateId: string;
  overlayMain: string;
  overlaySub: string;
  imageFileIds: string[] | null;
}>;

/**
 * Owns signed-url lifecycle, template loading, image picker thumbnails, and re-compose execution.
 */
export const useInstagramPreviewRuntime = ({
  contentId,
  templateId,
  overlayMain,
  overlaySub,
  imageFileIds,
  activityFolder,
  onNotice
}: UseInstagramPreviewRuntimeParams) => {
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [signedUrlExpiresAt, setSignedUrlExpiresAt] = useState("");
  const [isRecomposing, setIsRecomposing] = useState(false);
  const [pickerImages, setPickerImages] = useState<ActivityImageThumbnail[]>([]);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

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

  const refreshSignedUrl = useCallback(async () => {
    const result = await window.desktopRuntime.content.getSignedUrl({ contentId });
    if (!result.ok) {
      onNotice(result.message || "Failed to load preview image.");
      return;
    }
    setImageUrl(result.signedImageUrl);
    setSignedUrlExpiresAt(result.expiresAt);
  }, [contentId, onNotice]);

  useEffect(() => {
    void loadTemplates();
    void refreshSignedUrl();
  }, [loadTemplates, refreshSignedUrl]);

  useEffect(() => {
    if (!signedUrlExpiresAt) {
      return;
    }
    const refreshInMs = new Date(signedUrlExpiresAt).getTime() - Date.now() - SIGNED_URL_REFRESH_BUFFER_MS;
    if (refreshInMs <= 0) {
      void refreshSignedUrl();
      return;
    }
    const timer = window.setTimeout(() => void refreshSignedUrl(), refreshInMs);
    return () => window.clearTimeout(timer);
  }, [refreshSignedUrl, signedUrlExpiresAt]);

  const currentTemplate = useMemo(() => templates.find((template) => template.id === templateId) ?? DEFAULT_TEMPLATE, [templateId, templates]);
  const requiredImageCount = currentTemplate.layers.userImageAreas?.length ?? 0;

  const requestRecompose = useCallback(
    async (patch?: RecomposePatch) => {
      const nextTemplateId = patch?.templateId ?? templateId;
      const nextOverlayMain = patch?.overlayMain ?? overlayMain;
      const nextOverlaySub = patch?.overlaySub ?? overlaySub;
      const nextImageFileIds =
        patch && Object.prototype.hasOwnProperty.call(patch, "imageFileIds") ? patch.imageFileIds : imageFileIds;

      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      setIsRecomposing(true);

      const result = await window.desktopRuntime.content.recompose({
        contentId,
        templateId: nextTemplateId,
        overlayMain: nextOverlayMain,
        overlaySub: nextOverlaySub,
        ...(Array.isArray(nextImageFileIds) ? { imageFileIds: nextImageFileIds } : {}),
        clientRequestId: `${contentId}:${seq}`
      });

      if (seq !== requestSeqRef.current) {
        return;
      }
      setIsRecomposing(false);

      if (!result.ok) {
        onNotice(result.message || "Failed to re-compose image.");
        return;
      }

      setImageUrl(result.signedImageUrl);
      setSignedUrlExpiresAt(result.expiresAt);
      onNotice("");
    },
    [contentId, imageFileIds, onNotice, overlayMain, overlaySub, templateId]
  );

  const queueRecompose = useCallback(
    (patch?: RecomposePatch) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        void requestRecompose(patch);
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
    imageUrl,
    isRecomposing,
    pickerImages,
    isPickerLoading,
    requestRecompose,
    queueRecompose,
    loadPickerImages
  };
};
