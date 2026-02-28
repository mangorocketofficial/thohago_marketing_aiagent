export type TriggerFileType = "image" | "video" | "document";
export type TriggerStatus = "pending" | "processing" | "done" | "failed";

export type PipelineTriggerRow = {
  id: string;
  org_id: string;
  relative_path: string;
  file_name: string;
  activity_folder: string;
  file_type: TriggerFileType;
  status: TriggerStatus;
  source_event_id: string | null;
  processed_at: string | null;
  created_at: string;
};

export type CampaignStatus = "draft" | "approved" | "active" | "completed" | "cancelled";

export type SessionStatus = "running" | "paused" | "done" | "failed";
export type OrchestratorStep =
  | "detect"
  | "await_user_input"
  | "await_campaign_approval"
  | "generate_content"
  | "await_content_approval"
  | "publish"
  | "done";

export type ScheduleItem = {
  day: number;
  channel: string;
  type: string;
};

export type CampaignPlan = {
  objective: string;
  channels: string[];
  duration_days: number;
  post_count: number;
  content_types: string[];
  suggested_schedule: ScheduleItem[];
};

export type SessionState = {
  trigger_id: string;
  activity_folder: string;
  file_name: string;
  file_type: TriggerFileType;
  user_message: string | null;
  campaign_id: string | null;
  campaign_plan: CampaignPlan | null;
  content_id: string | null;
  content_draft: string | null;
  processed_event_ids: string[];
  last_error: string | null;
};

export type OrchestratorSessionRow = {
  id: string;
  org_id: string;
  trigger_id: string | null;
  state: unknown;
  current_step: OrchestratorStep;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
};

export type ResumeEventType =
  | "user_message"
  | "campaign_approved"
  | "content_approved"
  | "campaign_rejected"
  | "content_rejected";

export type ResumeEventRequest = {
  event_type: ResumeEventType;
  payload?: Record<string, unknown>;
  idempotency_key?: string;
};

export type EnqueueTriggerResult = {
  mode: "started" | "queued";
  session_id: string;
};

export type ResumeSessionResult = {
  session_id: string;
  current_step: OrchestratorStep;
  status: SessionStatus;
  idempotent: boolean;
};

