import type { CampaignPlan } from "../../types";
import type {
  AudienceMessagingData,
  CampaignPlanChainData,
  ChannelStrategyData,
  ContentCalendarData,
  ExecutionData
} from "./chain-types";

const MISSING_SECTION_TEXT = "This section is unavailable due to step failure or dependency block.";

const renderList = (items: string[]): string => {
  if (!items.length) {
    return `- ${MISSING_SECTION_TEXT}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
};

const renderTable = (headers: string[], rows: string[][]): string => {
  if (!rows.length) {
    return MISSING_SECTION_TEXT;
  }
  const headerRow = `| ${headers.join(" | ")} |`;
  const dividerRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [headerRow, dividerRow, body].join("\n");
};

const escapeCell = (value: string): string => value.replace(/\|/g, "\\|").trim();

const formatAudienceSection = (audience: AudienceMessagingData | null): string => {
  if (!audience) {
    return MISSING_SECTION_TEXT;
  }

  const secondary = audience.secondary_audience
    ? [
        `Secondary: ${audience.secondary_audience.label}`,
        audience.secondary_audience.description,
        `Pain points: ${audience.secondary_audience.pain_points.join(", ") || "n/a"}`
      ].join("\n")
    : "Secondary: none";

  return [
    `Primary: ${audience.primary_audience.label}`,
    audience.primary_audience.description || "n/a",
    `Pain points: ${audience.primary_audience.pain_points.join(", ") || "n/a"}`,
    `Active platforms: ${audience.primary_audience.active_platforms.join(", ") || "n/a"}`,
    "",
    secondary,
    "",
    "Funnel alignment",
    `- Awareness: ${audience.funnel_alignment.awareness || "n/a"}`,
    `- Consideration: ${audience.funnel_alignment.consideration || "n/a"}`,
    `- Decision: ${audience.funnel_alignment.decision || "n/a"}`
  ].join("\n");
};

const formatMessagingSection = (audience: AudienceMessagingData | null): string => {
  if (!audience) {
    return MISSING_SECTION_TEXT;
  }

  const supportRows = audience.support_messages.map((row) => [
    escapeCell(row.message || "n/a"),
    escapeCell(row.target_pain_point || "n/a"),
    escapeCell(row.evidence || "n/a")
  ]);
  const toneRows = Object.entries(audience.channel_tone_guide).map(([channel, tone]) => [
    escapeCell(channel),
    escapeCell(tone)
  ]);

  return [
    `Core message: ${audience.core_message || "n/a"}`,
    "",
    "Support messages",
    renderTable(["Message", "Target pain point", "Evidence"], supportRows),
    "",
    "Tone guide by channel",
    renderTable(["Channel", "Tone"], toneRows)
  ].join("\n");
};

const formatChannelSection = (channels: ChannelStrategyData | null): string => {
  if (!channels) {
    return MISSING_SECTION_TEXT;
  }

  const ownedRows = channels.owned_channels.map((row) => [
    escapeCell(row.channel),
    escapeCell(row.content_format || "n/a"),
    escapeCell(row.effort_level),
    escapeCell(row.key_strategy || "n/a"),
    escapeCell(row.rationale || "n/a")
  ]);
  const earnedRows = channels.earned_channels.map((row) => [
    escapeCell(row.channel),
    escapeCell(row.effort_level),
    escapeCell(row.execution || "n/a"),
    escapeCell(row.rationale || "n/a")
  ]);
  const paidRows = (channels.paid_reference ?? []).map((row) => [
    escapeCell(row.channel),
    escapeCell(row.estimated_budget || "n/a"),
    escapeCell(row.description || "n/a")
  ]);

  return [
    "Owned channels",
    renderTable(["Channel", "Format", "Effort", "Key strategy", "Rationale"], ownedRows),
    "",
    "Earned channels",
    renderTable(["Channel", "Effort", "Execution", "Rationale"], earnedRows),
    "",
    "Paid reference",
    paidRows.length
      ? renderTable(["Channel", "Estimated budget", "Description"], paidRows)
      : "No paid reference provided."
  ].join("\n");
};

const formatCalendarSection = (calendar: ContentCalendarData | null): string => {
  if (!calendar) {
    return MISSING_SECTION_TEXT;
  }

  const weekBlocks = calendar.weeks.map((week) => {
    const rows = week.items.map((item) => [
      String(item.day),
      escapeCell(item.day_label || `D${item.day}`),
      escapeCell(item.channel),
      escapeCell(item.format),
      escapeCell(item.content_title || "n/a"),
      escapeCell(item.owner_hint || "n/a")
    ]);
    return [
      `### Week ${week.week_number}: ${week.theme} (${week.phase})`,
      renderTable(["Day", "Label", "Channel", "Format", "Title", "Owner"], rows)
    ].join("\n");
  });

  const dependencyRows = calendar.dependencies.map((entry) => [
    String(entry.source_day),
    String(entry.target_day),
    escapeCell(entry.description)
  ]);

  return [
    ...weekBlocks,
    "",
    "Dependencies",
    dependencyRows.length
      ? renderTable(["Source day", "Target day", "Description"], dependencyRows)
      : "No dependencies declared."
  ].join("\n\n");
};

const formatAssetsSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  const rows = execution.required_assets.map((asset) => [
    String(asset.id),
    escapeCell(asset.name),
    escapeCell(asset.asset_type || "n/a"),
    escapeCell(asset.priority),
    escapeCell(asset.deadline_hint || "n/a"),
    escapeCell(asset.description || "n/a")
  ]);
  return renderTable(["ID", "Asset", "Type", "Priority", "Deadline", "Description"], rows);
};

const formatKpiSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }

  const primaryRows = execution.kpi_primary.map((row) => [
    escapeCell(row.metric),
    escapeCell(row.target || "n/a"),
    escapeCell(row.measurement || "n/a"),
    escapeCell(row.reporting_cadence || "n/a")
  ]);
  const secondaryRows = execution.kpi_secondary.map((row) => [
    escapeCell(row.metric),
    escapeCell(row.target || "n/a"),
    escapeCell(row.measurement || "n/a"),
    escapeCell(row.reporting_cadence || "n/a")
  ]);

  return [
    "Primary KPI",
    renderTable(["Metric", "Target", "Measurement", "Cadence"], primaryRows),
    "",
    "Secondary KPI",
    secondaryRows.length
      ? renderTable(["Metric", "Target", "Measurement", "Cadence"], secondaryRows)
      : "No secondary KPI provided.",
    "",
    "Reporting plan",
    `- Daily: ${execution.reporting_plan.daily || "n/a"}`,
    `- Weekly: ${execution.reporting_plan.weekly || "n/a"}`,
    `- Post-campaign: ${execution.reporting_plan.post_campaign || "n/a"}`
  ].join("\n");
};

const formatBudgetSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  if (!execution.budget_breakdown || !execution.budget_breakdown.length) {
    return "Budget is not allocated in this draft.";
  }
  return renderTable(
    ["Item", "Estimated cost", "Note"],
    execution.budget_breakdown.map((entry) => [
      escapeCell(entry.item),
      escapeCell(entry.estimated_cost || "n/a"),
      escapeCell(entry.note || "n/a")
    ])
  );
};

const formatRiskSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  return renderTable(
    ["Risk", "Likelihood", "Mitigation"],
    execution.risks.map((entry) => [
      escapeCell(entry.risk),
      escapeCell(entry.likelihood),
      escapeCell(entry.mitigation || "n/a")
    ])
  );
};

const formatNextStepsSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  const nextStepLines = execution.next_steps.map((entry) => `${entry.action} (${entry.timing || "timing n/a"})`);
  const approvals = execution.approval_required.length
    ? execution.approval_required.map((entry) => `- ${entry}`).join("\n")
    : "- None";
  return [`Next steps`, renderList(nextStepLines), "", "Approvals required", approvals].join("\n");
};

const summarizeContextLevel = (chain: CampaignPlanChainData): string => {
  const stateLine = [
    `Step A=${chain.step_meta.step_a.state}`,
    `Step B=${chain.step_meta.step_b.state}`,
    `Step C=${chain.step_meta.step_c.state}`,
    `Step D=${chain.step_meta.step_d.state}`
  ].join(", ");
  return `Chain status: ${stateLine}`;
};

export const assembleCampaignPlanDocument = (params: {
  plan: CampaignPlan;
  audience: AudienceMessagingData | null;
  channels: ChannelStrategyData | null;
  calendar: ContentCalendarData | null;
  execution: ExecutionData | null;
  orgName: string;
  generatedAt: string;
  chain?: CampaignPlanChainData | null;
}): string => {
  const title = `${params.orgName} Campaign Plan`;
  const section1 = [
    `Campaign objective: ${params.plan.objective || "n/a"}`,
    `Channels: ${params.plan.channels.join(", ") || "n/a"}`,
    `Duration: ${params.plan.duration_days} days`,
    `Post count: ${params.plan.post_count}`,
    params.audience?.core_message ? `Core message: ${params.audience.core_message}` : null,
    params.chain ? summarizeContextLevel(params.chain) : null
  ]
    .filter(Boolean)
    .join("\n");

  const sections = [
    `# ${title}`,
    `Generated at: ${params.generatedAt}`,
    "",
    "## 1. Campaign Overview",
    section1 || MISSING_SECTION_TEXT,
    "",
    "## 2. Target Audiences",
    formatAudienceSection(params.audience),
    "",
    "## 3. Core and Support Messaging",
    formatMessagingSection(params.audience),
    "",
    "## 4. Channel Strategy",
    formatChannelSection(params.channels),
    "",
    "## 5. Content Calendar",
    formatCalendarSection(params.calendar),
    "",
    "## 6. Required Assets",
    formatAssetsSection(params.execution),
    "",
    "## 7. KPI and Reporting",
    formatKpiSection(params.execution),
    "",
    "## 8. Budget Breakdown",
    formatBudgetSection(params.execution),
    "",
    "## 9. Risks and Mitigation",
    formatRiskSection(params.execution),
    "",
    "## 10. Next Steps and Approvals",
    formatNextStepsSection(params.execution)
  ];

  return sections.join("\n").trim();
};
