import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { requireUserJwt } from "../lib/auth";
import { env } from "../lib/env";
import { HttpError, toHttpError } from "../lib/errors";
import { ensureOrgSubscription, getOrgEntitlement, requireActiveSubscription } from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";
import { enqueueRagIngestion } from "../rag/ingest-brand-profile";
import { embedAllPendingContent } from "../rag/ingest-content";

const MAX_TEXT_LENGTH = 4000;
const MAX_JSON_LENGTH = 120_000;
const MAX_URL_LENGTH = 1024;
const REVIEW_TEMPLATE_REF = "docs/브랜드리뷰_2026-03-01-05.md";
const PHASE_1_7_REPORT_VERSION = "phase_1_7b";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const PINNED_REVIEW_PATH = "docs/브랜드리뷰_2026-03-01-05.md";
const REQUIRED_REVIEW_HEADINGS = [
  "# 브랜드 리뷰:",
  "## 종합 요약",
  "## 채널별 상세 분석",
  "## 채널 간 브랜드 일관성 분석",
  "## 법적 / 컴플라이언스 플래그",
  "## 수정 제안 (주요 항목)",
  "## 2026년 통합 전략 제안"
] as const;

const getPinnedReviewCandidates = (): string[] => {
  const overrides: string[] = [];
  if (env.onboardingPinnedReviewPath) {
    overrides.push(env.onboardingPinnedReviewPath);
    if (!path.isAbsolute(env.onboardingPinnedReviewPath)) {
      overrides.push(path.resolve(process.cwd(), env.onboardingPinnedReviewPath));
      overrides.push(path.resolve(process.cwd(), "../../", env.onboardingPinnedReviewPath));
    }
  }

  const defaults = [
    path.resolve(process.cwd(), PINNED_REVIEW_PATH),
    path.resolve(process.cwd(), "../../", PINNED_REVIEW_PATH)
  ];

  return [...new Set([...overrides, ...defaults])];
};

const loadPinnedReviewMarkdown = (): { markdown: string; sourcePath: string } | null => {
  for (const candidate of getPinnedReviewCandidates()) {
    if (!candidate) {
      continue;
    }
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const markdown = fs.readFileSync(candidate, "utf8").replace(/\r\n/g, "\n").trim();
    if (!markdown) {
      continue;
    }

    return {
      markdown,
      sourcePath: candidate
    };
  }

  return null;
};

const parseOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeSynthesisMode = (value: unknown): "phase_1_7a" | "phase_1_7b" => {
  const normalized = parseOptionalString(value);
  return normalized === "phase_1_7a" ? "phase_1_7a" : PHASE_1_7_REPORT_VERSION;
};

const parseRequiredString = (value: unknown, field: string, maxLength = 200): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "invalid_payload", `${field} is too long.`);
  }
  return trimmed;
};

const parseOptionalUrl = (value: unknown): string | null => {
  const direct = parseOptionalString(value);
  if (!direct) {
    return null;
  }
  if (direct.length > MAX_URL_LENGTH) {
    throw new HttpError(400, "invalid_payload", "URL is too long.");
  }
  try {
    const parsed = new URL(direct);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
    return direct;
  } catch {
    throw new HttpError(400, "invalid_payload", "Invalid URL format.");
  }
};

const parseObject = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_payload", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const parseJsonSize = (value: unknown, field: string, maxLength = MAX_JSON_LENGTH): void => {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length > maxLength) {
    throw new HttpError(413, "payload_too_large", `${field} is too large.`);
  }
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const extractJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return value.slice(start, end + 1);
};

const truncateText = (value: string, maxLength = 12_000): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n... [truncated]`;
};

const toPreviewJson = (value: unknown, maxLength = 2000): string => {
  const serialized = JSON.stringify(value ?? null);
  return truncateText(serialized, maxLength);
};

const resolveOrgName = (value: unknown, fallbackEmail: string | null): string => {
  const direct = parseOptionalString(value);
  if (direct) {
    return direct.slice(0, 120);
  }

  if (fallbackEmail) {
    const username = fallbackEmail.split("@")[0]?.trim();
    if (username) {
      return `${username} Organization`;
    }
  }

  return "My Organization";
};

const ensureUserProfile = async (params: {
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<void> => {
  const email = params.email ?? `${params.userId}@local.invalid`;
  const payload = {
    id: params.userId,
    email,
    name: params.name ?? null
  };

  const { error } = await supabaseAdmin.from("users").upsert(payload, {
    onConflict: "id"
  });

  if (error) {
    throw new HttpError(500, "db_error", `Failed to upsert user profile: ${error.message}`);
  }
};

type MembershipRow = {
  org_id: string;
  role: "owner" | "admin" | "member";
  organizations?: {
    id: string;
    name: string;
    org_type: string;
  } | null;
};

const getExistingMembership = async (userId: string): Promise<MembershipRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("org_id, role, organizations(id, name, org_type)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }

  return (data as MembershipRow | null) ?? null;
};

const requireOrgMembership = async (
  userId: string,
  orgId: string
): Promise<{ role: "owner" | "admin" | "member" }> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }
  if (!data?.role) {
    throw new HttpError(403, "forbidden", "You are not a member of this organization.");
  }

  return {
    role: data.role as "owner" | "admin" | "member"
  };
};

const createInitialOrg = async (params: {
  userId: string;
  orgName: string;
}): Promise<{ orgId: string; orgName: string; orgType: string }> => {
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .insert({
      name: params.orgName,
      org_type: "nonprofit"
    })
    .select("id, name, org_type")
    .single();

  if (orgError || !org) {
    throw new HttpError(500, "db_error", `Failed to create organization: ${orgError?.message ?? "unknown"}`);
  }

  const { error: memberError } = await supabaseAdmin.from("organization_members").insert({
    org_id: org.id,
    user_id: params.userId,
    role: "owner"
  });

  if (memberError) {
    throw new HttpError(500, "db_error", `Failed to create organization membership: ${memberError.message}`);
  }
  await ensureOrgSubscription(org.id);

  return {
    orgId: org.id,
    orgName: org.name,
    orgType: org.org_type
  };
};

type OrganizationContext = {
  id: string;
  name: string;
  org_type: string;
  website: string | null;
};

const getOrganizationContext = async (orgId: string): Promise<OrganizationContext | null> => {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name, org_type, website")
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization: ${error.message}`);
  }

  if (!data?.id) {
    return null;
  }

  return {
    id: data.id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Organization",
    org_type: typeof data.org_type === "string" && data.org_type.trim() ? data.org_type.trim() : "nonprofit",
    website: parseOptionalString(data.website)
  };
};

const defaultInterviewAnswers = () => ({
  q1: "",
  q2: "",
  q3: "",
  q4: ""
});

const parseInterviewAnswers = (value: unknown) => {
  const obj = parseObject(value, "interview_answers");
  const next = defaultInterviewAnswers();
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    const raw = obj[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw !== "string") {
      throw new HttpError(400, "invalid_payload", `interview_answers.${key} must be a string.`);
    }
    const trimmed = raw.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw new HttpError(400, "invalid_payload", `interview_answers.${key} is too long.`);
    }
    next[key] = trimmed;
  }
  return next;
};

