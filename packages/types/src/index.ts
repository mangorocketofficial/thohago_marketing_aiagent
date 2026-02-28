export type OrgType = "ngo" | "nonprofit" | "social_venture" | "social_enterprise";

export type Organization = {
  id: string;
  name: string;
  org_type: OrgType;
  description: string | null;
  website: string | null;
  created_at: string;
};

export type User = {
  id: string;
  email: string;
  name: string | null;
  telegram_id: string | null;
  created_at: string;
};

export type MemberRole = "owner" | "admin" | "member";

export type OrganizationMember = {
  id: string;
  org_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
};

export type Channel = "instagram" | "threads" | "naver_blog" | "facebook" | "youtube";
export type ContentType = "text" | "image" | "video";
export type ContentStatus = "draft" | "pending_approval" | "approved" | "published" | "rejected";
export type ContentCreatedBy = "ai" | "user";

export type Content = {
  id: string;
  org_id: string;
  campaign_id: string | null;
  channel: Channel;
  content_type: ContentType;
  status: ContentStatus;
  body: string | null;
  metadata: Record<string, unknown>;
  scheduled_at: string | null;
  published_at: string | null;
  created_by: ContentCreatedBy;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FileType = "image" | "video" | "document";
export type PipelineTriggerStatus = "pending" | "processing" | "done" | "failed";

export type PipelineTrigger = {
  id: string;
  org_id: string;
  relative_path: string;
  file_name: string;
  activity_folder: string;
  file_type: FileType;
  status: PipelineTriggerStatus;
  source_event_id: string | null;
  processed_at: string | null;
  created_at: string;
};

export type CampaignStatus = "draft" | "approved" | "active" | "completed" | "cancelled";

export type CampaignPlanSchedule = {
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
  suggested_schedule: CampaignPlanSchedule[];
};

export type Campaign = {
  id: string;
  org_id: string;
  title: string;
  activity_folder: string;
  status: CampaignStatus;
  channels: string[];
  plan: CampaignPlan;
  created_at: string;
  updated_at: string;
};

export type ChatChannel = "dashboard" | "telegram";
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  org_id: string;
  role: ChatRole;
  content: string;
  channel: ChatChannel;
  created_at: string;
};

export type SessionStatus = "running" | "paused" | "done" | "failed";
export type OrchestratorStep =
  | "detect"
  | "await_user_input"
  | "await_campaign_approval"
  | "generate_content"
  | "await_content_approval"
  | "publish"
  | "done";

export type OrchestratorState = {
  trigger_id: string;
  activity_folder: string;
  file_name: string;
  file_type: FileType;
  user_message: string | null;
  campaign_id: string | null;
  campaign_plan: CampaignPlan | null;
  content_id: string | null;
  content_draft: string | null;
  processed_event_ids: string[];
  last_error: string | null;
};

export type OrchestratorSession = {
  id: string;
  org_id: string;
  trigger_id: string | null;
  state: OrchestratorState;
  current_step: OrchestratorStep;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
};

export type OnboardingStep =
  | "intro"
  | "account_auth"
  | "url_input"
  | "brand_review"
  | "interview"
  | "result_doc"
  | "folder_setup"
  | "summary_tutorial";

export type OnboardingDraftUrls = {
  websiteUrl: string;
  naverBlogUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  youtubeUrl: string;
  threadsUrl: string;
};

export type AuthSessionSummary = {
  userId: string;
  email: string | null;
};
