import { useEffect, useMemo, useState } from "react";
import type { ContentEditorProps } from "./ContentEditor";
import { EditorStatusBar } from "./EditorStatusBar";
import { CaptionEditor } from "./instagram/CaptionEditor";
import { ImagePickerModal } from "./instagram/ImagePickerModal";
import { ImagePreview } from "./instagram/ImagePreview";
import { InstagramActionBar } from "./instagram/InstagramActionBar";
import { buildInstagramEditorSeed, composeCaptionBody, type InstagramEditorSlide } from "./instagram/metadata";
import { SlideNavigator } from "./instagram/SlideNavigator";
import { TemplateImageControls } from "./instagram/TemplateImageControls";
import { useInstagramPreviewRuntime } from "./instagram/useInstagramPreviewRuntime";

const resolveStatusLabel = (slotStatus: ContentEditorProps["slotStatus"]): string => {
  if (slotStatus === "pending_approval") return "Draft";
  if (slotStatus === "generating") return "Generating";
  if (slotStatus === "failed") return "Failed";
  if (slotStatus === "scheduled") return "Scheduled";
  if (slotStatus === "approved") return "Approved";
  if (slotStatus === "published") return "Published";
  return "Skipped";
};

const replaceSlideAt = (slides: InstagramEditorSlide[], slideIndex: number, nextSlide: InstagramEditorSlide): InstagramEditorSlide[] =>
  slides.map((slide, index) => (index === slideIndex ? nextSlide : slide));

/**
 * Visual editor for instagram image drafts with local compose + metadata sync.
 */