const parseDelimitedList = (value: string, maxItems = 10): string[] => {
  return value
    .split(/[,\n/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

const parseStringArray = (value: unknown, maxItems = 12): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

const fallbackToneFromText = (text: string): string => {
  const lower = text.toLowerCase();
  if (/(warm|friendly|친근|다정|공감)/i.test(lower)) {
    return "warm";
  }
  if (/(formal|professional|전문|공식)/i.test(lower)) {
    return "professional";
  }
  if (/(bold|energetic|강렬|활기)/i.test(lower)) {
    return "energetic";
  }
  return "balanced";
};

const toneGuardrailsFromTone = (tone: string): string[] => {
  if (tone === "warm") {
    return ["Use empathetic language.", "Prefer plain words over jargon.", "Keep sentence rhythm natural."];
  }
  if (tone === "professional") {
    return ["Prioritize clarity over hype.", "Support claims with concrete facts.", "Use consistent terminology."];
  }
  if (tone === "energetic") {
    return ["Lead with action verbs.", "Keep messages concise and vivid.", "Avoid exaggerated promises."];
  }
  return ["Keep claims accurate.", "Use consistent brand terms.", "Balance friendliness with clarity."];
};

const extractWebsiteSignals = (crawlResult: Record<string, unknown>) => {
  const sources = parseObject(crawlResult.sources ?? {}, "crawl_result.sources");
  const website = parseObject(sources.website ?? {}, "crawl_result.sources.website");
  const naverBlog = parseObject(sources.naver_blog ?? {}, "crawl_result.sources.naver_blog");
  const websiteData =
    website.data && typeof website.data === "object" && !Array.isArray(website.data)
      ? (website.data as Record<string, unknown>)
      : {};
  const naverData =
    naverBlog.data && typeof naverBlog.data === "object" && !Array.isArray(naverBlog.data)
      ? (naverBlog.data as Record<string, unknown>)
      : {};

  const headings = parseStringArray(websiteData.headings);
  const paragraphs = parseStringArray(websiteData.paragraphs);
  const blogTitles = parseStringArray(
    Array.isArray(naverData.recent_posts)
      ? naverData.recent_posts.map((row) =>
          row && typeof row === "object" && typeof (row as Record<string, unknown>).title === "string"
            ? ((row as Record<string, unknown>).title as string)
            : ""
        )
      : []
  );

  return {
    headings,
    paragraphs,
    blogTitles
  };
};

const synthesizeProfile = (params: {
  crawlResult: Record<string, unknown>;
  interviewAnswers: ReturnType<typeof defaultInterviewAnswers>;
  orgId: string;
}) => {
  const { headings, paragraphs, blogTitles } = extractWebsiteSignals(params.crawlResult);
  const seedText = [params.interviewAnswers.q1, ...headings, ...blogTitles, ...paragraphs.slice(0, 2)].join(" ");
  const tone = fallbackToneFromText(seedText);
  const keyThemes = [...headings, ...blogTitles].slice(0, 6);
  const targetAudience = parseDelimitedList(params.interviewAnswers.q2, 6);
  const forbidden = parseDelimitedList(params.interviewAnswers.q3, 10);
  const campaignSeasons = parseDelimitedList(params.interviewAnswers.q4, 10);
  const confidenceNotes: string[] = [];

  const crawlSources = parseObject(params.crawlResult.sources ?? {}, "crawl_result.sources");
  const websiteStatus = parseOptionalString((crawlSources.website as Record<string, unknown> | undefined)?.status) ?? "unknown";
  const naverStatus =
    parseOptionalString((crawlSources.naver_blog as Record<string, unknown> | undefined)?.status) ?? "unknown";
  if (websiteStatus !== "done") {
    confidenceNotes.push("Website crawl was incomplete.");
  }
  if (naverStatus !== "done") {
    confidenceNotes.push("Naver Blog crawl was incomplete.");
  }
  if (!targetAudience.length) {
    confidenceNotes.push("Target audience was inferred with limited interview detail.");
  }

  const organizationSummary = [
    `Org ${params.orgId} onboarding profile generated from provided URLs and interview inputs.`,
    keyThemes.length ? `Detected themes: ${keyThemes.join(", ")}.` : "Detected themes are limited.",
    targetAudience.length ? `Primary audience: ${targetAudience.join(", ")}.` : "Primary audience not explicitly provided."
  ].join(" ");

  const profile = {
    organization_summary: organizationSummary,
    detected_tone: tone,
    tone_guardrails: toneGuardrailsFromTone(tone),
    key_themes: keyThemes,
    target_audience: targetAudience,
    forbidden_words: forbidden,
    forbidden_topics: [] as string[],
    campaign_seasons: campaignSeasons,
    content_directions: keyThemes.length
      ? keyThemes.slice(0, 3).map((theme) => `Create educational posts around "${theme}".`)
      : ["Create a baseline mission-intro post.", "Create one audience FAQ post."],
    confidence_notes: confidenceNotes.length ? confidenceNotes : ["Synthesis confidence is medium."]
  };

  const document = {
    generated_at: new Date().toISOString(),
    organization_summary: profile.organization_summary,
    detected_tone: profile.detected_tone,
    suggested_tone_guardrails: profile.tone_guardrails,
    key_themes: profile.key_themes,
    target_audience: profile.target_audience,
    forbidden_words: profile.forbidden_words,
    forbidden_topics: profile.forbidden_topics,
    campaign_season_hints: profile.campaign_seasons,
    recommended_initial_content_directions: profile.content_directions,
    known_data_gaps: confidenceNotes,
    confidence_notes: profile.confidence_notes
  };

  return {
    profile,
    document
  };
};

type SynthesizedProfile = ReturnType<typeof synthesizeProfile>["profile"];
type SynthesizedDocument = ReturnType<typeof synthesizeProfile>["document"];

type ReviewIssue = {
  issue: string;
  location: string;
  severity: "높음" | "중간" | "낮음";
  suggestion: string;
};

type AnthropicContentBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type AnthropicResponse = {
  id?: string;
  model?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  content?: AnthropicContentBlock[];
  error?: {
    message?: string;
  };
};

type OpenAiChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

const toPromptJson = (value: unknown, maxLength = 18_000): string => {
  const serialized = JSON.stringify(value ?? null, null, 2);
  return truncateText(serialized, maxLength);
};

const toInlineText = (value: unknown, fallback = "-"): string => {
  const direct = parseOptionalString(value);
  if (!direct) {
    return fallback;
  }
  return direct.replace(/\s+/g, " ").trim();
};

const toIssueTable = (issues: ReviewIssue[]): string => {
  const rows = issues.length
    ? issues
    : [
        {
          issue: "수집 데이터가 제한되어 세부 이슈를 식별하지 못했습니다.",
          location: "-",
          severity: "중간",
          suggestion: "접근 가능한 채널 데이터를 보강한 뒤 재검토하세요."
        }
      ];

  const escapeCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  return [
    "| 이슈 | 위치 | 심각도 | 개선 제안 |",
    "|------|------|--------|-----------|",
    ...rows.map(
      (row) =>
        `| ${escapeCell(row.issue)} | ${escapeCell(row.location)} | ${escapeCell(row.severity)} | ${escapeCell(row.suggestion)} |`
    )
  ].join("\n");
};

const getCrawlSource = (crawlResult: Record<string, unknown>, sourceKey: string): Record<string, unknown> => {
  const sources = toRecord(crawlResult.sources);
  return toRecord(sources[sourceKey]);
};

const getCrawlSourceStatus = (crawlResult: Record<string, unknown>, sourceKey: string): string =>
  parseOptionalString(getCrawlSource(crawlResult, sourceKey).status) ?? "unknown";

const buildDataCoverageNotice = (crawlResult: Record<string, unknown>): string => {
  const toLabel = (status: string): string => {
    if (status === "done") {
      return "정상 수집";
    }
    if (status === "partial") {
      return "부분 수집";
    }
    if (status === "failed") {
      return "수집 실패";
    }
    if (status === "skipped") {
      return "미입력(건너뜀)";
    }
    if (status === "running") {
      return "수집 중";
    }
    if (status === "pending") {
      return "대기";
    }
    return "상태 미확인";
  };

  const websiteStatus = getCrawlSourceStatus(crawlResult, "website");
  const naverStatus = getCrawlSourceStatus(crawlResult, "naver_blog");
  const instagramStatus = getCrawlSourceStatus(crawlResult, "instagram");
  const instagramSummary = (() => {
    if (instagramStatus === "done") {
      return "프로필 + 최근 게시물 메타 확보";
    }
    if (instagramStatus === "partial") {
      return "공개 메타데이터만 제한 확보";
    }
    if (instagramStatus === "failed") {
      return "username-only fallback";
    }
    if (instagramStatus === "skipped") {
      return "URL 미입력";
    }
    return "상태 미확정";
  })();

  return [
    `웹사이트: ${toLabel(websiteStatus)}`,
    `네이버 블로그: ${toLabel(naverStatus)}`,
    `인스타그램: ${toLabel(instagramStatus)} (${instagramSummary})`
  ].join(", ");
};

const collectKnownDataGaps = (
  crawlResult: Record<string, unknown>,
  interviewAnswers: ReturnType<typeof defaultInterviewAnswers>
): string[] => {
  const gaps: string[] = [];
  const websiteStatus = getCrawlSourceStatus(crawlResult, "website");
  const naverStatus = getCrawlSourceStatus(crawlResult, "naver_blog");
  const instagramStatus = getCrawlSourceStatus(crawlResult, "instagram");
  const instagramSource = getCrawlSource(crawlResult, "instagram");
  const instagramData = toRecord(instagramSource.data);
  const instagramPosts = parseStringArray(
    Array.isArray(instagramData.recent_posts)
      ? instagramData.recent_posts.map((entry) =>
          entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).caption === "string"
            ? ((entry as Record<string, unknown>).caption as string)
            : ""
        )
      : [],
    6
  );

  if (websiteStatus !== "done") {
    gaps.push("웹사이트 데이터 수집이 완전하지 않아 구조/메시지 분석의 정확도에 제한이 있습니다.");
  }
  if (naverStatus !== "done") {
    gaps.push("네이버 블로그 데이터 수집이 완전하지 않아 콘텐츠/SEO 분석의 정확도에 제한이 있습니다.");
  }
  if (instagramStatus === "skipped") {
    gaps.push("인스타그램 URL이 입력되지 않아 채널별 일관성 분석은 웹사이트/네이버 블로그 중심으로 진행했습니다.");
  } else if (instagramStatus === "partial") {
    gaps.push("인스타그램은 공개 메타데이터 일부만 수집되어 포스트 단위 정밀 진단 범위가 제한됩니다.");
  } else if (instagramStatus === "failed") {
    gaps.push("인스타그램 수집이 실패하여 username-only fallback 기반의 제한 분석을 반영했습니다.");
  } else if (instagramStatus === "done" && instagramPosts.length < 2) {
    gaps.push("인스타그램 최근 게시물 샘플 수가 제한적이어서 채널 톤/일관성 분석의 정밀도가 낮을 수 있습니다.");
  }

  if (!interviewAnswers.q2.trim()) {
    gaps.push("타깃 오디언스 입력이 제한적이어서 일부 타깃 인사이트를 추정했습니다.");
  }
  if (!interviewAnswers.q4.trim()) {
    gaps.push("시즌/캠페인 시점 정보가 부족해 계절 전략 제안은 일반화되었습니다.");
  }

  return gaps;
};

const normalizeBrandProfile = (raw: unknown, fallback: SynthesizedProfile): SynthesizedProfile => {
  const row = toRecord(raw);
  const tone = parseOptionalString(row.detected_tone) ?? fallback.detected_tone;
  const toneGuardrails = parseStringArray(row.tone_guardrails, 8);
  const keyThemes = parseStringArray(row.key_themes, 10);
  const audience = parseStringArray(row.target_audience, 10);
  const forbiddenWords = parseStringArray(row.forbidden_words, 16);
  const forbiddenTopics = parseStringArray(row.forbidden_topics, 16);
  const campaignSeasons = parseStringArray(row.campaign_seasons, 12);
  const contentDirections = parseStringArray(row.content_directions, 12);
  const confidenceNotes = parseStringArray(row.confidence_notes, 12);

  return {
    organization_summary: parseOptionalString(row.organization_summary) ?? fallback.organization_summary,
    detected_tone: tone,
    tone_guardrails: toneGuardrails.length ? toneGuardrails : fallback.tone_guardrails,
    key_themes: keyThemes.length ? keyThemes : fallback.key_themes,
    target_audience: audience.length ? audience : fallback.target_audience,
    forbidden_words: forbiddenWords.length ? forbiddenWords : fallback.forbidden_words,
    forbidden_topics: forbiddenTopics.length ? forbiddenTopics : fallback.forbidden_topics,
    campaign_seasons: campaignSeasons.length ? campaignSeasons : fallback.campaign_seasons,
    content_directions: contentDirections.length ? contentDirections : fallback.content_directions,
    confidence_notes: confidenceNotes.length ? confidenceNotes : fallback.confidence_notes
  };
};

const buildOnboardingDocument = (params: {
  profile: SynthesizedProfile;
  knownDataGaps: string[];
  reviewMarkdown: string;
  dataCoverageNotice: string;
  reportVersion: "phase_1_7a" | "phase_1_7b";
  synthesisDebug: Record<string, unknown> | null;
}): SynthesizedDocument & {
  review_markdown: string;
  report_version: string;
  version: string;
  template_ref: string;
  data_coverage_notice: string;
  synthesis_debug?: Record<string, unknown>;
} => ({
  generated_at: new Date().toISOString(),
  organization_summary: params.profile.organization_summary,
  detected_tone: params.profile.detected_tone,
  suggested_tone_guardrails: params.profile.tone_guardrails,
  key_themes: params.profile.key_themes,
  target_audience: params.profile.target_audience,
  forbidden_words: params.profile.forbidden_words,
  forbidden_topics: params.profile.forbidden_topics,
  campaign_season_hints: params.profile.campaign_seasons,
  recommended_initial_content_directions: params.profile.content_directions,
  known_data_gaps: params.knownDataGaps,
  confidence_notes: params.profile.confidence_notes,
  review_markdown: params.reviewMarkdown,
  version: params.reportVersion,
  report_version: params.reportVersion,
  template_ref: REVIEW_TEMPLATE_REF,
  data_coverage_notice: params.dataCoverageNotice,
  synthesis_debug: params.synthesisDebug ?? undefined
});

const callAnthropicText = async (params: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}): Promise<{ text: string | null; trace: Record<string, unknown> }> => {
  if (!env.anthropicApiKey) {
    return {
      text: null,
      trace: {
        provider: "anthropic",
        model: env.anthropicModel,
        ok: false,
        skipped: true,
        reason: "missing_anthropic_api_key"
      }
    };
  }

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.anthropicModel,
        max_tokens: params.maxTokens,
        temperature: 0.2,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.userPrompt }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5
          }
        ]
      })
    });

    const body = (await response.json().catch(() => ({}))) as AnthropicResponse;
    const contentBlocks = Array.isArray(body.content) ? body.content : [];
    const blockTypes: Record<string, number> = {};
    let nonTextBlockCount = 0;
    for (const block of contentBlocks) {
      const type = typeof block?.type === "string" && block.type.trim() ? block.type.trim() : "unknown";
      blockTypes[type] = (blockTypes[type] ?? 0) + 1;
      if (type !== "text") {
        nonTextBlockCount += 1;
      }
    }

    const text =
      contentBlocks
        .filter((entry) => entry.type === "text" && !!entry.text?.trim())
        .map((entry) => entry.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n\n") ?? "";
    const normalizedText = text.trim() || null;

    const trace = {
      provider: "anthropic",
      model: env.anthropicModel,
      request: {
        max_tokens: params.maxTokens,
        temperature: 0.2,
        tool_names: ["web_search"],
        user_prompt_preview: truncateText(params.userPrompt, 1200)
      },
      response: {
        ok: response.ok,
        status: response.status,
        id: body.id ?? null,
        model: body.model ?? env.anthropicModel,
        stop_reason: body.stop_reason ?? null,
        usage: {
          input_tokens: body.usage?.input_tokens ?? null,
          output_tokens: body.usage?.output_tokens ?? null
        },
        block_types: blockTypes,
        non_text_block_count: nonTextBlockCount,
        used_web_search_tool: nonTextBlockCount > 0,
        text_length: normalizedText?.length ?? 0,
        text_preview: normalizedText ? truncateText(normalizedText, 1200) : null,
        error: body.error?.message ?? null
      }
    };

    if (!response.ok) {
      console.warn(`[Onboarding] Anthropic review generation failed (${response.status}): ${body.error?.message ?? "unknown"}`);
      return {
        text: null,
        trace
      };
    }

    return {
      text: normalizedText,
      trace
    };
  } catch (error) {
    console.warn("[Onboarding] Anthropic review generation error:", error);
    return {
      text: null,
      trace: {
        provider: "anthropic",
        model: env.anthropicModel,
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error"
      }
    };
  }
};

