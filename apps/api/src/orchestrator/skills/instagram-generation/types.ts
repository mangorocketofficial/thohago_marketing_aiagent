export type SlotSource = "campaign" | "ondemand";

export type ScheduleSlotRow = {
  id: string;
  org_id: string;
  campaign_id: string | null;
  session_id: string | null;
  channel: string;
  content_type: string;
  title: string | null;
  scheduled_date: string;
  slot_status: string;
  content_id: string | null;
  metadata: Record<string, unknown>;
  lock_version: number;
};

export type InstagramImageMode = "auto" | "manual" | "text_only";
export type InstagramSurveyPhase = "topic" | "image_selection" | "template_selection" | "generating" | "complete";

export type InstagramSurveyState = {
  phase: InstagramSurveyPhase;
  topic: string | null;
  imageMode: InstagramImageMode | null;
  selectedImagePaths: string[];
  templateId: string | null;
  completed_at: string | null;
};

export type InstagramDraft = {
  caption: string;
  hashtags: string[];
  overlayMain: string;
  overlaySub: string;
  suggestedImageKeywords: string[];
};

export type InstagramGenerationResult = {
  contentId: string;
  slotId: string;
  source: SlotSource;
  topic: string;
  caption: string;
  model: "claude" | "gpt-4o-mini";
  outputFormat: "png" | "jpg";
  storagePath: string;
  previewUrl: string | null;
  templateId: string;
  selectedImagePaths: string[];
  localSaveSuggestion: {
    relativePath: string;
    fileName: string;
  };
  reused: boolean;
};

export const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

export const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseLockVersion = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return 1;
};

export const parseSlotRow = (value: unknown): ScheduleSlotRow => {
  const row = asRecord(value);
  return {
    id: asString(row.id, "").trim(),
    org_id: asString(row.org_id, "").trim(),
    campaign_id: asString(row.campaign_id, "").trim() || null,
    session_id: asString(row.session_id, "").trim() || null,
    channel: asString(row.channel, "").trim().toLowerCase(),
    content_type: asString(row.content_type, "").trim(),
    title: asString(row.title, "").trim() || null,
    scheduled_date: asString(row.scheduled_date, "").trim(),
    slot_status: asString(row.slot_status, "scheduled").trim(),
    content_id: asString(row.content_id, "").trim() || null,
    metadata: asRecord(row.metadata),
    lock_version: parseLockVersion(row.lock_version)
  };
};

export const defaultInstagramSurveyState = (): InstagramSurveyState => ({
  phase: "topic",
  topic: null,
  imageMode: null,
  selectedImagePaths: [],
  templateId: null,
  completed_at: null
});
