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

export type CrawlSourceStatus = "pending" | "running" | "done" | "partial" | "failed" | "skipped";

export type OnboardingCrawlSource = "website" | "naver_blog" | "instagram";

export type OnboardingCrawlSourceResult = {
  source: OnboardingCrawlSource;
  url: string;
  status: CrawlSourceStatus;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  data: Record<string, unknown> | null;
};

export type OnboardingCrawlStatus = {
  state: "idle" | "running" | "done";
  started_at: string | null;
  finished_at: string | null;
  sources: {
    website: OnboardingCrawlSourceResult;
    naver_blog: OnboardingCrawlSourceResult;
    instagram: OnboardingCrawlSourceResult;
  };
};

export type InterviewAnswers = {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
};

export type BrandProfile = {
  organization_summary: string;
  detected_tone: string;
  tone_guardrails: string[];
  key_themes: string[];
  target_audience: string[];
  forbidden_words: string[];
  forbidden_topics: string[];
  campaign_seasons: string[];
  content_directions: string[];
  confidence_notes: string[];
  channel_roles?: {
    website?: string;
    naver_blog?: string;
    instagram?: string;
  };
  top_priorities?: string[];
  suggested_hashtags?: string[];
};

export type OnboardingResultDocument = {
  generated_at: string;
  organization_summary: string;
  detected_tone: string;
  suggested_tone_guardrails: string[];
  key_themes: string[];
  target_audience: string[];
  forbidden_words: string[];
  forbidden_topics: string[];
  campaign_season_hints: string[];
  recommended_initial_content_directions: string[];
  known_data_gaps: string[];
  confidence_notes: string[];
  review_markdown?: string;
  version?: "phase_1_7a" | "phase_1_7b";
  report_version?: "phase_1_7a" | "phase_1_7b";
  template_ref?: string;
  data_coverage_notice?: string;
  synthesis_mode?: string;
  synthesis_debug?: Record<string, unknown>;
};

export type OrgBrandSettings = {
  org_id: string;
  website_url: string | null;
  naver_blog_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
  threads_url: string | null;
  crawl_status: OnboardingCrawlStatus;
  crawl_payload: Record<string, unknown>;
  interview_answers: InterviewAnswers;
  detected_tone: string | null;
  tone_description: string | null;
  target_audience: string[];
  key_themes: string[];
  forbidden_words: string[];
  forbidden_topics: string[];
  campaign_seasons: string[];
  brand_summary: string | null;
  result_document: OnboardingResultDocument | Record<string, unknown> | null;
  memory_md: string | null;
  memory_md_generated_at: string | null;
  memory_freshness_key: string | null;
  rag_indexed_at: string | null;
  rag_source_hash: string | null;
  accumulated_insights: AccumulatedInsights | Record<string, unknown>;
  rag_ingestion_status: RagIngestionStatus;
  rag_ingestion_started_at: string | null;
  rag_ingestion_error: string | null;
  created_at: string;
  updated_at: string;
};

export type RagIngestionStatus = "pending" | "processing" | "done" | "failed";

export type AccumulatedInsights = {
  best_publish_times: Record<string, string>;
  top_cta_phrases: string[];
  content_pattern_summary: string;
  channel_recommendations: Record<string, string>;
  user_edit_preference_summary: string;
  generated_at: string;
  content_count_at_generation: number;
};

export type RagEmbeddingModel = "text-embedding-3-small" | "text-embedding-3-large";
export type RagEmbeddingDim = 512 | 768 | 1536;

export type RagEmbeddingProfile = {
  model: RagEmbeddingModel;
  dimensions: RagEmbeddingDim;
};

export type RagSourceType = "brand_profile" | "content" | "local_doc" | "chat_pattern";

export type RagChunk = {
  content: string;
  source_type: RagSourceType;
  source_id: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
};

export type RagEmbedding = {
  id: string;
  org_id: string;
  source_type: RagSourceType;
  source_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding_model: RagEmbeddingModel;
  embedding_dim: RagEmbeddingDim;
  embedding: number[];
  created_at: string;
  updated_at: string;
};

export type RagSearchResult = {
  id: string;
  content: string;
  source_type: RagSourceType;
  source_id: string;
  metadata: Record<string, unknown>;
  similarity: number;
  weighted_score: number;
};

export type RagSearchOptions = {
  embedding_profile?: RagEmbeddingProfile;
  source_types?: RagSourceType[];
  top_k?: number;
  min_similarity?: number;
  metadata_filter?: Record<string, unknown>;
  boost?: {
    field: string;
    weight: number;
  };
};

export type MemoryMd = {
  markdown: string;
  token_count: number;
  generated_at: string;
  freshness_key: string;
};