const callOpenAiJson = async (params: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ parsed: Record<string, unknown> | null; trace: Record<string, unknown> }> => {
  if (!env.openAiApiKey) {
    return {
      parsed: null,
      trace: {
        provider: "openai",
        model: env.openAiProfileModel,
        ok: false,
        skipped: true,
        reason: "missing_openai_api_key"
      }
    };
  }

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`
      },
      body: JSON.stringify({
        model: env.openAiProfileModel,
        temperature: 0,
        response_format: {
          type: "json_object"
        },
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt }
        ]
      })
    });

    const body = (await response.json().catch(() => ({}))) as OpenAiChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content;
    const finishReason = body.choices?.[0]?.finish_reason ?? null;
    const traceBase = {
      provider: "openai",
      model: env.openAiProfileModel,
      request: {
        response_format: "json_object",
        temperature: 0,
        user_prompt_preview: truncateText(params.userPrompt, 1200)
      },
      response: {
        ok: response.ok,
        status: response.status,
        id: body.id ?? null,
        model: body.model ?? env.openAiProfileModel,
        finish_reason: finishReason,
        usage: {
          prompt_tokens: body.usage?.prompt_tokens ?? null,
          completion_tokens: body.usage?.completion_tokens ?? null,
          total_tokens: body.usage?.total_tokens ?? null
        },
        content_length: typeof content === "string" ? content.length : 0,
        content_preview: typeof content === "string" && content.trim() ? truncateText(content, 1200) : null,
        error: body.error?.message ?? null
      }
    } as Record<string, unknown>;

    if (!response.ok) {
      console.warn(`[Onboarding] OpenAI profile extraction failed (${response.status}): ${body.error?.message ?? "unknown"}`);
      return {
        parsed: null,
        trace: traceBase
      };
    }

    if (typeof content !== "string" || !content.trim()) {
      return {
        parsed: null,
        trace: {
          ...traceBase,
          response: {
            ...toRecord(traceBase.response),
            parse_error: "empty_response_content"
          }
        }
      };
    }

    const jsonText = extractJsonObject(content) ?? content;
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        parsed: null,
        trace: {
          ...traceBase,
          response: {
            ...toRecord(traceBase.response),
            parse_error: "non_object_json"
          }
        }
      };
    }
    return {
      parsed: parsed as Record<string, unknown>,
      trace: {
        ...traceBase,
        response: {
          ...toRecord(traceBase.response),
          parse_ok: true,
          parsed_preview: toPreviewJson(parsed, 2000)
        }
      }
    };
  } catch (error) {
    console.warn("[Onboarding] OpenAI profile extraction error:", error);
    return {
      parsed: null,
      trace: {
        provider: "openai",
        model: env.openAiProfileModel,
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error"
      }
    };
  }
};

const buildFallbackReviewMarkdown = (params: {
  org: OrganizationContext;
  crawlResult: Record<string, unknown>;
  interviewAnswers: ReturnType<typeof defaultInterviewAnswers>;
  profile: SynthesizedProfile;
  dataCoverageNotice: string;
  knownDataGaps: string[];
}): string => {
  const websiteSource = getCrawlSource(params.crawlResult, "website");
  const naverSource = getCrawlSource(params.crawlResult, "naver_blog");
  const instagramSource = getCrawlSource(params.crawlResult, "instagram");
  const websiteData = toRecord(websiteSource.data);
  const naverData = toRecord(naverSource.data);
  const instagramData = toRecord(instagramSource.data);
  const websiteHeadings = parseStringArray(websiteData.headings, 6);
  const websiteParagraphs = parseStringArray(websiteData.paragraphs, 4);
  const naverPosts = parseStringArray(
    Array.isArray(naverData.recent_posts)
      ? naverData.recent_posts.map((entry) =>
          entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).title === "string"
            ? ((entry as Record<string, unknown>).title as string)
            : ""
        )
      : [],
    6
  );
  const instagramPosts = parseStringArray(
    Array.isArray(instagramData.recent_posts)
      ? instagramData.recent_posts.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return "";
          }
          const row = entry as Record<string, unknown>;
          if (typeof row.caption === "string") {
            return row.caption;
          }
          if (typeof row.title === "string") {
            return row.title;
          }
          return "";
        })
      : [],
    6
  );

  const websiteStatus = getCrawlSourceStatus(params.crawlResult, "website");
  const naverStatus = getCrawlSourceStatus(params.crawlResult, "naver_blog");
  const instagramStatus = getCrawlSourceStatus(params.crawlResult, "instagram");

  const websiteIssues: ReviewIssue[] = [];
  if (websiteStatus !== "done") {
    websiteIssues.push({
      issue: "웹사이트 데이터 수집이 제한되어 핵심 UX 진단 정확도가 낮습니다.",
      location: "전체 사이트",
      severity: "높음",
      suggestion: "사이트 접근 권한/차단 정책을 확인하고 핵심 페이지를 다시 수집하세요."
    });
  } else {
    if (websiteHeadings.length < 3) {
      websiteIssues.push({
        issue: "핵심 섹션 헤딩 수가 적어 정보 구조가 약하게 보입니다.",
        location: "메인/상위 섹션",
        severity: "중간",
        suggestion: "미션, 사업, 참여 안내 중심으로 명확한 섹션 헤딩을 추가하세요."
      });
    }
    if (!parseOptionalString(websiteData.meta_description)) {
      websiteIssues.push({
        issue: "메타 설명이 비어 있거나 약해 검색 노출 메시지가 불명확합니다.",
        location: "meta description",
        severity: "중간",
        suggestion: "조직 미션과 핵심 행동 유도를 포함한 110-140자 설명을 작성하세요."
      });
    }
    if (websiteParagraphs.length < 3) {
      websiteIssues.push({
        issue: "핵심 설명 문단이 부족하여 전문성 전달이 약합니다.",
        location: "메인 콘텐츠 영역",
        severity: "중간",
        suggestion: "성과 지표와 프로그램 사례 중심으로 핵심 설명 문단을 보강하세요."
      });
    }
  }

  const instagramIssues: ReviewIssue[] = [];
  if (instagramStatus === "failed") {
    instagramIssues.push({
      issue: "인스타그램 크롤링이 실패해 username-only fallback 상태입니다.",
      location: "인스타그램 채널",
      severity: "높음",
      suggestion: "공개 계정 여부, URL 형식, 접속 제한 여부를 점검한 후 재시도하세요."
    });
  } else if (instagramStatus === "partial") {
    instagramIssues.push({
      issue: "인스타그램은 공개 메타데이터만 부분 수집되어 게시물 단위 진단 범위가 제한됩니다.",
      location: "프로필/메타",
      severity: "중간",
      suggestion: "바이오, 링크, 대표 포스트 캡션에 핵심 메시지/CTA를 명시해 메타 기반 분석 품질을 높이세요."
    });
  } else if (instagramStatus === "skipped") {
    instagramIssues.push({
      issue: "인스타그램 URL이 미입력 상태로 채널별 정합성 분석 근거가 부족합니다.",
      location: "인스타그램 채널",
      severity: "중간",
      suggestion: "공개 프로필 URL을 입력해 교차 채널 일관성 검토 범위를 확대하세요."
    });
  } else {
    if (instagramPosts.length < 2) {
      instagramIssues.push({
        issue: "최근 게시물 표본이 적어 운영 톤/콘텐츠 패턴 판단의 정밀도가 낮습니다.",
        location: "최근 게시물",
        severity: "중간",
        suggestion: "캡션 구조(문제-근거-행동유도)를 표준화하고 핵심 게시물 표본을 확장하세요."
      });
    }
    if (!parseOptionalString(instagramData.biography) && !parseOptionalString(instagramData.meta_description)) {
      instagramIssues.push({
        issue: "바이오/메타 설명이 약해 기관 정체성과 행동 유도가 즉시 전달되지 않습니다.",
        location: "프로필 바이오",
        severity: "중간",
        suggestion: "기관 역할, 수혜 대상, CTA 링크 목적을 2-3줄로 압축해 반영하세요."
      });
    }
  }

  const naverIssues: ReviewIssue[] = [];
  if (naverStatus !== "done") {
    naverIssues.push({
      issue: "네이버 블로그 데이터 수집이 제한되어 최신 콘텐츠 전략 분석 정확도가 낮습니다.",
      location: "블로그 전체",
      severity: "높음",
      suggestion: "블로그 공개 범위와 접근 경로를 점검하고 재수집하세요."
    });
  } else {
    if (naverPosts.length < 3) {
      naverIssues.push({
        issue: "최근 노출된 게시물 표본이 적어 카테고리 전략 파악이 어렵습니다.",
        location: "최근 글 목록",
        severity: "중간",
        suggestion: "핵심 카테고리별 대표 글을 상단 고정 또는 요약 페이지로 연결하세요."
      });
    }
    if (!parseOptionalString(naverData.description)) {
      naverIssues.push({
        issue: "블로그 설명 문구가 약해 검색 유입 문맥이 부족합니다.",
        location: "블로그 소개/메타 설명",
        severity: "중간",
        suggestion: "기관 미션과 대상 독자를 포함한 설명 문구를 보강하세요."
      });
    }
  }

  const strengths = [
    params.profile.key_themes.length
      ? `웹/블로그 수집 데이터에서 ${params.profile.key_themes.slice(0, 3).join(", ")} 주제가 반복적으로 확인됩니다.`
      : "기관 활동 주제가 URL 입력과 인터뷰에서 비교적 일관되게 표현됩니다.",
    "온보딩 인터뷰를 통해 타깃, 금지어, 시즌성 정보가 구조화되어 초기 캠페인 가이드로 활용 가능합니다."
  ];

  const priorities = [
    "웹사이트 핵심 랜딩 메시지와 CTA를 미션 중심으로 재정렬",
    "네이버 블로그의 카테고리/SEO 설명을 강화해 검색 유입 개선",
    "인스타그램 프로필/게시물 메타 기준으로 채널 역할과 CTA 연결 구조를 표준화"
  ];

  const websiteSummary = websiteHeadings.length
    ? `확인된 주요 헤딩은 ${websiteHeadings.slice(0, 4).join(", ")} 입니다.`
    : "웹사이트 헤딩 데이터가 제한적이어서 정보 구조 판단에 제약이 있습니다.";
  const naverSummary = naverPosts.length
    ? `최근 노출 게시물 예시는 ${naverPosts.slice(0, 3).join(", ")} 입니다.`
    : "네이버 블로그 최근 게시물 데이터가 제한적입니다.";
  const instagramSummary =
    instagramStatus === "done"
      ? instagramPosts.length
        ? `최근 게시물 메타 샘플: ${instagramPosts.slice(0, 2).join(" / ")}`
        : "최근 게시물 메타가 제한되어 채널 톤 일관성 진단은 부분적으로 수행했습니다."
      : instagramStatus === "partial"
        ? "프로필 공개 메타만 확보되어 바이오/메타 중심으로 제한 분석했습니다."
        : instagramStatus === "failed"
          ? "수집 실패로 username-only fallback 상태이며, 인터뷰/타 채널 근거 중심으로 제한 분석했습니다."
          : "URL 미입력으로 인스타그램 채널 분석은 제외되었습니다.";

  return [
    `# 브랜드 리뷰: ${params.org.name}`,
    "",
    `**작성일:** ${new Date().toLocaleDateString("ko-KR")}`,
    "**검토 채널:** 웹사이트, 인스타그램, 네이버 블로그",
    "**리뷰 유형:** 종합 브랜드 감사 (Phase 1-7b)",
    `**데이터 수집 범위:** ${params.dataCoverageNotice}`,
    "",
    "---",
    "",
    "## 종합 요약",
    "",
    `**전체 평가:** ${params.profile.organization_summary}`,
    "",
    "**강점:**",
    ...strengths.map((row) => `- ${row}`),
    "",
    "**핵심 개선사항:**",
    ...priorities.map((row) => `- ${row}`),
    "",
    "---",
    "",
    "## 채널별 상세 분석",
    "",
    "### 1. 웹사이트",
    "",
    "#### 1-1. 구조 및 탐색성",
    toIssueTable(websiteIssues),
    "",
    "#### 1-2. 미션/비전 명확성",
    websiteSummary,
    `인터뷰 기준 톤 요구사항은 "${toInlineText(params.interviewAnswers.q1, "미입력")}"이며, 홈페이지 문구와 일치 여부를 중심으로 점검이 필요합니다.`,
    "",
    "#### 1-3. 콘텐츠 전문성",
    websiteParagraphs.length
      ? `수집된 본문 샘플: ${websiteParagraphs.slice(0, 2).join(" / ")}`
      : "본문 샘플이 제한되어 전문성 전달의 깊이를 정량 평가하기 어렵습니다.",
    "성과 수치, 사업 범위, 수혜자 증거를 포함한 정량형 문장을 핵심 페이지에 추가하는 것이 우선입니다.",
    "",
    "### 2. 인스타그램",
    "",
    "#### 2-1. 프로필 및 바이오",
    toIssueTable(instagramIssues),
    "",
    "#### 2-2. 명확성",
    instagramSummary,
    "",
    "#### 2-3. 일관성",
    "웹사이트/블로그의 핵심 메시지 축을 인스타그램 바이오/캡션 CTA와 동일한 문장 구조로 맞추는 운영 가이드가 필요합니다.",
    "",
    "#### 2-4. 전문성",
    "공개 데이터 기반 분석 특성상 반응률/비공개 지표 진단은 제한되며, 근거 가능한 범위에서 메시지 품질/일관성 중심으로 평가했습니다.",
    "",
    "### 3. 네이버 블로그",
    "",
    "#### 3-1. 프로필 및 구성",
    toIssueTable(naverIssues),
    "",
    "#### 3-2. 콘텐츠 전략",
    naverSummary,
    "정보성 글과 활동 후기 글의 역할을 분리해 카테고리별 기대효과를 명확히 설정하는 것이 필요합니다.",
    "",
    "#### 3-3. SEO 및 검색 최적화",
    "기관명 + 핵심 활동 키워드 조합으로 제목 템플릿을 표준화하고, 글 도입부에 미션 문장을 반복 배치하세요.",
    "",
    "---",
    "",
    "## 채널 간 브랜드 일관성 분석",
    "",
    "### 브랜드 톤 일관성",
    `현재 추정 톤은 **${params.profile.detected_tone}** 입니다. 웹/블로그 문구에서 동일 톤 유지 여부를 우선 점검해야 합니다.`,
    "",
    "### 핵심 메시지 일관성",
    params.profile.key_themes.length
      ? `핵심 테마(${params.profile.key_themes.slice(0, 4).join(", ")})를 채널별 핵심 문장으로 통일하면 메시지 편차를 줄일 수 있습니다.`
      : "핵심 테마 식별 데이터가 제한적이므로 채널별 핵심 메시지를 먼저 명시해야 합니다.",
    "",
    "### 채널별 역할 정의 현황",
    "- 웹사이트: 미션/신뢰 확보와 전환 CTA",
    "- 네이버 블로그: 검색 유입과 상세 스토리 축적",
    "- 인스타그램: 인지/참여 중심 요약 콘텐츠",
    "",
    "---",
    "",
    "## 법적 / 컴플라이언스 플래그",
    "",
    "| 플래그 | 상세 내용 | 권장 조치 |",
    "|--------|-----------|-----------|",
    "| 기관 책임 주체 표기 점검 필요 | NGO/소셜벤처 채널에서 운영 주체/문의 창구가 누락될 수 있습니다. | 웹/블로그/프로필에 운영 주체, 연락처, 개인정보 처리 안내 링크를 명시하세요. |",
    "| 공익 캠페인 표현 검증 필요 | 과장 표현 또는 검증되지 않은 수치 사용 시 신뢰도 저하 리스크가 있습니다. | 성과 수치 출처와 기준 시점을 문서화하고 동일하게 표기하세요. |",
    "| 제3자 초상/사례 활용 동의 관리 필요 | 현장 사진/사례 콘텐츠에서 동의 범위 불명확 시 분쟁 가능성이 있습니다. | 사례/이미지별 이용 동의 상태를 내부 체크리스트로 관리하세요. |",
    "",
    "---",
    "",
    "## 수정 제안 (주요 항목)",
    "",
    "### 웹사이트 — 메인 히어로 문구 현재:",
    "```",
    "우리 기관의 다양한 활동을 소개합니다.",
    "```",
    "",
    "### 웹사이트 — 메인 히어로 문구 수정안:",
    "```",
    `${params.org.name}는 [핵심 미션]을 위해 [주요 대상]과 함께 [핵심 성과]를 만드는 기관입니다. 지금 [행동 유도]에 참여하세요.`,
    "```",
    "",
    "**변경 사항:**",
    "- 미션, 대상, 성과, CTA를 한 문장에 통합",
    "- 방문자 첫 화면에서 기관 정체성과 행동 경로를 동시에 제시",
    "",
    "### 네이버 블로그 — 게시물 제목 현재:",
    "```",
    "활동 후기",
    "```",
    "",
    "### 네이버 블로그 — 게시물 제목 수정안:",
    "```",
    "[프로그램명] 참여 후기 | [지역/주제]에서 확인한 변화 3가지",
    "```",
    "",
    "**변경 사항:**",
    "- 검색 키워드와 구체 맥락(프로그램/지역/주제)을 결합",
    "- 제목만으로도 클릭 이유가 보이도록 구조화",
    "",
    "### 인스타그램 — 바이오 현재:",
    "```",
    "기관 소개 문구",
    "```",
    "",
    "### 인스타그램 — 바이오 수정안:",
    "```",
    `${params.org.name} | ${params.org.org_type}\n핵심 미션 한 줄 요약\n👇 자세한 활동 보기`,
    "```",
    "",
    "**변경 사항:**",
    "- 채널 역할(인지/유입)에 맞춰 짧은 메시지와 CTA 중심으로 재구성",
    "",
    "---",
    "",
    "## 2026년 통합 전략 제안",
    "",
    "1. 🟢쉬움: 웹사이트 상단 CTA 문구를 인터뷰 타깃 기준으로 A/B 테스트",
    "2. 🟡보통: 네이버 블로그 카테고리별 월간 편집 캘린더 운영",
    "3. 🟡보통: 채널 공통 해시태그/키워드 사전 구축 및 재사용",
    "4. 🔴어려움: 사례 콘텐츠의 성과 지표 표준 정의(채널 공통)",
    "5. 🟢쉬움: 금지어/금지주제 체크리스트를 발행 전 검수 단계에 적용",
    "",
    `*본 리뷰는 ${params.dataCoverageNotice}.`,
    `추가 한계: ${params.knownDataGaps.join(" ")}*`
  ].join("\n");
};