export const InstagramContentEditor = ({
  content,
  slotStatus,
  onBack,
  onRegenerateRequest,
  onAfterSave
}: ContentEditorProps) => {
  const seed = useMemo(() => buildInstagramEditorSeed(content), [content.body, content.id, content.metadata]);
  const [caption, setCaption] = useState(seed.caption);
  const [hashtags, setHashtags] = useState(seed.hashtags);
  const [savedBody, setSavedBody] = useState(composeCaptionBody(seed.caption, seed.hashtags));
  const [updatedAt, setUpdatedAt] = useState(content.updated_at ?? "");
  const [slides, setSlides] = useState(seed.slides);
  const [activityFolder, setActivityFolder] = useState(seed.activityFolder);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [localSaveStatus, setLocalSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTargetSlotIndex, setPickerTargetSlotIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const currentSlide = slides[activeSlideIndex] ?? slides[0];
  const activeTemplateId = currentSlide?.templateId ?? seed.templateId;
  const {
    templates,
    currentTemplate,
    requiredImageCount,
    maxImageCount,
    slideImageUrls,
    isRecomposing,
    pickerImages,
    isPickerLoading,
    requestRecomposeSlide,
    queueRecomposeSlide,
    loadPickerImages
  } = useInstagramPreviewRuntime({
    contentId: content.id,
    activeTemplateId,
    slides,
    activityFolder,
    expectedUpdatedAt: updatedAt,
    onMetadataUpdatedAt: setUpdatedAt,
    onNotice: setNotice
  });

  const fullBody = composeCaptionBody(caption, hashtags);
  const isDirty = fullBody !== savedBody;
  const currentImageNames = currentSlide?.imageNames ?? [];
  const selectedImageCount = currentSlide?.imageFileIds.length ?? 0;
  const templateOptions = templates.length > 0 ? templates : [currentTemplate];

  useEffect(() => {
    setCaption(seed.caption);
    setHashtags(seed.hashtags);
    setSavedBody(composeCaptionBody(seed.caption, seed.hashtags));
    setUpdatedAt(content.updated_at ?? "");
    setSlides(seed.slides);
    setActivityFolder(seed.activityFolder);
    setActiveSlideIndex(0);
    setLocalSaveStatus("idle");
    setNotice("");
  }, [content.id, content.updated_at, seed]);

  useEffect(() => {
    setActiveSlideIndex((prev) => Math.min(prev, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const openImagePicker = async (slotIndex?: number) => {
    setPickerTargetSlotIndex(typeof slotIndex === "number" ? slotIndex : null);
    setIsPickerOpen(true);
    await loadPickerImages();
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice("");
    setLocalSaveStatus("idle");
    try {
      const bodyResult = await window.desktopRuntime.content.saveBody({
        contentId: content.id,
        body: fullBody,
        expectedUpdatedAt: updatedAt || undefined
      });
      if (!bodyResult.ok) {
        setNotice(bodyResult.message || "Failed to save caption.");
        return;
      }

      setSavedBody(bodyResult.content.body);
      setUpdatedAt(bodyResult.content.updated_at);

      const localResult = await window.desktopRuntime.content.saveLocal({
        relativePath: seed.localSaveSuggestion.relativePath,
        fileName: seed.localSaveSuggestion.fileName,
        body: bodyResult.content.body,
        encoding: "utf8"
      });
      setLocalSaveStatus(localResult.ok ? "saved" : "error");
      if (!localResult.ok && localResult.message) {
        setNotice(localResult.message);
      }

      onAfterSave?.(content.id);
    } finally {
      setIsSaving(false);
    }
  };

  const updateActiveSlide = (updater: (slide: InstagramEditorSlide) => InstagramEditorSlide, composeMode: "queue" | "request") => {
    if (!currentSlide) {
      return;
    }
    const nextSlide = updater(currentSlide);
    const nextSlides = replaceSlideAt(slides, activeSlideIndex, nextSlide);
    setSlides(nextSlides);
    if (composeMode === "queue") {
      queueRecomposeSlide({
        slides: nextSlides,
        slideIndex: activeSlideIndex
      });
      return;
    }
    void requestRecomposeSlide({
      slides: nextSlides,
      slideIndex: activeSlideIndex
    });
  };

  return (
    <section className="ui-content-editor instagram-content-editor">
      <div className="ui-content-editor-head">
        <div>
          <h2>Instagram</h2>
          <p className="sub-description">
            Status: <strong>{resolveStatusLabel(slotStatus)}</strong> | {content.campaign_id ? `Campaign ${content.campaign_id.slice(0, 8)}` : "On-demand"}
          </p>
        </div>
        <button
          className="ui-content-editor-back-button"
          type="button"
          onClick={() => {
            if (isDirty && !window.confirm("You have unsaved caption changes. Discard and leave editor?")) {
              return;
            }
            onBack();
          }}
        >
          Back to Schedule
        </button>
      </div>

      <ImagePreview
        imageUrl={slideImageUrls[activeSlideIndex] ?? ""}
        width={currentTemplate.size.width}
        height={currentTemplate.size.height}
        textSlots={currentTemplate.texts.map((slot) => ({
          id: slot.id,
          label: slot.label,
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          font_size: slot.font_size,
          align: slot.align
        }))}
        overlayTexts={currentSlide?.overlayTexts ?? {}}
        isRecomposing={isRecomposing}
        onEditOverlayText={(slotId, nextValue) => {
          updateActiveSlide(
            (slide) => ({
              ...slide,
              overlayTexts: {
                ...slide.overlayTexts,
                [slotId]: nextValue
              }
            }),
            "queue"
          );
        }}
      />

      <SlideNavigator
        slideCount={slides.length}
        activeIndex={activeSlideIndex}
        slideRoles={slides.map((slide) => slide.role)}
        onChangeIndex={setActiveSlideIndex}
      />

      <TemplateImageControls
        currentTemplateId={activeTemplateId}
        currentImageNames={currentImageNames}
        selectedImageCount={selectedImageCount}
        requiredImageCount={requiredImageCount}
        maxImageCount={maxImageCount}
        availableTemplates={templateOptions.map((template) => ({
          id: template.id,
          nameKo: template.nameKo,
          description: template.description
        }))}
        onChangeTemplate={(nextTemplateId) => {
          const nextTemplate = templateOptions.find((template) => template.id === nextTemplateId);
          const nextMaxCount = nextTemplate?.photos.length ?? maxImageCount;
          updateActiveSlide(
            (slide) => ({
              ...slide,
              templateId: nextTemplateId,
              imageFileIds: nextMaxCount > 0 ? slide.imageFileIds.slice(0, nextMaxCount) : slide.imageFileIds,
              imagePaths: nextMaxCount > 0 ? slide.imagePaths.slice(0, nextMaxCount) : slide.imagePaths,
              imageNames: nextMaxCount > 0 ? slide.imageNames.slice(0, nextMaxCount) : slide.imageNames
            }),
            "request"
          );
        }}
        onAddImage={(slotIndex) => {
          void openImagePicker(slotIndex);
        }}
        onRemoveImage={(slotIndex) => {
          updateActiveSlide(
            (slide) => ({
              ...slide,
              imageFileIds: slide.imageFileIds.filter((_, index) => index !== slotIndex),
              imagePaths: slide.imagePaths.filter((_, index) => index !== slotIndex),
              imageNames: slide.imageNames.filter((_, index) => index !== slotIndex)
            }),
            "request"
          );
        }}
      />

      <CaptionEditor caption={caption} hashtags={hashtags} onChangeCaption={setCaption} onChangeHashtags={setHashtags} />
      <EditorStatusBar charCount={fullBody.length} isDirty={isDirty} lastSavedAt={updatedAt || null} />

      <InstagramActionBar
        caption={caption}
        hashtags={hashtags}
        isDirty={isDirty}
        isSaving={isSaving}
        isRecomposing={isRecomposing}
        localSaveStatus={localSaveStatus}
        downloadLabel={slides.length > 1 ? "Download images" : "Download image"}
        onDownloadImage={() => {
          void (async () => {
            const result = await window.desktopRuntime.content.downloadImage({
              contentId: content.id,
              suggestedFileName: `instagram_${content.id}.png`,
              slideCount: slides.length
            });
            if (!result.ok && !result.cancelled) {
              setNotice(result.message || "Failed to download image.");
            }
          })();
        }}
        onSave={() => {
          void handleSave();
        }}
        onRegenerate={() => {
          if (onRegenerateRequest) {
            onRegenerateRequest(content.id);
            return;
          }
          window.dispatchEvent(new CustomEvent("ui:open-global-chat"));
        }}
      />

      {notice ? <p className="notice">{notice}</p> : null}

      {isPickerOpen ? (
        <ImagePickerModal
          images={pickerImages}
          isLoading={isPickerLoading}
          targetSlotIndex={pickerTargetSlotIndex}
          onSelect={(fileId, slotIndex) => {
            const picked = pickerImages.find((entry) => entry.fileId === fileId);
            const pickedName = picked?.fileName ?? fileId.slice(0, 8);
            const pickedPath = picked?.relativePath ?? "";
            const nextIds = [...(currentSlide?.imageFileIds ?? [])];
            const nextPaths = [...(currentSlide?.imagePaths ?? [])];
            const nextNames = [...(currentSlide?.imageNames ?? [])];
            const target = slotIndex ?? nextIds.length;
            nextIds[target] = fileId;
            nextPaths[target] = pickedPath;
            nextNames[target] = pickedName;
            const boundedIds = maxImageCount > 0 ? nextIds.slice(0, maxImageCount) : nextIds;
            const boundedPaths = maxImageCount > 0 ? nextPaths.slice(0, maxImageCount) : nextPaths;
            const boundedNames = maxImageCount > 0 ? nextNames.slice(0, maxImageCount) : nextNames;

            updateActiveSlide(
              (slide) => ({
                ...slide,
                imageFileIds: boundedIds,
                imagePaths: boundedPaths,
                imageNames: boundedNames
              }),
              "request"
            );
          }}
          onClose={() => setIsPickerOpen(false)}
        />
      ) : null}
    </section>
  );
};
