import type { WorkflowStatus } from "../workflow/types";
import type { ScheduleSlotStatus } from "./scheduler-status";

export type SlotTransitionEvent =
  | "generation_started"
  | "generation_completed"
  | "workflow_approved"
  | "workflow_rejected"
  | "workflow_revision_requested"
  | "workflow_resubmitted"
  | "content_published"
  | "generation_failed"
  | "publish_failed";

const ALLOWED_TRANSITIONS: Record<ScheduleSlotStatus, Set<ScheduleSlotStatus>> = {
  scheduled: new Set(["generating", "skipped", "failed"]),
  generating: new Set(["pending_approval", "skipped", "failed"]),
  pending_approval: new Set(["approved", "skipped", "failed"]),
  approved: new Set(["published", "skipped", "failed"]),
  published: new Set(),
  skipped: new Set(),
  failed: new Set()
};

export const resolveTargetSlotStatus = (params: {
  event: SlotTransitionEvent;
  publishedAt?: string | null;
}): ScheduleSlotStatus => {
  switch (params.event) {
    case "generation_started":
      return "generating";
    case "generation_completed":
    case "workflow_revision_requested":
    case "workflow_resubmitted":
      return "pending_approval";
    case "workflow_approved":
      return typeof params.publishedAt === "string" && params.publishedAt.trim() ? "published" : "approved";
    case "workflow_rejected":
      return "skipped";
    case "content_published":
      return "published";
    case "generation_failed":
    case "publish_failed":
      return "failed";
    default:
      return "scheduled";
  }
};

export const isSlotTransitionAllowed = (from: ScheduleSlotStatus, to: ScheduleSlotStatus): boolean =>
  from === to || ALLOWED_TRANSITIONS[from].has(to);

export const resolveWorkflowTransitionEvent = (workflowStatus: WorkflowStatus): SlotTransitionEvent => {
  if (workflowStatus === "approved") {
    return "workflow_approved";
  }
  if (workflowStatus === "rejected") {
    return "workflow_rejected";
  }
  if (workflowStatus === "revision_requested") {
    return "workflow_revision_requested";
  }
  return "workflow_resubmitted";
};
