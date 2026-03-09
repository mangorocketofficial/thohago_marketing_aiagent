import crypto from "node:crypto";
import type { AccumulatedInsights, Campaign, LatestAnalysisSummary, MemoryMd, OrgBrandSettings } from "@repo/types";
import { countTokens } from "./token-counter";

const DEFAULT_MEMORY_TOKEN_BUDGET = 2000;
const UNKNOWN_TEXT = "미설정";

type SectionBlock = {
  key: string;
  priority: number;
  required: boolean;
  content: string;
  compactContent?: string | null;
};

type BuildMemoryOptions = {
  generatedAt?: string;
  tokenBudget?: number;
};

const isPopulatedObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const readStringRecord = (value: unknown): Record<string, string> => {
  if (!isPopulatedObject(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim() || typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    output[key] = entry;
  }
  return output;
};

const cleanList = (items: string[] | null | undefined): string[] =>
  Array.isArray(items)
    ? items
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];

const toLine = (items: string[] | null | undefined): string => {
  const rows = cleanList(items);
  return rows.length ? rows.join(", ") : UNKNOWN_TEXT;
};

const normalizeInsights = (value: AccumulatedInsights | null | Record<string, unknown>): AccumulatedInsights | null => {
  if (!isPopulatedObject(value)) {
    return null;
  }

  const bestPublishTimes = readStringRecord(value.best_publish_times);
  const channelRecommendations = readStringRecord(value.channel_recommendations);
  const topCtaPhrases = Array.isArray(value.top_cta_phrases)
    ? value.top_cta_phrases
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
  const contentPatternSummary =
    typeof value.content_pattern_summary === "string" ? value.content_pattern_summary.trim() : "";
  const userEditPreferenceSummary =
    typeof value.user_edit_preference_summary === "string" ? value.user_edit_preference_summary.trim() : "";
  const generatedAt = typeof value.generated_at === "string" ? value.generated_at.trim() : "";
  const contentCountRaw = value.content_count_at_generation;
  const contentCount = typeof contentCountRaw === "number" && Number.isFinite(contentCountRaw) ? contentCountRaw : 0;

  if (!generatedAt) {
    return null;
  }

  return {
    best_publish_times: bestPublishTimes,
    top_cta_phrases: topCtaPhrases,
    content_pattern_summary: contentPatternSummary,
    channel_recommendations: channelRecommendations,
    user_edit_preference_summary: userEditPreferenceSummary,
    generated_at: generatedAt,
    content_count_at_generation: contentCount
  };
};

const shortenToSentences = (value: string, maxSentences = 2): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const sentences = trimmed
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) {
    return trimmed;
  }

  return sentences
    .slice(0, maxSentences)
    .join(" ")
    .trim();
};

const formatCampaignLine = (campaign: Campaign): string =>
  `- ${campaign.title} (${campaign.status}) / 채널: ${campaign.channels.join(", ") || UNKNOWN_TEXT}`;

const buildCampaignSection = (campaigns: Campaign[], limit?: number): string => {
  const rows = typeof limit === "number" ? campaigns.slice(0, limit) : campaigns;
  const lines = ["## 단기 메모리", "", "### 진행 중 캠페인"];
  if (!rows.length) {
    lines.push("현재 진행 중인 캠페인이 없습니다.");
  } else {
    lines.push(...rows.map(formatCampaignLine));
  }
  lines.push("");
  return lines.join("\n");
};

