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
  created_at: string;
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
