import { useEffect, useMemo, useState } from "react";
import type { ContentEditorProps } from "./ContentEditor";
import { EditorStatusBar } from "./EditorStatusBar";
import { CaptionEditor } from "./instagram/CaptionEditor";
import { ImagePickerModal } from "./instagram/ImagePickerModal";
import { ImagePreview } from "./instagram/ImagePreview";
import { InstagramActionBar } from "./instagram/InstagramActionBar";
import { buildInstagramEditorSeed, composeCaptionBody } from "./instagram/metadata";
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
  const [templateId, setTemplateId] = useState(seed.templateId);
  const [overlayTexts, setOverlayTexts] = useState<Record<string, string>>(seed.overlayTexts);
  const [imageFileIds, setImageFileIds] = useState<string[] | null>(seed.imageFileIds.length > 0 ? seed.imageFileIds : null);
  const [imagePaths, setImagePaths] = useState<string[] | null>(seed.imagePaths.length > 0 ? seed.imagePaths : null);
  const [imageNames, setImageNames] = useState(seed.imageNames);
  const [activityFolder, setActivityFolder] = useState(seed.activityFolder);
  const [isSaving, setIsSaving] = useState(false);
  const [localSaveStatus, setLocalSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTargetSlotIndex, setPickerTargetSlotIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const {
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
  } = useInstagramPreviewRuntime({
    contentId: content.id,
    templateId,
    overlayTexts,
    imageFileIds,
    imagePaths,
    activityFolder,
    expectedUpdatedAt: updatedAt,
    onMetadataUpdatedAt: setUpdatedAt,
    onNotice: setNotice
  });

  const fullBody = composeCaptionBody(caption, hashtags);
  const isDirty = fullBody !== savedBody;
  const selectedImageCount = imageFileIds ? imageFileIds.length : imageNames.length;
  const templateOptions = templates.length > 0 ? templates : [currentTemplate];

  useEffect(() => {
    setCaption(seed.caption);
    setHashtags(seed.hashtags);
    setSavedBody(composeCaptionBody(seed.caption, seed.hashtags));
    setUpdatedAt(content.updated_at ?? "");
    setTemplateId(seed.templateId);
    setOverlayTexts(seed.overlayTexts);
    setImageFileIds(seed.imageFileIds.length > 0 ? seed.imageFileIds : null);
    setImagePaths(seed.imagePaths.length > 0 ? seed.imagePaths : null);
    setImageNames(seed.imageNames);
    setActivityFolder(seed.activityFolder);
    setLocalSaveStatus("idle");
    setNotice("");
  }, [content.id, content.updated_at, seed]);

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
        imageUrl={imageUrl}
        width={currentTemplate.size.width}
        height={currentTemplate.size.height}
        textSlots={currentTemplate.overlays.texts.map((slot) => ({
          id: slot.id,
          label: slot.label,
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          font_size: slot.font_size,
          align: slot.align
        }))}
        overlayTexts={overlayTexts}
        isRecomposing={isRecomposing}
        onEditOverlayText={(slotId, nextValue) => {
          setOverlayTexts((prev) => {
            const next = {
              ...prev,
              [slotId]: nextValue
            };
            queueRecompose({ overlayTexts: next });
            return next;
          });
        }}
      />

      <TemplateImageControls
        currentTemplateId={templateId}
        currentImageNames={imageNames}
        selectedImageCount={selectedImageCount}
        requiredImageCount={requiredImageCount}
        availableTemplates={templateOptions.map((template) => ({
          id: template.id,
          nameKo: template.nameKo,
          description: template.description
        }))}
        onChangeTemplate={(nextTemplateId) => {
          setTemplateId(nextTemplateId);
          void requestRecompose({ templateId: nextTemplateId });
        }}
        onAddImage={(slotIndex) => {
          void openImagePicker(slotIndex);
        }}
        onRemoveImage={(slotIndex) => {
          const nextIds = [...(imageFileIds ?? [])].filter((_, index) => index !== slotIndex);
          const nextPaths = [...(imagePaths ?? [])].filter((_, index) => index !== slotIndex);
          const nextNames = imageNames.filter((_, index) => index !== slotIndex);
          setImageFileIds(nextIds);
          setImagePaths(nextPaths);
          setImageNames(nextNames);
          void requestRecompose({ imageFileIds: nextIds, imagePaths: nextPaths });
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
        onDownloadImage={() => {
          void (async () => {
            const result = await window.desktopRuntime.content.downloadImage({
              contentId: content.id,
              suggestedFileName: `instagram_${content.id}.png`
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
            const nextIds = [...(imageFileIds ?? [])];
            const nextPaths = [...(imagePaths ?? [])];
            const nextNames = [...imageNames];
            const target = slotIndex ?? nextIds.length;
            nextIds[target] = fileId;
            nextPaths[target] = pickedPath;
            nextNames[target] = pickedName;
            const boundedIds = requiredImageCount > 0 ? nextIds.slice(0, requiredImageCount) : nextIds;
            const boundedPaths = requiredImageCount > 0 ? nextPaths.slice(0, requiredImageCount) : nextPaths;
            const boundedNames = requiredImageCount > 0 ? nextNames.slice(0, requiredImageCount) : nextNames;
            setImageFileIds(boundedIds);
            setImagePaths(boundedPaths);
            setImageNames(boundedNames);
            void requestRecompose({ imageFileIds: boundedIds, imagePaths: boundedPaths });
          }}
          onClose={() => setIsPickerOpen(false)}
        />
      ) : null}
    </section>
  );
};
