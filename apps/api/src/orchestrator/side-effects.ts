import { onContentEdited } from "../rag/ingest-edit-pattern";
import { onContentPublished } from "../rag/ingest-content";
import { invalidateMemoryCache } from "../rag/memory-service";

export type ContentApprovalSideEffectsInput = {
  orgId: string;
  contentId: string;
  previousDraft: string | null;
  editedBody: string;
  editPatternChannel: string;
};

export const runContentApprovalSideEffects = (params: ContentApprovalSideEffectsInput): void => {
  void onContentPublished(params.orgId, params.contentId).catch((error) => {
    console.warn(
      `[CONTENT_EMBED] Background embed failed. org=${params.orgId}, content=${params.contentId}, reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  const shouldCaptureEditPattern =
    !!params.editedBody && !!params.previousDraft?.trim() && params.editedBody !== params.previousDraft.trim();

  if (shouldCaptureEditPattern) {
    void onContentEdited(params.orgId, params.previousDraft as string, params.editedBody, params.editPatternChannel).catch(
      (error) => {
        console.warn(
          `[EDIT_PATTERN] Background extraction failed. org=${params.orgId}, content=${params.contentId}, reason=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    );
  }

  void invalidateMemoryCache(params.orgId).catch((error) => {
    console.warn(
      `[MEMORY] Cache invalidation failed. org=${params.orgId}, reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
};
