import type { CampaignPlan } from "../../types";
import { buildContentTypesForChannels, resolveChannelContentType } from "../../content-type-policy";
import type { AudienceMessagingData, ChannelStrategyData, ContentCalendarData, ExecutionData } from "./chain-types";

const SUPPORTED_CONTENT_CHANNELS = new Set(["instagram", "threads", "naver_blog", "facebook", "youtube"]);

const clampDurationDays = (value: number): number => Math.max(1, Math.min(90, Math.floor(value)));
const clampPostCount = (value: number): number => Math.max(1, Math.min(120, Math.floor(value)));
const uniqueStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const toLabel = (value: string): string =>
  value
    .split("_")
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
const cleanQuotedLabel = (value: string): string =>
  value
    .trim()
    .replace(/^["'`“”‘’]+/, "")
    .replace(/["'`“”‘’]+$/, "")
    .trim();

const resolvePlanLabel = (plan: CampaignPlan): string => {
  const objective = String(plan.objective ?? "").trim();
  if (!objective) {
    return "캠페인";
  }

  const quotedMatch = objective.match(/["'`“”‘’]([^"'`“”‘’]{2,80})["'`“”‘’]/);
  if (quotedMatch?.[1]) {
    return cleanQuotedLabel(quotedMatch[1]);
  }

  const head = cleanQuotedLabel(objective).split(/\s+/).slice(0, 4).join(" ");
  return head || "캠페인";
};

export const resolveDurationDaysFromText = (value: string): number | null => {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }

  const monthMatch = normalized.match(/(\d+)\s*(?:\uac1c\uc6d4|\ub2ec|month|months)/i);
  if (monthMatch) {
    return clampDurationDays(Number.parseInt(monthMatch[1] ?? "0", 10) * 30);
  }

  const weekMatch = normalized.match(/(\d+)\s*(?:\uc8fc|week|weeks)/i);
  if (weekMatch) {
    return clampDurationDays(Number.parseInt(weekMatch[1] ?? "0", 10) * 7);
  }

  const dayMatch = normalized.match(/(\d+)\s*(?:\uc77c|day|days)/i);
  if (dayMatch) {
    return clampDurationDays(Number.parseInt(dayMatch[1] ?? "0", 10));
  }

  return null;
};

const normalizePreferredChannel = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (SUPPORTED_CONTENT_CHANNELS.has(normalized)) {
    return normalized;
  }
  if (normalized === "naver blog" || normalized === "naverblog") {
    return "naver_blog";
  }
  return null;
};

export const normalizePreferredChannels = (values?: string[] | null): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = values
    .flatMap((entry) => String(entry ?? "").split(/[,\n/|]+/))
    .map((entry) => normalizePreferredChannel(entry))
    .filter((entry): entry is string => !!entry);
  return uniqueStrings(normalized);
};

const estimatePostCountFromDuration = (durationDays: number): number => {
  if (durationDays <= 7) {
    return 3;
  }
  if (durationDays <= 14) {
    return 6;
  }
  if (durationDays <= 21) {
    return 9;
  }
  if (durationDays <= 31) {
    return 12;
  }
  return Math.max(4, Math.min(24, Math.round(durationDays / 3)));
};

const buildHeuristicSchedule = (params: {
  durationDays: number;
  postCount: number;
  channels: string[];
}): CampaignPlan["suggested_schedule"] => {
  const safeChannels = params.channels.length > 0 ? params.channels : ["instagram"];
  const safeDuration = clampDurationDays(params.durationDays);
  const safePostCount = clampPostCount(params.postCount);

  if (safePostCount === 1) {
    const channel = safeChannels[0] ?? "instagram";
    return [{ day: 1, channel, type: resolveChannelContentType({ channel, sequenceIndex: 0 }) }];
  }

  return Array.from({ length: safePostCount }, (_, index) => {
    const ratio = index / Math.max(1, safePostCount - 1);
    const day = Math.max(1, Math.min(safeDuration, Math.round(ratio * (safeDuration - 1)) + 1));
    const channel = safeChannels[index % safeChannels.length] ?? "instagram";
    return {
      day,
      channel,
      type: resolveChannelContentType({
        channel,
        sequenceIndex: index
      })
    };
  });
};

export const applyCampaignPlanPreferences = (
  plan: CampaignPlan,
  options: {
    preferredDurationDays?: number | null;
    preferredChannels?: string[] | null;
    calendarAvailable: boolean;
  }
): CampaignPlan => {
  const preferredChannels = normalizePreferredChannels(options.preferredChannels);
  const channels = preferredChannels.length ? preferredChannels : plan.channels;
  const durationFromOptions =
    typeof options.preferredDurationDays === "number" && Number.isFinite(options.preferredDurationDays)
      ? clampDurationDays(options.preferredDurationDays)
      : null;

  if (options.calendarAvailable) {
    return {
      ...plan,
      channels
    };
  }

  const durationDays = durationFromOptions ?? clampDurationDays(plan.duration_days);
  const heuristicPostCount = estimatePostCountFromDuration(durationDays);
  const postCount = clampPostCount(Math.max(plan.post_count, heuristicPostCount));
  const suggestedSchedule = buildHeuristicSchedule({
    durationDays,
    postCount,
    channels
  });
  const contentTypes = uniqueStrings([
    ...suggestedSchedule.map((entry) => entry.type.toLowerCase()),
    ...buildContentTypesForChannels(channels)
  ]);

  return {
    ...plan,
    channels,
    duration_days: durationDays,
    post_count: postCount,
    content_types: contentTypes.length ? contentTypes : ["text"],
    suggested_schedule: suggestedSchedule
  };
};

export const buildFallbackCalendarFromPlan = (plan: CampaignPlan): ContentCalendarData => {
  const planLabel = resolvePlanLabel(plan);
  const sortedSchedule =
    plan.suggested_schedule.length > 0
      ? [...plan.suggested_schedule].sort((left, right) => left.day - right.day)
      : [
          {
            day: 1,
            channel: plan.channels[0] ?? "instagram",
            type: resolveChannelContentType({ channel: plan.channels[0] ?? "instagram", sequenceIndex: 0 })
          }
        ];

  const maxPlannedDay = sortedSchedule[sortedSchedule.length - 1]?.day ?? 1;
  const totalDays = clampDurationDays(Math.max(plan.duration_days, maxPlannedDay));
  const weekCount = Math.max(1, Math.ceil(totalDays / 7));

  const phaseForWeek = (weekIndex: number): "awareness" | "engagement" | "conversion" => {
    if (weekCount === 1) {
      return "engagement";
    }
    if (weekIndex === 0) {
      return "awareness";
    }
    if (weekIndex === weekCount - 1) {
      return "conversion";
    }
    return "engagement";
  };

  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const startDay = index * 7 + 1;
    const endDay = Math.min(totalDays, (index + 1) * 7);
    const weekItems = sortedSchedule
      .filter((item) => item.day >= startDay && item.day <= endDay)
      .map((item, itemIndex) => ({
        day: item.day,
        day_label: `D${item.day}`,
        content_title: `${planLabel} ${toLabel(item.channel)} 콘텐츠 ${itemIndex + 1}`,
        content_description: plan.objective,
        channel: item.channel,
        format: item.type || "text",
        owner_hint: "마케팅팀",
        status: "draft" as const
      }));

    return {
      week_number: index + 1,
      theme: `${index + 1}주차 운영`,
      phase: phaseForWeek(index),
      items: weekItems
    };
  }).filter((week) => week.items.length > 0);

  const fallbackWeeks =
    weeks.length > 0
      ? weeks
      : [
          {
            week_number: 1,
            theme: "1주차 운영",
            phase: "engagement" as const,
            items: [
              {
                day: 1,
                day_label: "D1",
                content_title: `${planLabel} ${(plan.channels[0] ?? "instagram").toUpperCase()} 시작 콘텐츠`,
                content_description: plan.objective,
                channel: plan.channels[0] ?? "instagram",
                format: resolveChannelContentType({
                  channel: plan.channels[0] ?? "instagram",
                  sequenceIndex: 0
                }),
                owner_hint: "마케팅팀",
                status: "draft" as const
              }
            ]
          }
        ];

  const dependencies = sortedSchedule.slice(1).map((entry, index) => ({
    source_day: sortedSchedule[index]?.day ?? 1,
    target_day: entry.day,
    description: "이전 게시물 성과를 확인한 뒤 순차 발행합니다."
  }));

  return {
    weeks: fallbackWeeks,
    dependencies
  };
};

export const buildFallbackAudienceFromPlan = (plan: CampaignPlan): AudienceMessagingData => {
  const channels = plan.channels.length > 0 ? plan.channels : ["instagram"];
  const coreMessage = plan.objective.trim() || "캠페인 핵심 메시지를 명확하게 전달하고 참여를 유도합니다.";
  const toneGuide = Object.fromEntries(
    channels.map((channel) => [channel, `${toLabel(channel)} 채널 특성에 맞춘 명확하고 신뢰감 있는 톤을 유지합니다.`])
  );

  return {
    primary_audience: {
      label: "잠재 참여자",
      description: "캠페인 주제에 관심이 있으며 실제 행동으로 이어질 가능성이 높은 핵심 타깃입니다.",
      pain_points: [
        "캠페인 핵심 가치와 참여 방법을 빠르게 이해하기 어렵습니다.",
        "신뢰 가능한 근거와 실제 사례가 부족하면 참여를 망설입니다.",
        "채널별 메시지가 일관되지 않으면 행동 전환이 낮아집니다."
      ],
      active_platforms: channels.map((channel) => toLabel(channel))
    },
    secondary_audience: {
      label: "확산 기여층",
      description: "주변 공유와 추천을 통해 캠페인 도달을 확대할 수 있는 보조 타깃입니다.",
      pain_points: ["공유할 명확한 메시지와 근거가 부족하면 확산 참여가 낮아집니다."],
      active_platforms: channels.slice(0, 3).map((channel) => toLabel(channel))
    },
    funnel_alignment: {
      awareness: "핵심 문제와 캠페인 필요성을 짧고 강하게 전달합니다.",
      consideration: "근거, 사례, 기대 효과를 통해 신뢰를 확보합니다.",
      decision: "명확한 CTA와 간단한 참여 절차로 행동 전환을 유도합니다."
    },
    core_message: coreMessage,
    support_messages: [
      {
        message: "캠페인의 목적과 기대 효과를 한눈에 이해할 수 있게 전달합니다.",
        target_pain_point: "핵심 가치 이해 부족",
        evidence: "문제 정의, 수혜 대상, 기대 변화를 구조화해 제시합니다."
      },
      {
        message: "실행 근거와 실제 사례를 통해 참여 신뢰도를 높입니다.",
        target_pain_point: "신뢰 근거 부족",
        evidence: "성과 지표, 사례, 운영 프로세스를 함께 제공합니다."
      },
      {
        message: "채널별 형식에 맞춰 같은 메시지를 일관되게 유지합니다.",
        target_pain_point: "메시지 일관성 부족",
        evidence: "코어 메시지-보조 메시지 매핑 기준을 통일합니다."
      }
    ],
    channel_tone_guide: toneGuide
  };
};

export const buildFallbackChannelStrategyFromPlan = (plan: CampaignPlan): ChannelStrategyData => {
  const channels = plan.channels.length > 0 ? plan.channels : ["instagram"];
  const ownedChannels = channels.map((channel, index) => {
    const baseFormat = resolveChannelContentType({ channel, sequenceIndex: index });
    const effort: "high" | "medium" | "low" =
      channel === "youtube" ? "high" : channel === "threads" ? "low" : "medium";
    return {
      channel,
      rationale: `${toLabel(channel)} 사용자군과 캠페인 메시지 확산 적합도가 높습니다.`,
      content_format: baseFormat,
      effort_level: effort,
      key_strategy: `${toLabel(channel)} 포맷에 맞춘 핵심 메시지와 행동 유도 문구를 반복 노출합니다.`
    };
  });

  const earnedChannels = channels.slice(0, Math.min(3, channels.length)).map((channel) => ({
    channel,
    rationale: `${toLabel(channel)}에서 사용자 반응 기반 자연 확산이 가능합니다.`,
    execution: "반응이 높은 게시물을 중심으로 공유/리포스트/커뮤니티 확산을 유도합니다.",
    effort_level: "medium" as const
  }));

  return {
    owned_channels: ownedChannels,
    earned_channels: earnedChannels,
    paid_reference: null
  };
};

export const buildFallbackExecutionFromPlan = (plan: CampaignPlan): ExecutionData => {
  const planLabel = resolvePlanLabel(plan);
  const channels = plan.channels.length ? plan.channels : ["instagram"];
  const requiredAssets: ExecutionData["required_assets"] = channels.slice(0, 3).map((channel, index) => ({
    id: index + 1,
    name: `${planLabel} ${toLabel(channel)} 콘텐츠 패키지`,
    asset_type: "content",
    description: `${planLabel} 캠페인 ${toLabel(channel)} 채널용 크리에이티브 및 카피 패키지입니다.`,
    priority: index === 0 ? "must" : "recommended",
    deadline_hint: `D-${Math.max(1, Math.min(7, plan.duration_days - index))}`
  }));

  const fallbackAssets =
    requiredAssets.length > 0
      ? requiredAssets
      : [
          {
            id: 1,
            name: `${planLabel} 마스터 카피`,
            asset_type: "text",
            description: `${planLabel} 전 채널 공통 핵심 메시지와 CTA 세트`,
            priority: "must" as const,
            deadline_hint: "D-3"
          }
        ];

  return {
    required_assets: fallbackAssets,
    kpi_primary: [
      {
        metric: "도달수",
        target: `>= ${Math.max(1000, plan.post_count * 500)}`,
        measurement: `${planLabel} 채널 분석 대시보드`,
        reporting_cadence: "주간"
      },
      {
        metric: "참여율",
        target: ">= 3%",
        measurement: `${planLabel} 참여 수 / 도달수`,
        reporting_cadence: "주간"
      }
    ],
    kpi_secondary: [
      {
        metric: "랜딩 클릭수",
        target: `>= ${Math.max(100, plan.post_count * 40)}`,
        measurement: `${planLabel} UTM 클릭 추적`,
        reporting_cadence: "주간"
      }
    ],
    reporting_plan: {
      daily: "게시물 도달 및 댓글 반응을 일별 점검합니다.",
      weekly: "KPI 추세를 요약하고 콘텐츠 믹스를 최적화합니다.",
      post_campaign: "최종 성과 리뷰와 다음 실행 제안을 공유합니다."
    },
    budget_breakdown: null,
    risks: [
      {
        risk: "게시 주기 불안정",
        likelihood: "medium",
        mitigation: "백업 에셋을 사전 준비하고 핵심 게시물을 선예약합니다."
      },
      {
        risk: "초반 참여 저조",
        likelihood: "medium",
        mitigation: "후킹 문구를 개선하고 성과 좋은 주제를 빠르게 확장합니다."
      }
    ],
    next_steps: [
      {
        action: "제작 담당자와 마감 일정을 확정",
        timing: "24시간 이내"
      },
      {
        action: "1주차 콘텐츠 확정",
        timing: "런칭 전"
      }
    ],
    approval_required: ["캠페인 매니저 최종 승인"]
  };
};
