import type { Content } from "@repo/types";
import type { WorkflowLinkHint } from "../../context/ChatContext";
import type { SlotStatus } from "./status-model";
import { BlogContentEditor } from "./BlogContentEditor";
import { GenericContentEditor } from "./GenericContentEditor";

export type ContentEditorProps = {
  content: Content;
  workflowHint: WorkflowLinkHint | null;
  slotStatus: SlotStatus;
  selectedSessionId: string | null;
  isActionPending: boolean;
  onBack: () => void;
  onSubmitAction: (params: {
    sessionId: string;
    workflowItemId: string;
    expectedVersion: number;
    actionId: "approve" | "request_revision" | "reject";
    eventType: "content_approved" | "content_rejected";
    contentId: string;
    reason?: string;
    mode?: "revision";
    editedBody?: string;
  }) => Promise<void>;
  onRegenerateRequest?: (contentId: string) => void;
  onAfterSave?: (contentId: string) => void;
};

/**
 * Resolve editor implementation by channel while keeping a single scheduler entry point.
 */
export const ContentEditor = (props: ContentEditorProps) => {
  if (props.content.channel === "naver_blog") {
    return <BlogContentEditor {...props} />;
  }

  return <GenericContentEditor {...props} />;
};
