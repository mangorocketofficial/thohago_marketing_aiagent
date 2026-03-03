import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors";
import { WorkflowRepositoryError, isUniqueViolation } from "./errors";
import {
  deleteWorkflowItemById,
  getWorkflowEventByIdempotencyKey,
  getWorkflowItemById,
  getWorkflowItemBySourceCampaignId,
  getWorkflowItemBySourceContentId,
  insertWorkflowEvent,
  insertWorkflowItem,
  listWorkflowItemsByStatuses,
  updateWorkflowItemOriginChatMessage,
  updateWorkflowItemWithVersion
} from "./repository";
import type {
  ApplyWorkflowActionInput,
  ApplyWorkflowActionResult,
  CreateWorkflowItemInput,
  WorkflowAction,
  WorkflowItemPayload,
  WorkflowItemRow,
  WorkflowStatus
} from "./types";

const TERMINAL_STATUSES = new Set<WorkflowStatus>(["approved", "rejected"]);

const normalizePayload = (value: WorkflowItemPayload | undefined): WorkflowItemPayload => value ?? {};

const normalizeIdempotencyKey = (value: string | null | undefined, prefix: string): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return `${prefix}:${randomUUID()}`;
};

const toHttpDbError = (error: unknown, fallbackMessage: string): HttpError => {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof WorkflowRepositoryError) {
    return new HttpError(500, "db_error", error.message);
  }
  if (error instanceof Error) {
    return new HttpError(500, "db_error", `${fallbackMessage}: ${error.message}`);
  }
  return new HttpError(500, "db_error", fallbackMessage);
};

const resolveInitialAction = (status: WorkflowStatus): WorkflowAction => {
  switch (status) {
    case "revision_requested":
      return "request_revision";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "proposed":
    default:
      return "proposed";
  }
};

const resolveNextStatus = (from: WorkflowStatus, action: WorkflowAction): WorkflowStatus | null => {
  switch (action) {
    case "request_revision":
      return from === "proposed" ? "revision_requested" : null;
    case "resubmitted":
    case "proposed":
      return from === "revision_requested" ? "proposed" : null;
    case "approved":
      return from === "proposed" ? "approved" : null;
    case "rejected":
      return from === "proposed" || from === "revision_requested" ? "rejected" : null;
    default:
      return null;
  }
};

const versionConflict = (params: {
  itemId: string;
  expectedVersion?: number | null;
  currentVersion: number;
  workflowStatus: WorkflowStatus;
}): HttpError =>
  new HttpError(409, "version_conflict", "Workflow item version mismatch.", {
    workflow_item_id: params.itemId,
    expected_version:
      typeof params.expectedVersion === "number" && Number.isFinite(params.expectedVersion)
        ? Math.max(1, Math.floor(params.expectedVersion))
        : null,
    current_version: Math.max(1, Math.floor(params.currentVersion)),
    workflow_status: params.workflowStatus
  });

export const createWorkflowItem = async (input: CreateWorkflowItemInput): Promise<WorkflowItemRow> => {
  const status: WorkflowStatus = input.status ?? "proposed";
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, `wf:create:${input.orgId}:${input.type}`);

  try {
    const replayEvent = await getWorkflowEventByIdempotencyKey(input.orgId, idempotencyKey);
    if (replayEvent) {
      const replayItem = await getWorkflowItemById(input.orgId, replayEvent.workflow_item_id);
      if (replayItem) {
        return replayItem;
      }
    }

    const item = await insertWorkflowItem({
      org_id: input.orgId,
      type: input.type,
      status,
      payload: normalizePayload(input.payload),
      origin_chat_message_id: input.originChatMessageId ?? null,
      source_campaign_id: input.sourceCampaignId ?? null,
      source_content_id: input.sourceContentId ?? null,
      resolved_at: TERMINAL_STATUSES.has(status) ? new Date().toISOString() : null,
      resolved_by: TERMINAL_STATUSES.has(status) ? input.actorUserId ?? null : null
    });

    try {
      await insertWorkflowEvent({
        org_id: input.orgId,
        workflow_item_id: item.id,
        action: resolveInitialAction(status),
        actor_type: input.actorType ?? "system",
        actor_user_id: input.actorUserId ?? null,
        from_status: null,
        to_status: status,
        payload: normalizePayload(input.payload),
        expected_version: null,
        idempotency_key: idempotencyKey
      });
    } catch (eventError) {
      if (isUniqueViolation(eventError)) {
        const replayEvent = await getWorkflowEventByIdempotencyKey(input.orgId, idempotencyKey);
        if (replayEvent) {
          const replayItem = await getWorkflowItemById(input.orgId, replayEvent.workflow_item_id);
          if (replayItem) {
            void deleteWorkflowItemById(input.orgId, item.id).catch(() => undefined);
            return replayItem;
          }
        }
      }
      throw eventError;
    }

    return item;
  } catch (error) {
    throw toHttpDbError(error, "Failed to create workflow item");
  }
};