const buildBrandReviewPrompt = (params: {
  org: OrganizationContext;
  crawlResult: Record<string, unknown>;
  interviewAnswers: ReturnType<typeof defaultInterviewAnswers>;
  dataCoverageNotice: string;
  knownDataGaps: string[];
}): { systemPrompt: string; userPrompt: string } => {
  const systemPrompt = [
    "당신은 한국 NGO·소셜벤처·사회적기업 전문 디지털 마케팅 컨설턴트입니다.",
    "10년 이상의 경험을 바탕으로 온라인 채널 감사, 브랜드 전략 수립, 콘텐츠 마케팅을 전문으로 합니다.",
    "",
    "작성 원칙:",
    "- 구체적인 수치와 예시를 가능한 한 포함",
    "- 모호한 표현 대신 실행 가능한 제안",
    "- 한국 NGO/소셜벤처 특수성 반영 (제한된 예산, 소규모 팀, 공익적 미션)",
    "- 수정 제안 포함",
    "",
    "웹서치 활용 원칙:",
    "- 크롤링 데이터가 부족한 채널은 웹서치를 활용해 공개된 정보를 보충하세요",
    "- 기관명, SNS 계정명으로 검색하여 최신 활동, 평판, 콘텐츠 현황을 확인하세요",
    "- 검색 결과를 사실 기반 분석에 반영하세요"
  ].join("\n");

  const websiteSource = getCrawlSource(params.crawlResult, "website");
  const naverSource = getCrawlSource(params.crawlResult, "naver_blog");
  const instagramSource = getCrawlSource(params.crawlResult, "instagram");

  const userPrompt = [
    "다음 기관의 온라인 채널을 종합 감사하고 전문적인 브랜드 리뷰 보고서를 작성해주세요.",
    "",
    "## 기관 정보",
    `- 기관명: ${params.org.name}`,
    `- 기관 유형: ${params.org.org_type}`,
    `- 웹사이트: ${params.org.website ?? "미입력"}`,
    "",
    "## 크롤링 데이터",
    "### 웹사이트",
    toPromptJson(websiteSource),
    "",
    "### 네이버 블로그",
    toPromptJson(naverSource),
    "",
    "### 인스타그램",
    toPromptJson(instagramSource),
    "",
    "## 인터뷰 답변",
    `- 톤: ${params.interviewAnswers.q1 || "미입력"}`,
    `- 타깃 오디언스: ${params.interviewAnswers.q2 || "미입력"}`,
    `- 금지 단어/주제: ${params.interviewAnswers.q3 || "미입력"}`,
    `- 캠페인 시즌: ${params.interviewAnswers.q4 || "미입력"}`,
    "",
    "## 데이터 범위/한계",
    `- ${params.dataCoverageNotice}`,
    ...params.knownDataGaps.map((gap) => `- ${gap}`),
    "",
    "## 출력 규칙",
    "- 반드시 한국어 마크다운으로 작성",
    "- 아래 섹션 순서를 참고하되 자유롭게 작성",
    "- 채널별 수정 제안을 최소 1개 이상 포함",
    "- 2026년 핵심 전략 제안 포함",
    "- 가장 시급한 항목은 난이도(높음) 표시",
    "- 문서가 끊기지 않도록 마지막 문장까지 완성",
    "- 크롤링 데이터가 부족한 부분은 웹서치를 통해 추가 정보를 확인한 뒤 분석에 반영",
    "",
    "## 권장 섹션 순서",
    "1) # 브랜드 리뷰: [기관명]",
    "2) ## 종합 요약",
    "3) ## 채널별 상세 분석",
    "4) ## 채널 간 브랜드 일관성 분석",
    "5) ## 수정 제안",
    "6) ## 2026년 전략 제안",
    "",
    "인스타그램은 best-effort 수집 결과(done/partial/failed/skipped)를 그대로 반영하고, partial/failed/skipped일 때는 한계와 대체 근거를 명시하세요."
  ].join("\n");

  return {
    systemPrompt,
    userPrompt
  };
};

