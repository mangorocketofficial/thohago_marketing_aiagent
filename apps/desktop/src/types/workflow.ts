import type { WorkflowStatus } from "@repo/types";

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  proposed: "Proposed",
  revision_requested: "Revision Requested",
  approved: "Approved",
  rejected: "Rejected"
};

export const getWorkflowStatusLabel = (status: string): string => {
  if (status === "proposed" || status === "revision_requested" || status === "approved" || status === "rejected") {
    return WORKFLOW_STATUS_LABEL[status];
  }
  return status;
};
