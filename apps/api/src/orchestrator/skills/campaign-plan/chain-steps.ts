import { truncateToTokenBudget } from "@repo/rag";
import type { EnrichedCampaignContext } from "../../rag-context";
import type {
  AudienceMessagingData,
  ChannelStrategyData,
  ContentCalendarData,
  ExecutionData
} from "./chain-types";

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
};

const asLine = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
};

export const CHAIN_STEP_MAX_TOKENS = {
  step_a: 1200,
  step_b: 900,
  step_c: 1200,
  step_d: 1200
} as const;

export const CHAIN_STEP_TIMEOUT_MS = 12_000;
export const CHAIN_TOTAL_HARD_TIMEOUT_MS = 45_000;
export const CHAIN_TOTAL_TARGET_TIMEOUT_MS = 30_000;

export const buildFullRagContextText = (context: EnrichedCampaignContext): string => {
  const parts: string[] = [];
  if (context.memoryMd) {
    parts.push("=== MEMORY ===", context.memoryMd);
  }
  if (context.brandReviewMd) {
    parts.push("=== BRAND REVIEW ===", context.brandReviewMd);
  }
  if (context.interviewAnswers) {
    parts.push(
      "=== INTERVIEW ANSWERS ===",
      `Tone: ${context.interviewAnswers.q1 || "n/a"}`,
      `Audience: ${context.interviewAnswers.q2 || "n/a"}`,
      `Forbidden words/topics: ${context.interviewAnswers.q3 || "n/a"}`,
      `Seasonality: ${context.interviewAnswers.q4 || "n/a"}`
    );
  }
  if (context.folderSummary) {
    parts.push("=== FOLDER SUMMARY ===", context.folderSummary);
  }
  if (context.documentExtracts) {
    parts.push("=== FOLDER DOC EXTRACTS ===", context.documentExtracts);
  }
  return parts.join("\n\n").trim();
};

export const buildCompactFactPack = (context: EnrichedCampaignContext): string => {
  const lines: string[] = [];
  const interview = context.interviewAnswers;
  if (interview) {
    const q1 = asLine(interview.q1);
    const q2 = asLine(interview.q2);
    const q3 = asLine(interview.q3);
    const q4 = asLine(interview.q4);
    if (q1) lines.push(`Tone guide: ${q1}`);
    if (q2) lines.push(`Audience focus: ${q2}`);
    if (q3) lines.push(`Forbidden constraints: ${q3}`);
    if (q4) lines.push(`Seasonality: ${q4}`);
  }

  if (context.brandReviewMd) {
    lines.push(`Brand review highlights: ${truncateToTokenBudget(context.brandReviewMd, 220)}`);
  }
  if (context.folderSummary) {
    lines.push(`Folder summary: ${truncateToTokenBudget(context.folderSummary, 100)}`);
  }
  if (context.documentExtracts) {
    lines.push(`Document extract highlights: ${truncateToTokenBudget(context.documentExtracts, 180)}`);
  }
  return truncateToTokenBudget(lines.join("\n"), 500);
};

export const buildMicroFactPack = (params: {
  context: EnrichedCampaignContext;
  audience: AudienceMessagingData | null;
  channels: ChannelStrategyData | null;
}): string => {
  const lines: string[] = [];
  const interview = params.context.interviewAnswers;
  if (interview?.q3?.trim()) {
    lines.push(`Forbidden constraints: ${interview.q3.trim()}`);
  }
  if (interview?.q1?.trim()) {
    lines.push(`Tone and manner: ${interview.q1.trim()}`);
  }
  if (params.audience?.core_message) {
    lines.push(`Core message: ${params.audience.core_message}`);
  }
  if (params.audience?.support_messages?.length) {
    lines.push(`Support evidence: ${params.audience.support_messages.slice(0, 3).map((row) => row.evidence).join(" | ")}`);
  }
  if (params.channels?.owned_channels?.length) {
    lines.push(`Primary channels: ${params.channels.owned_channels.slice(0, 4).map((row) => row.channel).join(", ")}`);
  }
  return truncateToTokenBudget(lines.join("\n"), 280);
};