const normalizeGeneratedReviewMarkdown = (value: string): string => {
  const trimmed = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return "";
  }
  const titleIndex = trimmed.indexOf("# 브랜드 리뷰:");
  if (titleIndex >= 0) {
    return trimmed.slice(titleIndex).trim();
  }
  return trimmed;
};

const validateReviewMarkdown = (value: string): { ok: boolean; reasons: string[]; normalized: string } => {
  const normalized = normalizeGeneratedReviewMarkdown(value);
  const reasons: string[] = [];

  if (!normalized) {
    reasons.push("empty_markdown");
    return { ok: false, reasons, normalized };
  }

  if (normalized.length < 300) {
    reasons.push("too_short");
    return { ok: false, reasons, normalized };
  }

  return { ok: true, reasons, normalized };
};

const buildReviewRegenerationPrompt = (params: {
  baseUserPrompt: string;
  validationReasons: string[];
  previousDraft: string;
}): string => {
  const previousDraft = truncateText(params.previousDraft, 6000);
  const reasonText = params.validationReasons.length ? params.validationReasons.join(", ") : "unknown";
  return [
    params.baseUserPrompt,
    "",
    "## 중요: 이전 초안은 무효입니다. 처음부터 끝까지 전체 문서를 재작성하세요.",
    `- 무효 사유: ${reasonText}`,
    "- 필수 섹션 7개를 모두 포함하세요.",
    "- 코드블록(```)은 반드시 짝수 개로 닫으세요.",
    "- 문서 중간에서 끊기지 않도록 마지막 문장까지 완성하세요.",
    "- 길이는 과도하게 길지 않게 유지하되, 각 섹션 핵심 내용은 반드시 포함하세요.",
    "",
    "## 이전 실패 초안(참고용, 그대로 복사 금지)",
    previousDraft
  ].join("\n");
};