export const applyWorkflowAction = async (input: ApplyWorkflowActionInput): Promise<ApplyWorkflowActionResult> => {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, `wf:action:${input.orgId}:${input.itemId}`);
  const payload = normalizePayload(input.payload);

  try {
    const replayEvent = await getWorkflowEventByIdempotencyKey(input.orgId, idempotencyKey);
    if (replayEvent) {
      const replayItem = await getWorkflowItemById(input.orgId, replayEvent.workflow_item_id);
      if (!replayItem) {
        throw new HttpError(409, "idempotent_replay_missing_item", "Idempotent event exists but item is missing.");
      }
      return {
        item: replayItem,
        event: replayEvent,
        idempotent: true
      };
    }

    const current = await getWorkflowItemById(input.orgId, input.itemId);
    if (!current) {
      throw new HttpError(404, "not_found", "Workflow item not found.");
    }

    if (TERMINAL_STATUSES.has(current.status)) {
      throw new HttpError(409, "invalid_transition", `Workflow item is already terminal (${current.status}).`);
    }

    if (typeof input.expectedVersion === "number" && Number.isFinite(input.expectedVersion)) {
      if (Math.floor(input.expectedVersion) !== current.version) {
        throw versionConflict({
          itemId: current.id,
          expectedVersion: input.expectedVersion,
          currentVersion: current.version,
          workflowStatus: current.status
        });
      }
    }

    const nextStatus = resolveNextStatus(current.status, input.action);
    if (!nextStatus) {
      throw new HttpError(
        409,
        "invalid_transition",
        `Action "${input.action}" is not allowed from status "${current.status}".`
      );
    }

    const nextPayload = Object.keys(payload).length > 0 ? { ...current.payload, ...payload } : current.payload;
    const resolvedAt = TERMINAL_STATUSES.has(nextStatus) ? new Date().toISOString() : null;
    const resolvedBy = TERMINAL_STATUSES.has(nextStatus) ? input.actorUserId ?? null : null;

    const updated = await updateWorkflowItemWithVersion({
      orgId: input.orgId,
      itemId: input.itemId,
      fromVersion: current.version,
      status: nextStatus,
      payload: nextPayload,
      resolvedAt,
      resolvedBy
    });

    if (!updated) {
      const latest = await getWorkflowItemById(input.orgId, input.itemId);
      throw versionConflict({
        itemId: input.itemId,
        expectedVersion: input.expectedVersion ?? current.version,
        currentVersion: latest?.version ?? current.version,
        workflowStatus: latest?.status ?? current.status
      });
    }

    try {
      const event = await insertWorkflowEvent({
        org_id: input.orgId,
        workflow_item_id: updated.id,
        action: input.action,
        actor_type: input.actorType,
        actor_user_id: input.actorUserId ?? null,
        from_status: current.status,
        to_status: nextStatus,
        payload,
        expected_version: current.version,
        idempotency_key: idempotencyKey
      });

      return {
        item: updated,
        event,
        idempotent: false
      };
    } catch (eventError) {
      if (isUniqueViolation(eventError)) {
        const dedupedEvent = await getWorkflowEventByIdempotencyKey(input.orgId, idempotencyKey);
        if (dedupedEvent) {
          const dedupedItem = await getWorkflowItemById(input.orgId, dedupedEvent.workflow_item_id);
          if (dedupedItem) {
            return {
              item: dedupedItem,
              event: dedupedEvent,
              idempotent: true
            };
          }
        }
      }
      throw eventError;
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw toHttpDbError(error, "Failed to apply workflow action");
  }
};

export const ensureCampaignWorkflowItem = async (params: {
  orgId: string;
  campaignId: string;
  payload: WorkflowItemPayload;
  originChatMessageId?: string | null;
  idempotencyKey?: string | null;
}): Promise<WorkflowItemRow> => {
  try {
    const existing = await getWorkflowItemBySourceCampaignId(params.orgId, params.campaignId);
    if (existing) {
      return existing;
    }

    return await createWorkflowItem({
      orgId: params.orgId,
      type: "campaign_plan",
      payload: params.payload,
      originChatMessageId: params.originChatMessageId ?? null,
      sourceCampaignId: params.campaignId,
      actorType: "assistant",
      idempotencyKey: params.idempotencyKey ?? null
    });
  } catch (error) {
    throw toHttpDbError(error, "Failed to ensure campaign workflow item");
  }
};

export const ensureContentWorkflowItem = async (params: {
  orgId: string;
  contentId: string;
  payload: WorkflowItemPayload;
  originChatMessageId?: string | null;
  idempotencyKey?: string | null;
}): Promise<WorkflowItemRow> => {
  try {
    const existing = await getWorkflowItemBySourceContentId(params.orgId, params.contentId);
    if (existing) {
      return existing;
    }

    return await createWorkflowItem({
      orgId: params.orgId,
      type: "content_draft",
      payload: params.payload,
      originChatMessageId: params.originChatMessageId ?? null,
      sourceContentId: params.contentId,
      actorType: "assistant",
      idempotencyKey: params.idempotencyKey ?? null
    });
  } catch (error) {
    throw toHttpDbError(error, "Failed to ensure content workflow item");
  }
};

export const getPendingWorkflowItems = async (orgId: string): Promise<WorkflowItemRow[]> => {
  try {
    return await listWorkflowItemsByStatuses(orgId, ["proposed", "revision_requested"]);
  } catch (error) {
    throw toHttpDbError(error, "Failed to query pending workflow items");
  }
};

export const linkWorkflowItemOriginChatMessage = async (params: {
  orgId: string;
  itemId: string;
  chatMessageId: string;
}): Promise<WorkflowItemRow | null> => {
  try {
    const existing = await getWorkflowItemById(params.orgId, params.itemId);
    if (!existing) {
      return null;
    }
    if (existing.origin_chat_message_id === params.chatMessageId) {
      return existing;
    }
    return await updateWorkflowItemOriginChatMessage({
      orgId: params.orgId,
      itemId: params.itemId,
      originChatMessageId: params.chatMessageId
    });
  } catch (error) {
    throw toHttpDbError(error, "Failed to link workflow item origin chat message");
  }
};
