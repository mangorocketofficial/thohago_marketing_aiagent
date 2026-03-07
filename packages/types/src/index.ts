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

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled";
export type SubscriptionProvider = "manual" | "stripe" | "paddle";

export type OrgSubscription = {
  id: string;
  org_id: string;
  provider: SubscriptionProvider;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrgEntitlement = {
  org_id: string;
  status: SubscriptionStatus;
  is_entitled: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

export type Channel = "instagram" | "threads" | "naver_blog" | "facebook" | "youtube";
export type ContentType = "text" | "image" | "video";
export type ContentStatus = "draft" | "pending_approval" | "approved" | "published" | "rejected" | "historical";
export type ContentCreatedBy = "ai" | "user" | "onboarding_crawl";

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
  embedded_at: string | null;
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

export type TriggerFileTypeCounts = {
  image: number;
  video: number;
  document: number;
};

export type PendingFolderUpdate = {
  activity_folder: string;
  pending_count: number;
  first_detected_at: string;
  last_detected_at: string;
  file_type_counts: TriggerFileTypeCounts;
};

export type FolderContext = {
  activity_folder: string;
  total_files: number;
  images: string[];
  videos: string[];
  documents: string[];
  scanned_at: string;
};

export type FolderDiff = {
  added: string[];
  removed: string[];
  is_first_scan: boolean;
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

export type CampaignChainStepState = "ok" | "failed" | "blocked_by_dependency";

export type CampaignAudienceMessagingData = {
  primary_audience: {
    label: string;
    description: string;
    pain_points: string[];
    active_platforms: string[];
  };
  secondary_audience: {
    label: string;
    description: string;
    pain_points: string[];
    active_platforms: string[];
  } | null;
  funnel_alignment: {
    awareness: string;
    consideration: string;
    decision: string;
  };
  core_message: string;
  support_messages: Array<{
    message: string;
    target_pain_point: string;
    evidence: string;
  }>;
  channel_tone_guide: Record<string, string>;
};

export type CampaignChannelStrategyData = {
  owned_channels: Array<{
    channel: string;
    rationale: string;
    content_format: string;
    effort_level: "high" | "medium" | "low";
    key_strategy: string;
  }>;
  earned_channels: Array<{
    channel: string;
    rationale: string;
    execution: string;
    effort_level: "high" | "medium" | "low";
  }>;
  paid_reference: Array<{
    channel: string;
    description: string;
    estimated_budget: string;
  }> | null;
};

export type CampaignContentCalendarData = {
  weeks: Array<{
    week_number: number;
    theme: string;
    phase: "awareness" | "engagement" | "conversion";
    items: Array<{
      day: number;
      day_label: string;
      content_title: string;
      content_description: string;
      channel: string;
      format: string;
      owner_hint: string;
      status: "draft";
    }>;
  }>;
  dependencies: Array<{
    source_day: number;
    target_day: number;
    description: string;
  }>;
};

export type CampaignExecutionData = {
  required_assets: Array<{
    id: number;
    name: string;
    asset_type: string;
    description: string;
    priority: "must" | "recommended";
    deadline_hint: string;
  }>;
  kpi_primary: Array<{
    metric: string;
    target: string;
    measurement: string;
    reporting_cadence: string;
  }>;
  kpi_secondary: Array<{
    metric: string;
    target: string;
    measurement: string;
    reporting_cadence: string;
  }>;
  reporting_plan: {
    daily: string;
    weekly: string;
    post_campaign: string;
  };
  budget_breakdown: Array<{
    item: string;
    estimated_cost: string;
    note: string;
  }> | null;
  risks: Array<{
    risk: string;
    likelihood: "high" | "medium" | "low";
    mitigation: string;
  }>;
  next_steps: Array<{
    action: string;
    timing: string;
  }>;
  approval_required: string[];
};

export type CampaignChainStepMeta = {
  state: CampaignChainStepState;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  retry_count: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error_code: string | null;
  error_message: string | null;
};

export type CampaignPlanChainData = {
  audience: CampaignAudienceMessagingData | null;
  channels: CampaignChannelStrategyData | null;
  calendar: CampaignContentCalendarData | null;
  execution: CampaignExecutionData | null;
  generated_at: string;
  chain_version: number;
  context_policy: {
    step_a: "full_rag";
    step_b: "compact_fact_pack";
    step_c: "micro_fact_pack";
    step_d: "micro_fact_pack";
  };
  step_meta: {
    step_a: CampaignChainStepMeta;
    step_b: CampaignChainStepMeta;
    step_c: CampaignChainStepMeta;
    step_d: CampaignChainStepMeta;
  };
};

export type Campaign = {
  id: string;
  org_id: string;
  title: string;
  activity_folder: string;
  status: CampaignStatus;
  channels: string[];
  plan: CampaignPlan;
  plan_chain_data?: CampaignPlanChainData | null;
  plan_document?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatChannel = "dashboard" | "telegram";
export type ChatRole = "user" | "assistant";
export type ChatMessageType = "text" | "action_card" | "system";

export type ChatActionCardEventType =
  | "content_approved"
  | "content_rejected";

export type ChatActionCardAction = {
  id: "approve" | "request_revision" | "reject";
  label: string;
  event_type: ChatActionCardEventType;
  mode?: "revision";
  disabled?: boolean;
};

export type ChatActionCardDispatchInput = {
  sessionId: string;
  workflowItemId: string;
  expectedVersion: number;
  actionId: ChatActionCardAction["id"];
  eventType: ChatActionCardEventType;
  contentId?: string;
  mode?: "revision";
  reason?: string;
  editedBody?: string;
};

export type CampaignPlanActionCardData = {
  title: string;
  channels: string[];
  post_count: number;
  date_range: {
    start: string;
    end: string;
  };
};

export type ContentDraftActionCardData = {
  title: string;
  channel: string;
  body_preview: string;
  body_full?: string;
  media_urls: string[];
};

export type WorkflowActionCardMetadata = {
  projection_type: "workflow_action_card";
  card_type: "campaign_plan" | "content_draft" | "content_generation_request";
  workflow_item_id: string;
  workflow_status: WorkflowStatus;
  expected_version: number;
  session_id: string;
  actions: ChatActionCardAction[];
  card_data: CampaignPlanActionCardData | ContentDraftActionCardData | Record<string, unknown>;
  resolved_at?: string;
};

export type SystemNotificationMetadata = {
  notification_type: "workflow_proposed";
  workflow_item_id: string;
  card_type: "campaign_plan" | "content_draft";
  display_title: string;
  workflow_status?: WorkflowStatus;
  expected_version?: number;
  resolved_at?: string;
};

export type ChatMessageMetadata = Record<string, unknown> | WorkflowActionCardMetadata | SystemNotificationMetadata;

export type ChatMessage = {
  id: string;
  org_id: string;
  session_id?: string | null;
  role: ChatRole;
  content: string;
  channel: ChatChannel;
  message_type: ChatMessageType;
  metadata: ChatMessageMetadata;
  workflow_item_id: string | null;
  projection_key: string | null;
  created_at: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const isWorkflowActionCardMetadata = (value: unknown): value is WorkflowActionCardMetadata => {
  if (!isRecord(value)) {
    return false;
  }

  if (value.projection_type !== "workflow_action_card") {
    return false;
  }
  if (value.card_type !== "campaign_plan" && value.card_type !== "content_draft" && value.card_type !== "content_generation_request") {
    return false;
  }
  if (typeof value.workflow_item_id !== "string" || !value.workflow_item_id.trim()) {
    return false;
  }
  if (typeof value.session_id !== "string" || !value.session_id.trim()) {
    return false;
  }
  if (typeof value.expected_version !== "number" || !Number.isFinite(value.expected_version)) {
    return false;
  }
  if (!Array.isArray(value.actions)) {
    return false;
  }

  return true;
};

export const isActionCardMessage = (
  message: ChatMessage
): message is ChatMessage & { message_type: "action_card"; metadata: WorkflowActionCardMetadata } =>
  message.message_type === "action_card" && isWorkflowActionCardMetadata(message.metadata);

export type SessionStatus = "running" | "paused" | "done" | "failed";
export type OrchestratorStep =
  | "detect"
  | "await_user_input"
  | "generate_content"
  | "await_content_approval"
  | "publish"
  | "done";

export type SurveyQuestionId = "campaign_name" | "campaign_goal" | "channels" | "duration" | "content_source";

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

export type OrchestratorState = {
  trigger_id: string;
  activity_folder: string;
  file_name: string;
  file_type: FileType;
  active_skill?: string | null;
  active_skill_started_at?: string | null;
  active_skill_version?: string | null;
  active_skill_confidence?: number | null;
  skill_lock_id?: string | null;
  skill_lock_source?: "manual" | "llm_auto" | null;
  skill_lock_at?: string | null;
  user_message: string | null;
  campaign_id: string | null;
  campaign_survey?: CampaignSurveyState | null;
  campaign_draft_version?: number;
  campaign_chain_data?: Record<string, unknown> | null;
  campaign_plan_document?: string | null;
  campaign_workflow_item_id: string | null;
  campaign_plan: CampaignPlan | null;
  content_id: string | null;
  content_workflow_item_id: string | null;
  content_draft: string | null;
  processed_event_ids: string[];
  last_error: string | null;
};

export type OrchestratorSession = {
  id: string;
  org_id: string;
  trigger_id: string | null;
  workspace_type?: string;
  scope_id?: string | null;
  workspace_key?: string;
  title?: string | null;
  context_label?: string | null;
  created_by_user_id?: string | null;
  archived_at?: string | null;
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

export type WorkflowItemType =
  | "campaign_plan"
  | "content_draft"
  | "content_generation_request"
  | "generic_approval";

export type WorkflowStatus = "proposed" | "revision_requested" | "approved" | "rejected";
export type WorkflowAction = "proposed" | "request_revision" | "resubmitted" | "approved" | "rejected";
export type WorkflowActorType = "user" | "assistant" | "system";

export type WorkflowItem = {
  id: string;
  org_id: string;
  session_id: string | null;
  display_title: string | null;
  type: WorkflowItemType;
  status: WorkflowStatus;
  payload: Record<string, unknown>;
  origin_chat_message_id: string | null;
  source_campaign_id: string | null;
  source_content_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowEvent = {
  id: string;
  org_id: string;
  workflow_item_id: string;
  action: WorkflowAction;
  actor_type: WorkflowActorType;
  actor_user_id: string | null;
  from_status: WorkflowStatus | null;
  to_status: WorkflowStatus;
  payload: Record<string, unknown>;
  expected_version: number | null;
  idempotency_key: string;
  created_at: string;
};

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
