import type { CampaignPlan } from "../../types";
import { buildContentTypesForChannels, resolveChannelContentType } from "../../content-type-policy";

export type ChainStepName = "step_a" | "step_b" | "step_c" | "step_d";
export type ChainStepState = "ok" | "failed" | "blocked_by_dependency";
export type EffortLevel = "high" | "medium" | "low";
export type CampaignPhase = "awareness" | "engagement" | "conversion";
export type RiskLikelihood = "high" | "medium" | "low";
export type AssetPriority = "must" | "recommended";

export type AudienceMessagingData = {
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

export type ChannelStrategyData = {
  owned_channels: Array<{
    channel: string;
    rationale: string;
    content_format: string;
    effort_level: EffortLevel;
    key_strategy: string;
  }>;
  earned_channels: Array<{
    channel: string;
    rationale: string;
    execution: string;
    effort_level: EffortLevel;
  }>;
  paid_reference: Array<{
    channel: string;
    description: string;
    estimated_budget: string;
  }> | null;
};

export type ContentCalendarData = {
  weeks: Array<{
    week_number: number;
    theme: string;
    phase: CampaignPhase;
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

export type ExecutionData = {
  required_assets: Array<{
    id: number;
    name: string;
    asset_type: string;
    description: string;
    priority: AssetPriority;
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
    likelihood: RiskLikelihood;
    mitigation: string;
  }>;
  next_steps: Array<{
    action: string;
    timing: string;
  }>;
  approval_required: string[];
};

export type ChainStepMeta = {
  state: ChainStepState;
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
  audience: AudienceMessagingData | null;
  channels: ChannelStrategyData | null;
  calendar: ContentCalendarData | null;
  execution: ExecutionData | null;
  generated_at: string;
  chain_version: number;
  context_policy: {
    step_a: "full_rag";
    step_b: "compact_fact_pack";
    step_c: "micro_fact_pack";
    step_d: "micro_fact_pack";
  };
  step_meta: {
    step_a: ChainStepMeta;
    step_b: ChainStepMeta;
    step_c: ChainStepMeta;
    step_d: ChainStepMeta;
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => asString(entry))
        .filter(Boolean)
    : [];

const asPositiveInt = (value: unknown, fallback = 1): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed);
    }
  }
  return fallback;
};

const asEffortLevel = (value: unknown): EffortLevel => {
  const normalized = asString(value).toLowerCase();
  if (normalized === "high" || normalized === "low") {
    return normalized;
  }
  return "medium";
};

const asCampaignPhase = (value: unknown): CampaignPhase => {
  const normalized = asString(value).toLowerCase();
  if (normalized === "awareness" || normalized === "conversion") {
    return normalized;
  }
  return "engagement";
};

const asRiskLikelihood = (value: unknown): RiskLikelihood => {
  const normalized = asString(value).toLowerCase();
  if (normalized === "high" || normalized === "low") {
    return normalized;
  }
  return "medium";
};

const asAssetPriority = (value: unknown): AssetPriority => {
  const normalized = asString(value).toLowerCase();
  if (normalized === "must") {
    return "must";
  }
  return "recommended";
};

const hasMinimum = (value: string, min = 3): boolean => value.length >= min;

const mapSupportMessages = (
  value: unknown
): Array<{ message: string; target_pain_point: string; evidence: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const message = asString(row.message);
      const targetPainPoint = asString(row.target_pain_point);
      const evidence = asString(row.evidence);
      if (!message || !targetPainPoint) {
        return null;
      }
      return {
        message,
        target_pain_point: targetPainPoint,
        evidence
      };
    })
    .filter((entry): entry is { message: string; target_pain_point: string; evidence: string } => !!entry);
};

const mapStringRecord = (value: unknown): Record<string, string> => {
  const row = asRecord(value);
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(row)) {
    const cleanKey = key.trim();
    const cleanValue = asString(entry);
    if (!cleanKey || !cleanValue) {
      continue;
    }
    output[cleanKey] = cleanValue;
  }
  return output;
};