const buildInsightsSection = (insights: AccumulatedInsights, compact = false): string => {
  const lines = ["## 누적 인사이트", ""];

  const bestTimesEntries = Object.entries(insights.best_publish_times);
  if (bestTimesEntries.length) {
    lines.push("### 최적 발행 시간대");
    for (const [channel, time] of bestTimesEntries) {
      lines.push(`- ${channel}: ${time}`);
    }
    lines.push("");
  }

  const ctaLimit = compact ? 3 : 5;
  if (insights.top_cta_phrases.length) {
    lines.push("### 고성과 CTA 문구");
    for (const cta of insights.top_cta_phrases.slice(0, ctaLimit)) {
      lines.push(`- "${cta}"`);
    }
    lines.push("");
  }

  if (insights.content_pattern_summary) {
    lines.push("### 콘텐츠 성과 패턴");
    lines.push(compact ? shortenToSentences(insights.content_pattern_summary, 1) : insights.content_pattern_summary);
    lines.push("");
  }

  const recommendationEntries = Object.entries(insights.channel_recommendations);
  if (recommendationEntries.length && !compact) {
    lines.push("### 채널 추천");
    for (const [channel, recommendation] of recommendationEntries) {
      lines.push(`- ${channel}: ${recommendation}`);
    }
    lines.push("");
  }

  if (insights.user_edit_preference_summary) {
    lines.push("### 사용자 수정 선호");
    lines.push(compact ? shortenToSentences(insights.user_edit_preference_summary, 1) : insights.user_edit_preference_summary);
    lines.push("");
  }

  return lines.join("\n");
};

