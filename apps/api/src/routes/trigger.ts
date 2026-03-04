import { Router } from "express";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  acknowledgePendingFolderUpdatesForFolder,
  listPendingFolderUpdatesForOrg
} from "../orchestrator/service";
import type { PipelineTriggerRow, TriggerFileType } from "../orchestrator/types";

const FILE_TYPES = new Set<TriggerFileType>(["image", "video", "document"]);

const parseFileType = (value: unknown): TriggerFileType => {
  const fileType = parseRequiredString(value, "file_type").toLowerCase() as TriggerFileType;
  if (!FILE_TYPES.has(fileType)) {
    throw new HttpError(400, "invalid_payload", "file_type must be image, video, or document.");
  }
  return fileType;
};

const parseOptionalPositiveInt = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "invalid_payload", "limit must be a positive integer.");
  }
  return Math.max(1, Math.min(100, parsed));
};

const handleInsertError = async (
  body: {
    org_id: string;
    source_event_id: string | null;
  },
  error: PostgrestError
): Promise<{ trigger: PipelineTriggerRow; duplicate: boolean }> => {
  if (error.code !== "23505" || !body.source_event_id) {
    throw new HttpError(500, "db_error", `Failed to insert pipeline trigger: ${error.message}`);
  }

  const { data, error: existingError } = await supabaseAdmin
    .from("pipeline_triggers")
    .select("*")
    .eq("org_id", body.org_id)
    .eq("source_event_id", body.source_event_id)
    .maybeSingle();

  if (existingError || !data) {
    throw new HttpError(
      500,
      "db_error",
      `Failed to load duplicated trigger: ${existingError?.message ?? "trigger not found"}`
    );
  }

  return {
    trigger: data as PipelineTriggerRow,
    duplicate: true
  };
};

export const triggerRouter: Router = Router();

triggerRouter.post("/trigger", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.body?.org_id, "org_id");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const relativePath = parseRequiredString(req.body?.relative_path, "relative_path");
    const fileName = parseRequiredString(req.body?.file_name, "file_name");
    const activityFolder = parseRequiredString(req.body?.activity_folder, "activity_folder");
    const fileType = parseFileType(req.body?.file_type);
    const sourceEventIdRaw = req.body?.source_event_id;
    const sourceEventId =
      typeof sourceEventIdRaw === "string" && sourceEventIdRaw.trim() ? sourceEventIdRaw.trim() : null;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("pipeline_triggers")
      .insert({
        org_id: orgId,
        relative_path: relativePath,
        file_name: fileName,
        activity_folder: activityFolder,
        file_type: fileType,
        source_event_id: sourceEventId,
        status: "pending"
      })
      .select("*")
      .single();

    const { trigger, duplicate } = insertError
      ? await handleInsertError(
          {
            org_id: orgId,
            source_event_id: sourceEventId
          },
          insertError
        )
      : {
          trigger: inserted as PipelineTriggerRow,
          duplicate: false
        };

    const folderUpdates = await listPendingFolderUpdatesForOrg({
      orgId: trigger.org_id,
      limit: 20
    });

    if (trigger.status !== "pending") {
      res.status(200).json({
        ok: true,
        trigger_id: trigger.id,
        session_id: null,
        queued: false,
        duplicate: true,
        skipped: true,
        folder_updates: folderUpdates
      });
      return;
    }

    res.status(duplicate ? 200 : 201).json({
      ok: true,
      trigger_id: trigger.id,
      session_id: null,
      queued: false,
      duplicate,
      notification_type: "folder_updated",
      folder_updates: folderUpdates
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});

triggerRouter.get("/orgs/:orgId/folder-updates", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const limit = parseOptionalPositiveInt(req.query.limit, 20);
    const folderUpdates = await listPendingFolderUpdatesForOrg({
      orgId,
      limit
    });

    res.json({
      ok: true,
      folder_updates: folderUpdates
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});

triggerRouter.post("/orgs/:orgId/folder-updates/:activityFolder/acknowledge", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const activityFolder = parseRequiredString(req.params.activityFolder, "activityFolder");
    const acknowledged = await acknowledgePendingFolderUpdatesForFolder({
      orgId,
      activityFolder
    });

    res.json({
      ok: true,
      activity_folder: activityFolder,
      ...acknowledged
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});