export const parseAudienceMessagingData = (value: unknown): AudienceMessagingData | null => {
  const row = asRecord(value);
  const primaryRow = asRecord(row.primary_audience);
  const primaryLabel = asString(primaryRow.label);
  const coreMessage = asString(row.core_message);
  if (!hasMinimum(primaryLabel) || !hasMinimum(coreMessage)) {
    return null;
  }

  const secondaryRaw = row.secondary_audience;
  const secondaryRow = asRecord(secondaryRaw);
  const secondaryLabel = asString(secondaryRow.label);
  const secondary =
    secondaryRaw && secondaryLabel
      ? {
          label: secondaryLabel,
          description: asString(secondaryRow.description),
          pain_points: asStringArray(secondaryRow.pain_points),
          active_platforms: asStringArray(secondaryRow.active_platforms)
        }
      : null;

  const funnelRow = asRecord(row.funnel_alignment);
  const supportMessages = mapSupportMessages(row.support_messages);

  const result: AudienceMessagingData = {
    primary_audience: {
      label: primaryLabel,
      description: asString(primaryRow.description),
      pain_points: asStringArray(primaryRow.pain_points),
      active_platforms: asStringArray(primaryRow.active_platforms)
    },
    secondary_audience: secondary,
    funnel_alignment: {
      awareness: asString(funnelRow.awareness),
      consideration: asString(funnelRow.consideration),
      decision: asString(funnelRow.decision)
    },
    core_message: coreMessage,
    support_messages: supportMessages,
    channel_tone_guide: mapStringRecord(row.channel_tone_guide)
  };

  return result;
};

export const parseChannelStrategyData = (value: unknown): ChannelStrategyData | null => {
  const row = asRecord(value);
  const ownedChannels = Array.isArray(row.owned_channels)
    ? row.owned_channels
        .map((entry) => {
          const channelRow = asRecord(entry);
          const channel = asString(channelRow.channel).toLowerCase();
          if (!channel) {
            return null;
          }
          return {
            channel,
            rationale: asString(channelRow.rationale),
            content_format: asString(channelRow.content_format),
            effort_level: asEffortLevel(channelRow.effort_level),
            key_strategy: asString(channelRow.key_strategy)
          };
        })
        .filter(
          (entry): entry is {
            channel: string;
            rationale: string;
            content_format: string;
            effort_level: EffortLevel;
            key_strategy: string;
          } => !!entry
        )
    : [];

  const earnedChannels = Array.isArray(row.earned_channels)
    ? row.earned_channels
        .map((entry) => {
          const channelRow = asRecord(entry);
          const channel = asString(channelRow.channel).toLowerCase();
          if (!channel) {
            return null;
          }
          return {
            channel,
            rationale: asString(channelRow.rationale),
            execution: asString(channelRow.execution),
            effort_level: asEffortLevel(channelRow.effort_level)
          };
        })
        .filter(
          (entry): entry is {
            channel: string;
            rationale: string;
            execution: string;
            effort_level: EffortLevel;
          } => !!entry
        )
    : [];

  if (!ownedChannels.length && !earnedChannels.length) {
    return null;
  }

  const paidReference =
    row.paid_reference === null || row.paid_reference === undefined
      ? null
      : Array.isArray(row.paid_reference)
        ? row.paid_reference
            .map((entry) => {
              const paidRow = asRecord(entry);
              const channel = asString(paidRow.channel).toLowerCase();
              if (!channel) {
                return null;
              }
              return {
                channel,
                description: asString(paidRow.description),
                estimated_budget: asString(paidRow.estimated_budget)
              };
            })
            .filter(
              (entry): entry is { channel: string; description: string; estimated_budget: string } => !!entry
            )
        : null;

  return {
    owned_channels: ownedChannels,
    earned_channels: earnedChannels,
    paid_reference: paidReference
  };
};

