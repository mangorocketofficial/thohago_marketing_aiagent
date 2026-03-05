export type WorkflowStatus = "proposed" | "revision_requested" | "approved" | "rejected";
export type ContentStatus = "draft" | "pending_approval" | "approved" | "published" | "rejected" | "historical";

export type ScheduleSlotStatus =
  | "scheduled"
  | "generating"
  | "pending_approval"
  | "approved"
  | "published"
  | "skipped"
  | "failed";

const contentToSlotStatus: Record<ContentStatus, ScheduleSlotStatus> = {
  draft: "scheduled",
  pending_approval: "pending_approval",
  approved: "approved",
  published: "published",
  rejected: "skipped",
  historical: "published"
};

export const resolveSlotStatusFromContent = (params: {
  contentStatus: ContentStatus;
  workflowStatus?: WorkflowStatus | null;
}): ScheduleSlotStatus => {
  const mapped = contentToSlotStatus[params.contentStatus];
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

export const normalizeSlotStatus = (value: unknown): ScheduleSlotStatus => {
  if (
    value === "scheduled" ||
    value === "generating" ||
    value === "pending_approval" ||
    value === "approved" ||
    value === "published" ||
    value === "skipped" ||
    value === "failed"
  ) {
    return value;
  }
  return "scheduled";
};