const generateReviewMarkdown = async (params: {
  org: OrganizationContext;
  crawlResult: Record<string, unknown>;
  interviewAnswers: ReturnType<typeof defaultInterviewAnswers>;
  fallbackProfile: SynthesizedProfile;
  dataCoverageNotice: string;
  knownDataGaps: string[];
}): Promise<{ markdown: string; trace: Record<string, unknown> }> => {
  const prompt = buildBrandReviewPrompt({
    org: params.org,
    crawlResult: params.crawlResult,
    interviewAnswers: params.interviewAnswers,
    dataCoverageNotice: params.dataCoverageNotice,
    knownDataGaps: params.knownDataGaps
  });

  const firstCall = await callAnthropicText({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    maxTokens: 10000
  });
  const firstValidation = validateReviewMarkdown(firstCall.text ?? "");
  if (firstValidation.ok) {
    return {
      markdown: firstValidation.normalized,
      trace: {
        selected_attempt: "first",
        fallback_used: false,
        attempts: [
          {
            attempt: "first",
            call: firstCall.trace,
            validation: {
              ok: firstValidation.ok,
              reasons: firstValidation.reasons
            }
          }
        ]
      }
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 15_000));

  const regenerationPrompt = buildReviewRegenerationPrompt({
    baseUserPrompt: prompt.userPrompt,
    validationReasons: firstValidation.reasons,
    previousDraft: firstValidation.normalized
  });
  const secondCall = await callAnthropicText({
    systemPrompt: prompt.systemPrompt,
    userPrompt: regenerationPrompt,
    maxTokens: 12000
  });
  const secondValidation = validateReviewMarkdown(secondCall.text ?? "");
  if (secondValidation.ok) {
    return {
      markdown: secondValidation.normalized,
      trace: {
        selected_attempt: "second",
        fallback_used: false,
        attempts: [
          {
            attempt: "first",
            call: firstCall.trace,
            validation: {
              ok: firstValidation.ok,
              reasons: firstValidation.reasons
            }
          },
          {
            attempt: "second",
            call: secondCall.trace,
            validation: {
              ok: secondValidation.ok,
              reasons: secondValidation.reasons
            }
          }
        ]
      }
    };
  }

  console.warn(
    `[Onboarding] Review markdown validation failed; using fallback. first=[${
      firstValidation.reasons.join(", ") || "unknown"
    }], second=[${secondValidation.reasons.join(", ") || "unknown"}]`
  );

  const fallbackMarkdown = buildFallbackReviewMarkdown({
    org: params.org,
    crawlResult: params.crawlResult,
    interviewAnswers: params.interviewAnswers,
    profile: params.fallbackProfile,
    dataCoverageNotice: params.dataCoverageNotice,
    knownDataGaps: params.knownDataGaps
  });
  return {
    markdown: fallbackMarkdown,
    trace: {
      selected_attempt: "fallback_template",
      fallback_used: true,
      fallback_reason: "review_markdown_validation_failed",
      attempts: [
        {
          attempt: "first",
          call: firstCall.trace,
          validation: {
            ok: firstValidation.ok,
            reasons: firstValidation.reasons
          }
        },
        {
          attempt: "second",
          call: secondCall.trace,
          validation: {
            ok: secondValidation.ok,
            reasons: secondValidation.reasons
          }
        }
      ]
    }
  };
};

