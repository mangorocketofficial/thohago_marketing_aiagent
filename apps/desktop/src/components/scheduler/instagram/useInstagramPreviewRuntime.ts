import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityImageThumbnail } from "./ImagePickerModal";
import type { InstagramEditorSlide } from "./metadata";

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
  activeTemplateId: string;
  slides: InstagramEditorSlide[];
  activityFolder: string;
  expectedUpdatedAt: string;
  onMetadataUpdatedAt: (nextUpdatedAt: string) => void;
  onNotice: (message: string) => void;
};

type RecomposeSlideInput = {
  slides: InstagramEditorSlide[];
  slideIndex: number;
  persistMetadata?: boolean;
};

type RecomposeAllInput = {
  slides: InstagramEditorSlide[];
  persistMetadata?: boolean;
};

const toMetadataSlidesPayload = (slides: InstagramEditorSlide[]) =>
  slides.map((slide, index) => ({
    slideIndex: index,
    templateId: slide.templateId,
    role: slide.role,
    overlayTexts: slide.overlayTexts,
    imageFileIds: slide.imageFileIds,
    imagePaths: slide.imagePaths
  }));

const toComposeSlidesPayload = (slides: InstagramEditorSlide[]) =>
  slides.map((slide, index) => ({
    slideIndex: index,
    templateId: slide.templateId,
    overlayTexts: slide.overlayTexts,
    imagePaths: slide.imagePaths,
    imageFileIds: slide.imageFileIds
  }));

/**
 * Owns template loading, local compose execution, image picker thumbnails, and metadata persistence.
 */
export const useInstagramPreviewRuntime = ({
  contentId,
  activeTemplateId,
  slides,
  activityFolder,
  expectedUpdatedAt,
  onMetadataUpdatedAt,
  onNotice
}: UseInstagramPreviewRuntimeParams) => {
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [slideImageUrls, setSlideImageUrls] = useState<string[]>([]);
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
    () => templates.find((template) => template.id === activeTemplateId) ?? DEFAULT_TEMPLATE,
    [activeTemplateId, templates]
  );
  const requiredImageCount = currentTemplate.photos.filter((slot) => !slot.optional).length;
  const maxImageCount = currentTemplate.photos.length;

  const persistMetadata = useCallback(
    async (nextSlides: InstagramEditorSlide[]) => {
      const nextTemplateId = nextSlides[0]?.templateId ?? activeTemplateId;
      const saveResult = await window.desktopRuntime.content.saveInstagramMetadata({
        contentId,
        templateId: nextTemplateId,
        slides: toMetadataSlidesPayload(nextSlides),
        expectedUpdatedAt: metadataUpdatedAtRef.current || undefined
      });

      if (!saveResult.ok) {
        onNotice(saveResult.message || "Failed to save instagram metadata.");
        return false;
      }

      if (saveResult.updatedAt) {
        metadataUpdatedAtRef.current = saveResult.updatedAt;
        onMetadataUpdatedAt(saveResult.updatedAt);
      }
      return true;
    },
    [activeTemplateId, contentId, onMetadataUpdatedAt, onNotice]
  );

  const requestRecomposeSlide = useCallback(
    async ({ slides: nextSlides, slideIndex, persistMetadata: shouldPersist = true }: RecomposeSlideInput) => {
      const targetSlide = nextSlides[slideIndex];
      if (!targetSlide) {
        return;
      }

      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      setIsRecomposing(true);

      const composeResult = await window.desktopRuntime.content.composeLocal({
        contentId,
        slideIndex,
        templateId: targetSlide.templateId,
        overlayTexts: targetSlide.overlayTexts,
        ...(targetSlide.imagePaths.length > 0 ? { imagePaths: targetSlide.imagePaths } : {}),
        ...(targetSlide.imageFileIds.length > 0 ? { imageFileIds: targetSlide.imageFileIds } : {}),
        clientRequestId: `${contentId}:slide:${slideIndex}:${seq}`
      });

      if (seq !== requestSeqRef.current) {
        return;
      }

      if (!composeResult.ok) {
        setIsRecomposing(false);
        onNotice(composeResult.message || "Failed to compose image.");
        return;
      }

      setSlideImageUrls((prev) => {
        const next = nextSlides.map((_, index) => prev[index] ?? "");
        next[slideIndex] = composeResult.thumbnailDataUrl;
        return next;
      });

      if (shouldPersist) {
        const saved = await persistMetadata(nextSlides);
        if (!saved) {
          setIsRecomposing(false);
          return;
        }
      }

      setIsRecomposing(false);
      onNotice("");
    },
    [contentId, onNotice, persistMetadata]
  );

  const requestRecomposeAll = useCallback(
    async ({ slides: nextSlides, persistMetadata: shouldPersist = true }: RecomposeAllInput) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      setIsRecomposing(true);
      const nextTemplateId = nextSlides[0]?.templateId ?? activeTemplateId;

      const composeResult = await window.desktopRuntime.content.composeCarousel({
        contentId,
        templateId: nextTemplateId,
        slides: toComposeSlidesPayload(nextSlides),
        clientRequestId: `${contentId}:carousel:${seq}`
      });

      if (seq !== requestSeqRef.current) {
        return;
      }

      if (!composeResult.ok) {
        setIsRecomposing(false);
        onNotice(composeResult.message || "Failed to compose carousel.");
        return;
      }

      const nextImageUrls = nextSlides.map(() => "");
      for (const slide of composeResult.slides) {
        nextImageUrls[slide.slideIndex] = slide.thumbnailDataUrl;
      }
      setSlideImageUrls(nextImageUrls);

      if (shouldPersist) {
        const saved = await persistMetadata(nextSlides);
        if (!saved) {
          setIsRecomposing(false);
          return;
        }
      }

      setIsRecomposing(false);
      onNotice("");
    },
    [activeTemplateId, contentId, onNotice, persistMetadata]
  );

  const queueRecomposeSlide = useCallback(
    (input: RecomposeSlideInput) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        void requestRecomposeSlide(input);
      }, RECOMPOSE_DEBOUNCE_MS);
    },
    [requestRecomposeSlide]
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
    setSlideImageUrls([]);
  }, [contentId]);

  useEffect(() => {
    void requestRecomposeAll({
      slides,
      persistMetadata: false
    });
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
    slideImageUrls,
    isRecomposing,
    pickerImages,
    isPickerLoading,
    requestRecomposeSlide,
    requestRecomposeAll,
    queueRecomposeSlide,
    loadPickerImages
  };
};
