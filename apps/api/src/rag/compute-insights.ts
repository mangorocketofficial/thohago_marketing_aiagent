import type { AccumulatedInsights } from "@repo/rag";
import { supabaseAdmin } from "../lib/supabase-admin";

const PUBLISHED_STATUSES = ["published", "historical"] as const;
const CHANNELS = ["instagram", "threads", "naver_blog", "facebook", "youtube"] as const;

const countPublishedByChannel = async (orgId: string, channel: string): Promise<number> => {
  const { count, error } = await supabaseAdmin
    .from("contents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", [...PUBLISHED_STATUSES])
    .eq("channel", channel);

  if (error) {
    throw new Error(`Failed to count contents for channel ${channel}: ${error.message}`);
  }
  return typeof count === "number" ? count : 0;
};

const buildChannelRecommendations = (channelCounts: Record<string, number>): Record<string, string> => {
  const recommendations: Record<string, string> = {};

  for (const [channel, count] of Object.entries(channelCounts)) {
    if (count >= 10) {
      recommendations[channel] = `${count}개 콘텐츠 축적. 기존 패턴 기반 생성 신뢰도가 높습니다.`;
      continue;
    }
    if (count >= 3) {
      recommendations[channel] = `${count}개 콘텐츠 참고 가능. 톤/구성 참고는 가능하나 패턴 다양성은 제한적입니다.`;
      continue;
    }
    recommendations[channel] = `콘텐츠 ${count}개. 브랜드 프로필 중심 생성 권장.`;
  }

  return recommendations;
};

const summarizeEditPreferences = async (orgId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .from("org_rag_embeddings")
    .select("metadata")
    .eq("org_id", orgId)
    .eq("source_type", "chat_pattern")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Failed to load chat_pattern metadata: ${error.message}`);
  }

  const editTypeCounts: Record<string, number> = {};
  for (const row of Array.isArray(data) ? data : []) {
    const metadata =
      row && typeof row.metadata === "object" && row.metadata && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const editType = typeof metadata.edit_type === "string" ? metadata.edit_type.trim() : "";
    if (!editType) {
      continue;
    }
    editTypeCounts[editType] = (editTypeCounts[editType] ?? 0) + 1;
  }

  const totalEdits = Object.values(editTypeCounts).reduce((sum, current) => sum + current, 0);
  if (totalEdits <= 0) {
    return "";
  }

  const parts = Object.entries(editTypeCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type}: ${count}회`);
  return `총 ${totalEdits}회 수정. ${parts.join(", ")}.`;
};

export const computeBasicInsights = async (orgId: string): Promise<AccumulatedInsights> => {
  const now = new Date().toISOString();

  const countEntries = await Promise.all(
    CHANNELS.map(async (channel) => [channel, await countPublishedByChannel(orgId, channel)] as const)
  );
  const channelCounts: Record<string, number> = {};
  for (const [channel, count] of countEntries) {
    if (count > 0) {
      channelCounts[channel] = count;
    }
  }

  const totalContent = Object.values(channelCounts).reduce((sum, current) => sum + current, 0);
  const contentPatternSummary =
    totalContent > 0
      ? `총 ${totalContent}개 콘텐츠 (${Object.entries(channelCounts)
          .map(([channel, count]) => `${channel}: ${count}`)
          .join(", ")})`
      : "";

  return {
    best_publish_times: {},
    top_cta_phrases: [],
    content_pattern_summary: contentPatternSummary,
    channel_recommendations: buildChannelRecommendations(channelCounts),
    user_edit_preference_summary: await summarizeEditPreferences(orgId),
    generated_at: now,
    content_count_at_generation: totalContent
  };
};

export const updateAccumulatedInsights = async (orgId: string): Promise<void> => {
  const insights = await computeBasicInsights(orgId);

  const { error } = await supabaseAdmin
    .from("org_brand_settings")
    .update({ accumulated_insights: insights })
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Failed to update accumulated insights: ${error.message}`);
  }
};

export const shouldRefreshInsightsByEmbeddedCount = async (orgId: string, every = 5): Promise<boolean> => {
  const refreshEvery = Math.max(1, Math.floor(every));
  const { count, error } = await supabaseAdmin
    .from("contents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", [...PUBLISHED_STATUSES])
    .not("embedded_at", "is", null);

  if (error) {
    throw new Error(`Failed to count embedded published contents: ${error.message}`);
  }

  const total = typeof count === "number" ? count : 0;
  return total > 0 && total % refreshEvery === 0;
};
