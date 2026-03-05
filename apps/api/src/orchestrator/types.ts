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

export type TriggerFileTypeCounts = {
  image: number;
  video: number;
  document: number;
};

export type PendingFolderUpdateSummary = {
  activity_folder: string;
  pending_count: number;
  first_detected_at: string;
  last_detected_at: string;
  file_type_counts: TriggerFileTypeCounts;
};

export type CampaignStatus = "draft" | "approved" | "active" | "completed" | "cancelled";

export type SessionStatus = "running" | "paused" | "done" | "failed";
export type SessionWorkspaceType = "general" | "campaign_plan" | "content_create" | "folder" | string;
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

export type ContextLevel = "full" | "partial" | "minimal";

export type RagContextSource = {
  id: string;
  source_type: string;
  source_id: string;
  similarity: number;
};

export type RagContextMeta = {
  context_level: ContextLevel;
  memory_md_generated_at: string | null;
  tier2_sources: RagContextSource[];
  total_context_tokens: number;
  retrieval_avg_similarity: number | null;
};

export type ForbiddenCheckMeta = {
  passed: boolean;
  violations: string[];
  regenerated: boolean;
};

export type SurveyQuestionId = "campaign_goal" | "channels" | "duration" | "content_source";
export type SurveyQuestionPriority = "required" | "optional";

export type SurveyQuestion = {
  id: SurveyQuestionId;
  priority: SurveyQuestionPriority;
  label: string;
  choices?: string[];
  auto_fill_source?: string;
};

export type SurveyAnswer = {
  question_id: SurveyQuestionId;
  answer: string;
  source: "user" | "auto_filled" | "extracted_from_initial_message";
  answered_at: string;
};

export type CampaignSurveyState = {
  started_at: string;
  phase: "survey_active" | "draft_review";
  pending_questions: SurveyQuestionId[];
  answers: SurveyAnswer[];
  auto_fill_applied: boolean;
  completed_at: string | null;
  awaiting_final_confirmation: boolean;
};

export type SessionState = {
  trigger_id: string;
  activity_folder: string;
  file_name: string;
  file_type: TriggerFileType;
  active_skill: string | null;
  active_skill_started_at: string | null;
  active_skill_version: string | null;
  active_skill_confidence: number | null;
  skill_lock_id: string | null;
  skill_lock_source: "manual" | "llm_auto" | null;
  skill_lock_at: string | null;
  user_message: string | null;
  campaign_id: string | null;
  campaign_survey: CampaignSurveyState | null;
  campaign_draft_version: number;
  campaign_chain_data: Record<string, unknown> | null;
  campaign_plan_document: string | null;
  campaign_workflow_item_id: string | null;
  campaign_plan: CampaignPlan | null;
  content_id: string | null;
  content_workflow_item_id: string | null;
  content_draft: string | null;
  rag_context: RagContextMeta | null;
  forbidden_check: ForbiddenCheckMeta | null;
  processed_event_ids: string[];
  last_error: string | null;
};

export type OrchestratorSessionRow = {
  id: string;
  org_id: string;
  trigger_id: string | null;
  workspace_type: SessionWorkspaceType;
  scope_id: string | null;
  workspace_key?: string | null;
  title: string | null;
  context_label?: string | null;
  created_by_user_id: string | null;
  archived_at: string | null;
  state: unknown;
  current_step: OrchestratorStep;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
};

export type SessionListCursor = {
  updated_at: string;
  id: string;
};

export type ListSessionsParams = {
  orgId: string;
  limit: number;
  cursor?: SessionListCursor | null;
  workspaceType?: string | null;
  scopeId?: string | null;
  statuses?: SessionStatus[];
  includeArchived?: boolean;
};

export type CreateSessionParams = {
  orgId: string;
  workspaceType: string;
  scopeId?: string | null;
  title?: string | null;
  createdByUserId?: string | null;
  startPaused?: boolean;
  forceNew?: boolean;
};

export type CreateSessionResult = {
  session: OrchestratorSessionRow;
  reused: boolean;
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

export type ResumeSessionResult = {
  session_id: string;
  current_step: OrchestratorStep;
  status: SessionStatus;
  idempotent: boolean;
};