const extractProfileFromReview = async (params: {
  reviewMarkdown: string;
  fallbackProfile: SynthesizedProfile;
  knownDataGaps: string[];
}): Promise<{ profile: SynthesizedProfile; trace: Record<string, unknown> }> => {
  const systemPrompt = [
    "Extract a strict JSON object for onboarding brand profile.",
    "Return JSON only and keep values concise.",
    "Never include markdown fences."
  ].join("\n");
  const userPrompt = [
    "Extract profile fields from this Korean review markdown.",
    "Required keys:",
    "{",
    '  "organization_summary": string,',
    '  "detected_tone": string,',
    '  "tone_guardrails": string[],',
    '  "key_themes": string[],',
    '  "target_audience": string[],',
    '  "forbidden_words": string[],',
    '  "forbidden_topics": string[],',
    '  "campaign_seasons": string[],',
    '  "content_directions": string[],',
    '  "confidence_notes": string[]',
    "}",
    "",
    truncateText(params.reviewMarkdown, 24_000)
  ].join("\n");

  const extracted = await callOpenAiJson({
    systemPrompt,
    userPrompt
  });
  if (!extracted.parsed) {
    return {
      profile: {
        ...params.fallbackProfile,
        confidence_notes: [...params.fallbackProfile.confidence_notes, "Used fallback profile extraction."]
      },
      trace: {
        source: "fallback_profile",
        used_fallback: true,
        extraction_call: extracted.trace
      }
    };
  }

  const normalized = normalizeBrandProfile(extracted.parsed, params.fallbackProfile);
  const confidence = [...normalized.confidence_notes];
  if (!confidence.length) {
    confidence.push("Structured profile extracted from generated markdown.");
  }
  if (params.knownDataGaps.length) {
    confidence.push("Profile includes constraints from partial crawl coverage.");
  }
  const finalProfile = {
    ...normalized,
    confidence_notes: confidence.slice(0, 12)
  };
  return {
    profile: finalProfile,
    trace: {
      source: "openai_extraction",
      used_fallback: false,
      extraction_call: extracted.trace,
      extracted_profile_preview: {
        organization_summary: finalProfile.organization_summary,
        detected_tone: finalProfile.detected_tone,
        key_themes: finalProfile.key_themes,
        target_audience: finalProfile.target_audience,
        confidence_notes: finalProfile.confidence_notes
      }
    }
  };
};

export const onboardingRouter: Router = Router();