export const parseContentCalendarData = (value: unknown): ContentCalendarData | null => {
  const row = asRecord(value);
  const weeks = Array.isArray(row.weeks)
    ? row.weeks
        .map((entry, weekIndex) => {
          const weekRow = asRecord(entry);
          const items = Array.isArray(weekRow.items)
            ? weekRow.items
                .map((item, itemIndex) => {
                  const itemRow = asRecord(item);
                  const channel = asString(itemRow.channel).toLowerCase();
                  if (!channel) {
                    return null;
                  }
                  return {
                    day: asPositiveInt(itemRow.day, weekIndex * 7 + itemIndex + 1),
                    day_label: asString(itemRow.day_label) || `D${weekIndex * 7 + itemIndex + 1}`,
                    content_title: asString(itemRow.content_title),
                    content_description: asString(itemRow.content_description),
                    channel,
                    format: asString(itemRow.format) || "text",
                    owner_hint: asString(itemRow.owner_hint),
                    status: "draft" as const
                  };
                })
                .filter(
                  (item): item is {
                    day: number;
                    day_label: string;
                    content_title: string;
                    content_description: string;
                    channel: string;
                    format: string;
                    owner_hint: string;
                    status: "draft";
                  } => !!item
                )
            : [];

          if (!items.length) {
            return null;
          }

          return {
            week_number: asPositiveInt(weekRow.week_number, weekIndex + 1),
            theme: asString(weekRow.theme) || `Week ${weekIndex + 1}`,
            phase: asCampaignPhase(weekRow.phase),
            items
          };
        })
        .filter(
          (entry): entry is {
            week_number: number;
            theme: string;
            phase: CampaignPhase;
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
          } => !!entry
        )
    : [];

  if (!weeks.length) {
    return null;
  }

  const dependencies = Array.isArray(row.dependencies)
    ? row.dependencies
        .map((entry) => {
          const depRow = asRecord(entry);
          const description = asString(depRow.description);
          if (!description) {
            return null;
          }
          return {
            source_day: asPositiveInt(depRow.source_day, 1),
            target_day: asPositiveInt(depRow.target_day, 1),
            description
          };
        })
        .filter((entry): entry is { source_day: number; target_day: number; description: string } => !!entry)
    : [];

  return {
    weeks,
    dependencies
  };
};

const mapExecutionMetricList = (
  value: unknown
): Array<{ metric: string; target: string; measurement: string; reporting_cadence: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const metric = asString(row.metric);
      if (!metric) {
        return null;
      }
      return {
        metric,
        target: asString(row.target),
        measurement: asString(row.measurement),
        reporting_cadence: asString(row.reporting_cadence)
      };
    })
    .filter(
      (entry): entry is { metric: string; target: string; measurement: string; reporting_cadence: string } => !!entry
    );
};

export const parseExecutionData = (value: unknown): ExecutionData | null => {
  const row = asRecord(value);

  const requiredAssets = Array.isArray(row.required_assets)
    ? row.required_assets
        .map((entry, index) => {
          const assetRow = asRecord(entry);
          const name = asString(assetRow.name);
          if (!name) {
            return null;
          }
          return {
            id: asPositiveInt(assetRow.id, index + 1),
            name,
            asset_type: asString(assetRow.asset_type),
            description: asString(assetRow.description),
            priority: asAssetPriority(assetRow.priority),
            deadline_hint: asString(assetRow.deadline_hint)
          };
        })
        .filter(
          (entry): entry is {
            id: number;
            name: string;
            asset_type: string;
            description: string;
            priority: AssetPriority;
            deadline_hint: string;
          } => !!entry
        )
    : [];

  const reportingPlanRow = asRecord(row.reporting_plan);
  const reportingPlan = {
    daily: asString(reportingPlanRow.daily),
    weekly: asString(reportingPlanRow.weekly),
    post_campaign: asString(reportingPlanRow.post_campaign)
  };

  const risks = Array.isArray(row.risks)
    ? row.risks
        .map((entry) => {
          const riskRow = asRecord(entry);
          const risk = asString(riskRow.risk);
          if (!risk) {
            return null;
          }
          return {
            risk,
            likelihood: asRiskLikelihood(riskRow.likelihood),
            mitigation: asString(riskRow.mitigation)
          };
        })
        .filter((entry): entry is { risk: string; likelihood: RiskLikelihood; mitigation: string } => !!entry)
    : [];

  const nextSteps = Array.isArray(row.next_steps)
    ? row.next_steps
        .map((entry) => {
          const stepRow = asRecord(entry);
          const action = asString(stepRow.action);
          if (!action) {
            return null;
          }
          return {
            action,
            timing: asString(stepRow.timing)
          };
        })
        .filter((entry): entry is { action: string; timing: string } => !!entry)
    : [];

  const kpiPrimary = mapExecutionMetricList(row.kpi_primary);
  if (!kpiPrimary.length || !nextSteps.length) {
    return null;
  }

  const budgetBreakdown =
    row.budget_breakdown === null || row.budget_breakdown === undefined
      ? null
      : Array.isArray(row.budget_breakdown)
        ? row.budget_breakdown
            .map((entry) => {
              const budgetRow = asRecord(entry);
              const item = asString(budgetRow.item);
              if (!item) {
                return null;
              }
              return {
                item,
                estimated_cost: asString(budgetRow.estimated_cost),
                note: asString(budgetRow.note)
              };
            })
            .filter((entry): entry is { item: string; estimated_cost: string; note: string } => !!entry)
        : null;

  return {
    required_assets: requiredAssets,
    kpi_primary: kpiPrimary,
    kpi_secondary: mapExecutionMetricList(row.kpi_secondary),
    reporting_plan: reportingPlan,
    budget_breakdown: budgetBreakdown,
    risks,
    next_steps: nextSteps,
    approval_required: asStringArray(row.approval_required)
  };
};