export const buildStepAPrompt = (params: {
  activityFolder: string;
  userMessage: string;
  fullRagContext: string;
  revisionReason?: string | null;
  previousAudience?: AudienceMessagingData | null;
}): string => {
  const revisionLines: string[] = [];
  if (params.revisionReason?.trim()) {
    revisionLines.push(`Revision reason: ${params.revisionReason.trim()}`);
  }
  if (params.previousAudience) {
    revisionLines.push("Previous Step A output:", safeJson(params.previousAudience));
  }

  return [
    "You are a senior marketing strategist for a Korean NGO.",
    "Return JSON only. Do not wrap with markdown.",
    "",
    "TASK: Step A - Target Audience and Messaging.",
    `Activity folder: ${params.activityFolder}`,
    `User request: ${params.userMessage}`,
    revisionLines.length ? ["", "REVISION CONTEXT", revisionLines.join("\n")].join("\n") : "",
    "",
    "RAG CONTEXT",
    params.fullRagContext || "No additional context.",
    "",
    "OUTPUT SCHEMA",
    "{",
    '  "primary_audience": { "label": string, "description": string, "pain_points": string[], "active_platforms": string[] },',
    '  "secondary_audience": { "label": string, "description": string, "pain_points": string[], "active_platforms": string[] } | null,',
    '  "funnel_alignment": { "awareness": string, "consideration": string, "decision": string },',
    '  "core_message": string,',
    '  "support_messages": [{ "message": string, "target_pain_point": string, "evidence": string }],',
    '  "channel_tone_guide": Record<string, string>',
    "}",
    "",
    "REQUIREMENTS",
    "- Keep all fields grounded in provided context.",
    "- Include concrete pain points and evidence lines.",
    "- Keep channel_tone_guide keys as channel names."
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildStepBPrompt = (params: {
  activityFolder: string;
  userMessage: string;
  compactFactPack: string;
  audience: AudienceMessagingData;
  revisionReason?: string | null;
  previousChannels?: ChannelStrategyData | null;
}): string => {
  const revisionLines: string[] = [];
  if (params.revisionReason?.trim()) {
    revisionLines.push(`Revision reason: ${params.revisionReason.trim()}`);
  }
  if (params.previousChannels) {
    revisionLines.push("Previous Step B output:", safeJson(params.previousChannels));
  }

  return [
    "You are a channel strategy specialist for NGO campaigns.",
    "Return JSON only.",
    "",
    "TASK: Step B - Channel Strategy.",
    `Activity folder: ${params.activityFolder}`,
    `User request: ${params.userMessage}`,
    revisionLines.length ? ["", "REVISION CONTEXT", revisionLines.join("\n")].join("\n") : "",
    "",
    "STEP A INPUT (audience and messaging)",
    safeJson(params.audience),
    "",
    "COMPACT FACT PACK",
    params.compactFactPack || "No compact facts.",
    "",
    "OUTPUT SCHEMA",
    "{",
    '  "owned_channels": [{ "channel": string, "rationale": string, "content_format": string, "effort_level": "high"|"medium"|"low", "key_strategy": string }],',
    '  "earned_channels": [{ "channel": string, "rationale": string, "execution": string, "effort_level": "high"|"medium"|"low" }],',
    '  "paid_reference": [{ "channel": string, "description": string, "estimated_budget": string }] | null',
    "}",
    "",
    "REQUIREMENTS",
    "- Keep recommendations realistic for NGO team capacity.",
    "- Do not invent unavailable channels."
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildStepCPrompt = (params: {
  activityFolder: string;
  userMessage: string;
  audience: AudienceMessagingData;
  channels: ChannelStrategyData;
  microFactPack: string;
  revisionReason?: string | null;
  previousCalendar?: ContentCalendarData | null;
}): string => {
  const revisionLines: string[] = [];
  if (params.revisionReason?.trim()) {
    revisionLines.push(`Revision reason: ${params.revisionReason.trim()}`);
  }
  if (params.previousCalendar) {
    revisionLines.push("Previous Step C output:", safeJson(params.previousCalendar));
  }

  return [
    "You are an editorial planning strategist for campaign operations.",
    "Return JSON only.",
    "",
    "TASK: Step C - Content Calendar.",
    `Activity folder: ${params.activityFolder}`,
    `User request: ${params.userMessage}`,
    revisionLines.length ? ["", "REVISION CONTEXT", revisionLines.join("\n")].join("\n") : "",
    "",
    "STEP A INPUT",
    safeJson(params.audience),
    "",
    "STEP B INPUT",
    safeJson(params.channels),
    "",
    "MICRO FACT PACK",
    params.microFactPack || "No micro facts.",
    "",
    "OUTPUT SCHEMA",
    "{",
    '  "weeks": [{ "week_number": number, "theme": string, "phase": "awareness"|"engagement"|"conversion", "items": [{ "day": number, "day_label": string, "content_title": string, "content_description": string, "channel": string, "format": string, "owner_hint": string, "status": "draft" }] }],',
    '  "dependencies": [{ "source_day": number, "target_day": number, "description": string }]',
    "}",
    "",
    "REQUIREMENTS",
    "- Make calendar executable and sequence-aware.",
    "- Ensure channels used are compatible with Step B."
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildStepDPrompt = (params: {
  activityFolder: string;
  userMessage: string;
  audience: AudienceMessagingData;
  channels: ChannelStrategyData;
  calendar: ContentCalendarData;
  microFactPack: string;
  revisionReason?: string | null;
  previousExecution?: ExecutionData | null;
}): string => {
  const revisionLines: string[] = [];
  if (params.revisionReason?.trim()) {
    revisionLines.push(`Revision reason: ${params.revisionReason.trim()}`);
  }
  if (params.previousExecution) {
    revisionLines.push("Previous Step D output:", safeJson(params.previousExecution));
  }

  return [
    "You are an execution lead for marketing operations.",
    "Return JSON only.",
    "",
    "TASK: Step D - Assets, KPI, Risks, Next Steps.",
    `Activity folder: ${params.activityFolder}`,
    `User request: ${params.userMessage}`,
    revisionLines.length ? ["", "REVISION CONTEXT", revisionLines.join("\n")].join("\n") : "",
    "",
    "STEP A INPUT",
    safeJson(params.audience),
    "",
    "STEP B INPUT",
    safeJson(params.channels),
    "",
    "STEP C INPUT",
    safeJson(params.calendar),
    "",
    "MICRO FACT PACK",
    params.microFactPack || "No micro facts.",
    "",
    "OUTPUT SCHEMA",
    "{",
    '  "required_assets": [{ "id": number, "name": string, "asset_type": string, "description": string, "priority": "must"|"recommended", "deadline_hint": string }],',
    '  "kpi_primary": [{ "metric": string, "target": string, "measurement": string, "reporting_cadence": string }],',
    '  "kpi_secondary": [{ "metric": string, "target": string, "measurement": string, "reporting_cadence": string }],',
    '  "reporting_plan": { "daily": string, "weekly": string, "post_campaign": string },',
    '  "budget_breakdown": [{ "item": string, "estimated_cost": string, "note": string }] | null,',
    '  "risks": [{ "risk": string, "likelihood": "high"|"medium"|"low", "mitigation": string }],',
    '  "next_steps": [{ "action": string, "timing": string }],',
    '  "approval_required": string[]',
    "}",
    "",
    "REQUIREMENTS",
    "- KPI must be measurable.",
    "- Risks must include mitigations.",
    "- Next steps should be immediately actionable."
  ]
    .filter(Boolean)
    .join("\n");
};

export const extractJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return value.slice(start, end + 1);
};

export const buildRepairPrompt = (params: {
  schemaName: string;
  schemaShape: string;
  originalPrompt: string;
  rawOutput: string;
}): string =>
  [
    "Your previous output did not match required JSON schema.",
    "Fix and return valid JSON only with no markdown and no comments.",
    `Schema name: ${params.schemaName}`,
    "",
    "ORIGINAL TASK",
    truncateToTokenBudget(params.originalPrompt, 1200),
    "",
    "REQUIRED SCHEMA",
    params.schemaShape,
    "",
    "PREVIOUS INVALID OUTPUT",
    truncateToTokenBudget(params.rawOutput, 800)
  ].join("\n");
