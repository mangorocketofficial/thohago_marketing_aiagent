import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { composeInstagramImage } from "../media/image-composer";
import { getTemplate } from "../media/templates/registry";
import {
  asRecord,
  asString,
  buildSignedUrlPayload,
  DEFAULT_TEMPLATE_ID,
  loadInstagramContentRow,
  normalizeOverlayText,
  normalizeTemplateId,
  resolveEffectiveImageSelection,
  resolveRequestId,
  resolveStorageRef,
  validateImageSlotCount
} from "./instagram-editor-shared";

export type RecomposeInstagramContentInput = {
  orgId: string;
  contentId: string;
  templateId?: string | null;
  overlayMain?: string | null;
  overlaySub?: string | null;
  imageFileIds?: string[] | null;
  clientRequestId?: string | null;
};

export type RecomposeInstagramContentResult = {
  requestId: string;
  signedImageUrl: string;
  expiresAt: string;
  updatedAt: string;
  requiredImageCount: number;
  providedImageCount: number;
};

export type GetInstagramContentSignedUrlInput = {
  orgId: string;
  contentId: string;
};

export type GetInstagramContentSignedUrlResult = {
  signedImageUrl: string;
  expiresAt: string;
  updatedAt: string;
};

/**
 * Re-compose existing instagram image by applying latest overlay/template/image selections.
 */
export const recomposeInstagramContent = async (
  input: RecomposeInstagramContentInput
): Promise<RecomposeInstagramContentResult> => {
  const content = await loadInstagramContentRow({
    orgId: input.orgId,
    contentId: input.contentId
  });
  const requestId = resolveRequestId(input.clientRequestId);
  const fallbackTemplateId = normalizeTemplateId(content.metadata.template_id, DEFAULT_TEMPLATE_ID);
  const templateId = normalizeTemplateId(input.templateId, fallbackTemplateId);
  const template = getTemplate(templateId);
  if (!template) {
    throw new HttpError(400, "invalid_payload", `Unsupported templateId: ${templateId}`);
  }

  const selection = await resolveEffectiveImageSelection({
    orgId: input.orgId,
    requestImageFileIds: input.imageFileIds,
    metadata: content.metadata
  });
  const requiredImageCount = template.layers.userImageAreas?.length ?? 0;
  validateImageSlotCount({
    requiredImageCount,
    providedImageCount: selection.paths.length
  });

  const overlayMain = normalizeOverlayText(input.overlayMain, asString(content.metadata.overlay_main, ""), 15);
  const overlaySub = normalizeOverlayText(input.overlaySub, asString(content.metadata.overlay_sub, ""), 25);
  const composed = await composeInstagramImage({
    templateId,
    userImages: selection.paths,
    overlayMainText: overlayMain,
    overlaySubText: overlaySub,
    outputFormat: "png"
  });

  const storage = resolveStorageRef({
    orgId: input.orgId,
    contentId: input.contentId,
    metadata: content.metadata
  });
  const uploaded = await supabaseAdmin.storage.from(storage.bucket).upload(storage.path, composed.buffer, {
    upsert: true,
    contentType: "image/png"
  });
  if (uploaded.error) {
    throw new HttpError(500, "storage_upload_failed", `Failed to upload recomposed image: ${uploaded.error.message}`);
  }

  const nextMetadata: Record<string, unknown> = {
    ...content.metadata,
    template_id: templateId,
    overlay_main: overlayMain,
    overlay_sub: overlaySub,
    image_paths: selection.paths,
    image_file_ids: selection.fileIds,
    composed_image_size: composed.sizeBytes,
    composed_image_storage: {
      bucket: storage.bucket,
      path: storage.path,
      content_type: "image/png"
    },
    last_recompose_request_id: requestId
  };

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("contents")
    .update({
      metadata: nextMetadata,
      updated_at: updatedAt
    })
    .eq("org_id", input.orgId)
    .eq("id", input.contentId)
    .select("updated_at")
    .maybeSingle();

  if (error || !data) {
    throw new HttpError(500, "db_error", `Failed to persist recomposed metadata: ${error?.message ?? "unknown"}`);
  }

  const signed = await buildSignedUrlPayload({
    bucket: storage.bucket,
    path: storage.path
  });

  return {
    requestId,
    signedImageUrl: signed.signedImageUrl,
    expiresAt: signed.expiresAt,
    updatedAt: asString(asRecord(data).updated_at, updatedAt),
    requiredImageCount,
    providedImageCount: selection.paths.length
  };
};

/**
 * Create a fresh signed URL for an existing composed instagram image.
 */
export const getInstagramContentSignedUrl = async (
  input: GetInstagramContentSignedUrlInput
): Promise<GetInstagramContentSignedUrlResult> => {
  const content = await loadInstagramContentRow({
    orgId: input.orgId,
    contentId: input.contentId
  });
  const storage = resolveStorageRef({
    orgId: input.orgId,
    contentId: input.contentId,
    metadata: content.metadata
  });
  const signed = await buildSignedUrlPayload({
    bucket: storage.bucket,
    path: storage.path
  });

  return {
    signedImageUrl: signed.signedImageUrl,
    expiresAt: signed.expiresAt,
    updatedAt: content.updatedAt
  };
};
