import type { Content, WorkflowStatus } from "@repo/types";

export type SlotStatus =
  | "scheduled"
  | "generating"
  | "pending_approval"
  | "approved"
  | "published"
  | "skipped"
  | "failed";

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  scheduled: "Scheduled",
  generating: "Generating",
  pending_approval: "Review",
  approved: "Approved",
  published: "Published",
  skipped: "Skipped",
  failed: "Failed"
};

const contentStatusToSlot: Record<Content["status"], SlotStatus> = {
  draft: "scheduled",
  pending_approval: "pending_approval",
  approved: "approved",
  published: "published",
  rejected: "skipped",
  historical: "published"
};

export const resolveSlotStatus = (params: {
  contentStatus: Content["status"];
  workflowStatus?: WorkflowStatus | null;
}): SlotStatus => {
  const mapped = contentStatusToSlot[params.contentStatus];
  if (mapped !== "pending_approval") {
    return mapped;
  }

  if (params.workflowStatus === "revision_requested") {
    return "failed";
  }
  if (params.workflowStatus === "approved") {
    return "approved";
  }
  if (params.workflowStatus === "rejected") {
    return "skipped";
  }
  return "pending_approval";
};

export const formatDateKey = (iso: string | null | undefined): string => {
  if (!iso) {
    return new Date().toISOString().slice(0, 10);
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
};