onboardingRouter.post("/onboarding/bootstrap-org", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const inputName = parseOptionalString(body.name);
    await ensureUserProfile({
      userId: user.userId,
      email: user.email,
      name: inputName ?? user.name
    });

    const existing = await getExistingMembership(user.userId);
    if (existing?.org_id) {
      const entitlement = await getOrgEntitlement(existing.org_id);
      res.json({
        ok: true,
        created: false,
        org: {
          id: existing.org_id,
          name: existing.organizations?.name ?? "Organization",
          org_type: existing.organizations?.org_type ?? "nonprofit"
        },
        membership: {
          role: existing.role
        },
        entitlement
      });
      return;
    }

    const created = await createInitialOrg({
      userId: user.userId,
      orgName: resolveOrgName(body.org_name, user.email)
    });
    const entitlement = await getOrgEntitlement(created.orgId);

    res.json({
      ok: true,
      created: true,
      org: {
        id: created.orgId,
        name: created.orgName,
        org_type: created.orgType
      },
      membership: {
        role: "owner"
      },
      entitlement
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

onboardingRouter.post("/onboarding/interview", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = parseObject(req.body, "body");
    parseJsonSize(body, "body");

    const orgId = parseRequiredString(body.org_id, "org_id", 120);
    await requireOrgMembership(user.userId, orgId);
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }
    const interviewAnswers = parseInterviewAnswers(body.interview_answers);

    const { error } = await supabaseAdmin.from("org_brand_settings").upsert(
      {
        org_id: orgId,
        interview_answers: interviewAnswers,
        rag_ingestion_status: "pending",
        rag_ingestion_started_at: null,
        rag_ingestion_error: null
      },
      {
        onConflict: "org_id"
      }
    );
    if (error) {
      throw new HttpError(500, "db_error", `Failed to upsert interview answers: ${error.message}`);
    }

    res.json({
      ok: true,
      org_id: orgId,
      interview_answers: interviewAnswers
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

// ── Historical Content Persistence (Phase 1-7 Patch) ──────────────────────

function normalizeToTimestamptz(raw: string): string | null {
  if (!raw) return null;

  // Unix timestamp (number or numeric string)
  const asNum = Number(raw);
  if (!isNaN(asNum) && asNum > 1_000_000_000 && asNum < 2_000_000_000) {
    return new Date(asNum * 1000).toISOString();
  }

  // ISO string or other parseable date
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Korean date format "2025.12.03." or "2025-12-03"
  const korean = raw.replace(/\./g, "-").replace(/-$/, "");
  const koreanDate = new Date(korean);
  if (!isNaN(koreanDate.getTime())) {
    return koreanDate.toISOString();
  }

  return null;
}

type HistoricalPost = {
  org_id: string;
  channel: string;
  content_type: string;
  status: "historical";
  body: string;
  metadata: Record<string, unknown>;
  published_at: string | null;
  created_by: "onboarding_crawl";
};

function extractHistoricalPosts(
  orgId: string,
  crawlResult: Record<string, unknown>
): HistoricalPost[] {
  const posts: HistoricalPost[] = [];
  const sources = toRecord(crawlResult.sources);

  // ── Naver Blog Posts ──
  const naverSource = toRecord(sources.naver_blog);
  const naverStatus = parseOptionalString(naverSource.status);
  const naverData = toRecord(naverSource.data);

  if (
    (naverStatus === "done" || naverStatus === "partial") &&
    Array.isArray(naverData.recent_posts)
  ) {
    for (const post of naverData.recent_posts) {
      if (!post || typeof post !== "object") continue;
      const row = post as Record<string, unknown>;

      const title = parseOptionalString(row.title) ?? "";
      const snippet =
        parseOptionalString(row.content_snippet) ??
        parseOptionalString(row.summary) ??
        "";
      const body = [title, snippet].filter(Boolean).join("\n\n").trim();
      if (body.length < 20) continue;

      const url =
        parseOptionalString(row.url) ?? parseOptionalString(row.link) ?? null;
      const publishedAt =
        parseOptionalString(row.publish_date) ??
        parseOptionalString(row.date) ??
        null;

      posts.push({
        org_id: orgId,
        channel: "naver_blog",
        content_type: "text",
        status: "historical",
        body,
        metadata: {
          origin: "onboarding_crawl",
          original_url: url,
          original_title: title,
          crawl_source: "naver_blog",
          has_engagement: row.comment_count
            ? Number(row.comment_count) > 0
            : null,
        },
        published_at: publishedAt ? normalizeToTimestamptz(publishedAt) : null,
        created_by: "onboarding_crawl",
      });
    }
  }

  // ── Instagram Posts ──
  const igSource = toRecord(sources.instagram);
  const igStatus = parseOptionalString(igSource.status);
  const igData = toRecord(igSource.data);

  if (
    (igStatus === "done" || igStatus === "partial") &&
    Array.isArray(igData.recent_posts)
  ) {
    for (const post of igData.recent_posts) {
      if (!post || typeof post !== "object") continue;
      const row = post as Record<string, unknown>;

      const caption = parseOptionalString(row.caption) ?? "";
      if (caption.length < 10) continue;

      const permalink =
        parseOptionalString(row.permalink) ??
        parseOptionalString(row.url) ??
        null;
      const timestamp = parseOptionalString(row.timestamp) ?? null;
      const mediaType = parseOptionalString(row.media_type) ?? null;

      posts.push({
        org_id: orgId,
        channel: "instagram",
        content_type: mediaType === "VIDEO" ? "video" : "text",
        status: "historical",
        body: caption,
        metadata: {
          origin: "onboarding_crawl",
          original_url: permalink,
          crawl_source: "instagram",
          like_count:
            typeof row.like_count === "number" ? row.like_count : null,
          comment_count:
            typeof row.comment_count === "number" ? row.comment_count : null,
          media_type: mediaType,
          shortcode: parseOptionalString(row.shortcode) ?? null,
        },
        published_at: timestamp ? normalizeToTimestamptz(timestamp) : null,
        created_by: "onboarding_crawl",
      });
    }
  }

  return posts;
}

async function persistHistoricalContent(
  orgId: string,
  crawlResult: Record<string, unknown>
): Promise<{ inserted: number; deleted: number }> {
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("contents")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "historical")
    .eq("created_by", "onboarding_crawl")
    .limit(5000);

  if (existingError) {
    console.warn(`[HISTORICAL_CONTENT] Failed to query existing rows for org ${orgId}: ${existingError.message}`);
  }

  const existingIds = (Array.isArray(existingRows) ? existingRows : [])
    .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
    .filter(Boolean);

  // Clear previous crawl-imported content for this org (re-onboarding safety).
  const { count: deleted } = await supabaseAdmin
    .from("contents")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .eq("status", "historical")
    .eq("created_by", "onboarding_crawl");

  if (existingIds.length) {
    for (let index = 0; index < existingIds.length; index += 200) {
      const batch = existingIds.slice(index, index + 200);
      const { error: embeddingDeleteError } = await supabaseAdmin
        .from("org_rag_embeddings")
        .delete()
        .eq("org_id", orgId)
        .eq("source_type", "content")
        .in("source_id", batch);
      if (embeddingDeleteError) {
        console.warn(
          `[HISTORICAL_CONTENT] Failed to delete stale content embeddings for org ${orgId}: ${embeddingDeleteError.message}`
        );
      }
    }
  }

  const posts = extractHistoricalPosts(orgId, crawlResult);
  if (posts.length === 0) {
    console.log(
      `[HISTORICAL_CONTENT] No posts extracted for org ${orgId} (deleted ${deleted ?? 0} old)`
    );
    return { inserted: 0, deleted: deleted ?? 0 };
  }

  const { error } = await supabaseAdmin.from("contents").insert(posts);

  if (error) {
    console.error(
      `[HISTORICAL_CONTENT] Insert failed for org ${orgId}: ${error.message}`
    );
    return { inserted: 0, deleted: deleted ?? 0 };
  }

  console.log(
    `[HISTORICAL_CONTENT] Inserted ${posts.length} posts for org ${orgId} (deleted ${deleted ?? 0} old)`
  );
  return { inserted: posts.length, deleted: deleted ?? 0 };
}

// ── End Historical Content Persistence ────────────────────────────────────

onboardingRouter.post("/onboarding/synthesize", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = parseObject(req.body, "body");
    parseJsonSize(body, "body");

    const orgId = parseRequiredString(body.org_id, "org_id", 120);
    await requireOrgMembership(user.userId, orgId);
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const crawlResult = parseObject(body.crawl_result, "crawl_result");
    parseJsonSize(crawlResult, "crawl_result", MAX_JSON_LENGTH);
    const interviewAnswers = parseInterviewAnswers(body.interview_answers);

    const urlMetadata =
      body.url_metadata && typeof body.url_metadata === "object" && !Array.isArray(body.url_metadata)
        ? (body.url_metadata as Record<string, unknown>)
        : {};
    const synthesisMode = normalizeSynthesisMode(body.synthesis_mode);

    const fallbackSynthesis = synthesizeProfile({
      crawlResult,
      interviewAnswers,
      orgId
    });
    const orgContext =
      (await getOrganizationContext(orgId)) ??
      ({
        id: orgId,
        name: "Organization",
        org_type: "nonprofit",
        website: parseOptionalString(urlMetadata.website_url ?? body.website_url)
      } as OrganizationContext);
    const dataCoverageNotice = buildDataCoverageNotice(crawlResult);
    const knownDataGaps = collectKnownDataGaps(crawlResult, interviewAnswers);

    const pinnedReview = loadPinnedReviewMarkdown();
    const reviewGeneration = pinnedReview
      ? {
          markdown: pinnedReview.markdown,
          trace: {
            selected_attempt: "pinned_review_file",
            fallback_used: false,
            source_path: pinnedReview.sourcePath,
            template_ref: REVIEW_TEMPLATE_REF
          }
        }
      : await generateReviewMarkdown({
          org: orgContext,
          crawlResult,
          interviewAnswers,
          fallbackProfile: fallbackSynthesis.profile,
          dataCoverageNotice,
          knownDataGaps
        });
    const reviewMarkdown = reviewGeneration.markdown;

    const profileExtraction = await extractProfileFromReview({
      reviewMarkdown,
      fallbackProfile: fallbackSynthesis.profile,
      knownDataGaps
    });
    const profile = profileExtraction.profile;
    const synthesisDebug = {
      review_generation: reviewGeneration.trace,
      profile_extraction: profileExtraction.trace
    };

    const document = buildOnboardingDocument({
      profile,
      knownDataGaps,
      reviewMarkdown,
      dataCoverageNotice,
      reportVersion: synthesisMode,
      synthesisDebug
    });

    const crawlSources = parseObject(crawlResult.sources ?? {}, "crawl_result.sources");
    const crawlStatus = {
      state: parseOptionalString(crawlResult.state) ?? "done",
      started_at: parseOptionalString(crawlResult.started_at),
      finished_at: parseOptionalString(crawlResult.finished_at),
      sources: {
        website: {
          status: parseOptionalString((crawlSources.website as Record<string, unknown> | undefined)?.status) ?? "unknown",
          error: parseOptionalString((crawlSources.website as Record<string, unknown> | undefined)?.error)
        },
        naver_blog: {
          status:
            parseOptionalString((crawlSources.naver_blog as Record<string, unknown> | undefined)?.status) ?? "unknown",
          error: parseOptionalString((crawlSources.naver_blog as Record<string, unknown> | undefined)?.error)
        },
        instagram: {
          status: parseOptionalString((crawlSources.instagram as Record<string, unknown> | undefined)?.status) ?? "unknown",
          error: parseOptionalString((crawlSources.instagram as Record<string, unknown> | undefined)?.error)
        }
      }
    };

    const payloadForStore = {
      org_id: orgId,
      website_url: parseOptionalUrl(urlMetadata.website_url ?? body.website_url),
      naver_blog_url: parseOptionalUrl(urlMetadata.naver_blog_url ?? body.naver_blog_url),
      instagram_url: parseOptionalUrl(urlMetadata.instagram_url ?? body.instagram_url),
      facebook_url: parseOptionalUrl(urlMetadata.facebook_url ?? body.facebook_url),
      youtube_url: parseOptionalUrl(urlMetadata.youtube_url ?? body.youtube_url),
      threads_url: parseOptionalUrl(urlMetadata.threads_url ?? body.threads_url),
      crawl_status: crawlStatus,
      crawl_payload: crawlResult,
      interview_answers: interviewAnswers,
      detected_tone: profile.detected_tone,
      tone_description: profile.tone_guardrails.join(" "),
      target_audience: profile.target_audience,
      key_themes: profile.key_themes,
      forbidden_words: profile.forbidden_words,
      forbidden_topics: profile.forbidden_topics,
      campaign_seasons: profile.campaign_seasons,
      brand_summary: profile.organization_summary,
      rag_ingestion_status: "pending",
      rag_ingestion_started_at: null,
      rag_ingestion_error: null,
      result_document: {
        ...document,
        synthesis_mode: synthesisMode
      }
    };
    parseJsonSize(payloadForStore, "synthesis_store_payload", MAX_JSON_LENGTH);

    const { error } = await supabaseAdmin.from("org_brand_settings").upsert(payloadForStore, {
      onConflict: "org_id"
    });
    if (error) {
      throw new HttpError(500, "db_error", `Failed to upsert org brand settings: ${error.message}`);
    }

    res.json({
      ok: true,
      org_id: orgId,
      brand_profile: profile,
      onboarding_result_document: {
        ...document,
        synthesis_mode: synthesisMode
      },
      review_markdown: reviewMarkdown,
      synthesis_debug: synthesisDebug
    });

    // Persist and backfill historical content embeddings (fire-and-forget).
    void (async () => {
      const persisted = await persistHistoricalContent(orgId, crawlResult);
      if (persisted.inserted <= 0) {
        return;
      }

      const backfill = await embedAllPendingContent(orgId, {
        batchLimit: 100,
        maxBatches: 50
      });

      console.log(
        `[CONTENT_BACKFILL] org=${orgId}, inserted=${persisted.inserted}, embedded=${backfill.embedded_count}, failed=${backfill.failed_count}, remaining=${backfill.remaining}`
      );
    })().catch((err) => {
      console.warn(
        `[Onboarding] Historical content persistence/backfill failed for org ${orgId}: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    });

    void enqueueRagIngestion(orgId).catch((queueError) => {
      console.warn(
        `[Onboarding] Failed to enqueue RAG ingestion for org ${orgId}: ${
          queueError instanceof Error ? queueError.message : String(queueError)
        }`
      );
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