const unique = (value: string[]): string[] => [...new Set(value.filter(Boolean))];

const clampDurationDays = (value: number): number => Math.max(1, Math.min(90, value));
const clampPostCount = (value: number): number => Math.max(1, Math.min(120, value));

export const buildLegacyPlanFields = (
  activityFolder: string,
  campaignName: string | null | undefined,
  chainData: Pick<CampaignPlanChainData, "audience" | "channels" | "calendar">
): CampaignPlan => {
  const planName = asString(campaignName) || activityFolder;
  const fallbackObjective = `"${planName}"의 성과를 전달하고 참여를 유도합니다.`;
  const objective = chainData.audience?.core_message || fallbackObjective;

  const channelCandidates = [
    ...(chainData.channels?.owned_channels ?? []).map((entry) => entry.channel),
    ...(chainData.channels?.earned_channels ?? []).map((entry) => entry.channel),
    ...((chainData.channels?.paid_reference ?? []).map((entry) => entry.channel) ?? []),
    ...(chainData.calendar?.weeks ?? []).flatMap((week) => week.items.map((item) => item.channel))
  ]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const channels = unique(channelCandidates).slice(0, 6);
  const safeChannels = channels.length ? channels : ["instagram"];

  const scheduleItems = (chainData.calendar?.weeks ?? [])
    .flatMap((week) => week.items)
    .sort((left, right) => left.day - right.day)
    .slice(0, 12)
    .map((item, index) => {
      const channel = (item.channel || safeChannels[0]).toLowerCase();
      return {
        day: Math.max(1, item.day || index + 1),
        channel,
        type: resolveChannelContentType({
          channel,
          suggestedType: item.format || null,
          sequenceIndex: index
        })
      };
    });

  const suggestedSchedule =
    scheduleItems.length > 0
      ? scheduleItems
      : [
          {
            day: 1,
            channel: safeChannels[0],
            type: resolveChannelContentType({
              channel: safeChannels[0],
              sequenceIndex: 0
            })
          },
          {
            day: 4,
            channel: safeChannels[Math.min(1, safeChannels.length - 1)] ?? safeChannels[0],
            type: resolveChannelContentType({
              channel: safeChannels[Math.min(1, safeChannels.length - 1)] ?? safeChannels[0],
              sequenceIndex: 1
            })
          }
        ];

  const durationDays = clampDurationDays((chainData.calendar?.weeks?.length ?? 1) * 7);
  const postCount = clampPostCount(suggestedSchedule.length);
  const contentTypes = unique([
    ...suggestedSchedule.map((entry) => entry.type.toLowerCase()),
    ...buildContentTypesForChannels(safeChannels)
  ]);

  return {
    objective,
    channels: safeChannels,
    duration_days: durationDays,
    post_count: postCount,
    content_types: contentTypes.length ? contentTypes : ["text"],
    suggested_schedule: suggestedSchedule
  };
};

export const createDefaultChainStepMeta = (state: ChainStepState): ChainStepMeta => {
  const now = new Date().toISOString();
  return {
    state,
    started_at: now,
    completed_at: now,
    latency_ms: 0,
    retry_count: 0,
    prompt_tokens: null,
    completion_tokens: null,
    error_code: state === "blocked_by_dependency" ? "blocked_by_dependency" : null,
    error_message: state === "blocked_by_dependency" ? "Step was skipped due to dependency failure." : null
  };
};