const buildLatestAnalysisSection = (analysis: LatestAnalysisSummary, compact = false): string => {
  const actions = compact ? analysis.key_actions.slice(0, 2) : analysis.key_actions;
  const lines = ["## Latest Performance Analysis", ""];

  lines.push(compact ? shortenToSentences(analysis.summary, 2) : analysis.summary);
  lines.push("");
  if (actions.length) {
    lines.push("### Key Actions");
    for (const action of actions) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  lines.push(`> Analyzed at: ${analysis.analyzed_at}`);
  return lines.join("\n");
};

const buildSectionBlocks = (
  brandSettings: OrgBrandSettings,
  activeCampaigns: Campaign[],
  insights: AccumulatedInsights | null,
  latestAnalysis: LatestAnalysisSummary | null
): SectionBlock[] => {
  const blocks: SectionBlock[] = [
    {
      key: "header",
      priority: 9,
      required: true,
      content: "# 마케팅 메모리\n\n## 장기 메모리"
    }
  ];

  if (brandSettings.brand_summary?.trim()) {
    const full = `### 기관 개요\n${brandSettings.brand_summary.trim()}`;
    const compact = shortenToSentences(brandSettings.brand_summary, 2);
    blocks.push({
      key: "brand_summary",
      priority: 1,
      required: false,
      content: full,
      compactContent: compact ? `### 기관 개요\n${compact}` : null
    });
  }

  blocks.push({
    key: "tone",
    priority: 7,
    required: false,
    content: [
      "### 브랜드 보이스",
      `- 톤: ${brandSettings.detected_tone?.trim() || UNKNOWN_TEXT}`,
      brandSettings.tone_description?.trim() ? `- 설명: ${brandSettings.tone_description.trim()}` : null
    ]
      .filter(Boolean)
      .join("\n")
  });

  if (cleanList(brandSettings.forbidden_words).length || cleanList(brandSettings.forbidden_topics).length) {
    const lines = ["### 금지 목록 (절대 사용 금지)"];
    const forbiddenWords = cleanList(brandSettings.forbidden_words);
    const forbiddenTopics = cleanList(brandSettings.forbidden_topics);
    if (forbiddenWords.length) {
      lines.push(`- 금지 단어: ${forbiddenWords.join(", ")}`);
    }
    if (forbiddenTopics.length) {
      lines.push(`- 금지 주제: ${forbiddenTopics.join(", ")}`);
    }
    blocks.push({
      key: "forbidden",
      priority: 8,
      required: true,
      content: lines.join("\n")
    });
  }

  blocks.push({
    key: "target_audience",
    priority: 4,
    required: false,
    content: `### 타겟 오디언스\n${toLine(brandSettings.target_audience)}`
  });

  blocks.push({
    key: "key_themes",
    priority: 3,
    required: false,
    content: `### 핵심 테마\n${toLine(brandSettings.key_themes)}`
  });

  const campaignSection = buildCampaignSection(activeCampaigns);
  blocks.push({
    key: "active_campaigns",
    priority: 5,
    required: false,
    content: campaignSection,
    compactContent: buildCampaignSection(activeCampaigns, 3)
  });

  const seasons = cleanList(brandSettings.campaign_seasons);
  if (seasons.length) {
    blocks.push({
      key: "campaign_seasons",
      priority: 2,
      required: false,
      content: `### 주요 캠페인 시즌\n${seasons.join(", ")}`
    });
  }

  if (insights) {
    blocks.push({
      key: "insights",
      priority: 6,
      required: false,
      content: buildInsightsSection(insights, false),
      compactContent: buildInsightsSection(insights, true)
    });
  }

  if (latestAnalysis) {
    blocks.push({
      key: "latest_analysis",
      priority: 6,
      required: false,
      content: buildLatestAnalysisSection(latestAnalysis, false),
      compactContent: buildLatestAnalysisSection(latestAnalysis, true)
    });
  }

  return blocks;
};

const assembleBlocks = (blocks: SectionBlock[]): string =>
  blocks
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

const applyPriorityTruncation = (blocks: SectionBlock[], tokenBudget: number): string => {
  const working = blocks.map((block) => ({ ...block }));
  const sorted = [...working].sort((left, right) => left.priority - right.priority);

  for (const candidate of sorted) {
    const current = assembleBlocks(working);
    if (countTokens(current) <= tokenBudget) {
      break;
    }
    if (candidate.required) {
      continue;
    }

    const target = working.find((entry) => entry.key === candidate.key);
    if (!target) {
      continue;
    }

    if (target.compactContent && target.compactContent !== target.content) {
      target.content = target.compactContent;
      continue;
    }

    const index = working.findIndex((entry) => entry.key === candidate.key);
    if (index >= 0) {
      working.splice(index, 1);
    }
  }

  return assembleBlocks(working);
};

const toCampaignSnapshot = (campaigns: Campaign[]) =>
  campaigns
    .map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      channels: [...campaign.channels],
      updated_at: campaign.updated_at
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

export const computeMemoryFreshnessKey = (
  brandSettings: OrgBrandSettings,
  activeCampaigns: Campaign[],
  insights: AccumulatedInsights | null,
  latestAnalysis: LatestAnalysisSummary | null
): string => {
  const payload = {
    brand_summary: brandSettings.brand_summary ?? "",
    detected_tone: brandSettings.detected_tone ?? "",
    tone_description: brandSettings.tone_description ?? "",
    forbidden_words: cleanList(brandSettings.forbidden_words),
    forbidden_topics: cleanList(brandSettings.forbidden_topics),
    target_audience: cleanList(brandSettings.target_audience),
    key_themes: cleanList(brandSettings.key_themes),
    campaign_seasons: cleanList(brandSettings.campaign_seasons),
    campaigns: toCampaignSnapshot(activeCampaigns),
    insights: insights
      ? {
          best_publish_times: insights.best_publish_times,
          top_cta_phrases: insights.top_cta_phrases,
          content_pattern_summary: insights.content_pattern_summary,
          channel_recommendations: insights.channel_recommendations,
          user_edit_preference_summary: insights.user_edit_preference_summary,
          generated_at: insights.generated_at,
          content_count_at_generation: insights.content_count_at_generation
        }
      : null,
    latest_analysis: latestAnalysis
      ? {
          summary: latestAnalysis.summary,
          key_actions: [...latestAnalysis.key_actions],
          analyzed_at: latestAnalysis.analyzed_at,
          content_count: latestAnalysis.content_count
        }
      : null
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

export const buildMemoryMd = (
  brandSettings: OrgBrandSettings,
  activeCampaigns: Campaign[],
  insightsInput: AccumulatedInsights | null,
  latestAnalysis: LatestAnalysisSummary | null,
  options: BuildMemoryOptions = {}
): MemoryMd => {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const tokenBudget = options.tokenBudget ?? DEFAULT_MEMORY_TOKEN_BUDGET;
  const insights = normalizeInsights(insightsInput);
  const freshnessKey = computeMemoryFreshnessKey(brandSettings, activeCampaigns, insights, latestAnalysis);

  const blocks = buildSectionBlocks(brandSettings, activeCampaigns, insights, latestAnalysis);
  let markdown = assembleBlocks(blocks);
  let tokenCount = countTokens(markdown);
  if (tokenCount > tokenBudget) {
    markdown = applyPriorityTruncation(blocks, tokenBudget);
    tokenCount = countTokens(markdown);
  }

  return {
    markdown,
    token_count: tokenCount,
    generated_at: generatedAt,
    freshness_key: freshnessKey
  };
};
