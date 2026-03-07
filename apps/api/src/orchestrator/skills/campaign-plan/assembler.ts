import type { CampaignPlan } from "../../types";
import type {
  AudienceMessagingData,
  ChannelStrategyData,
  ContentCalendarData,
  ExecutionData
} from "./chain-types";

const MISSING_SECTION_TEXT = "이 섹션은 단계 실패 또는 의존성 문제로 생성되지 않았습니다.";

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

const translatePhase = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "awareness") return "인지도";
  if (normalized === "engagement") return "참여";
  if (normalized === "conversion") return "전환";
  return value;
};

const translateEffort = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return "높음";
  if (normalized === "medium") return "보통";
  if (normalized === "low") return "낮음";
  return value;
};

const translatePriority = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "must") return "필수";
  if (normalized === "recommended") return "권장";
  return value;
};

const translateLikelihood = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return "높음";
  if (normalized === "medium") return "보통";
  if (normalized === "low") return "낮음";
  return value;
};

const translateFormat = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "text") return "텍스트";
  if (normalized === "image") return "이미지";
  if (normalized === "video") return "영상";
  return value;
};

const formatAudienceSection = (audience: AudienceMessagingData | null): string => {
  if (!audience) {
    return MISSING_SECTION_TEXT;
  }

  const secondary = audience.secondary_audience
    ? [
        `보조 타깃: ${audience.secondary_audience.label}`,
        audience.secondary_audience.description,
        `페인포인트: ${audience.secondary_audience.pain_points.join(", ") || "해당 없음"}`
      ].join("\n")
    : "보조 타깃: 없음";

  return [
    `주요 타깃: ${audience.primary_audience.label}`,
    audience.primary_audience.description || "해당 없음",
    `페인포인트: ${audience.primary_audience.pain_points.join(", ") || "해당 없음"}`,
    `주요 활동 채널: ${audience.primary_audience.active_platforms.join(", ") || "해당 없음"}`,
    "",
    secondary,
    "",
    "퍼널 정렬",
    `- 인지도: ${audience.funnel_alignment.awareness || "해당 없음"}`,
    `- 고려: ${audience.funnel_alignment.consideration || "해당 없음"}`,
    `- 전환: ${audience.funnel_alignment.decision || "해당 없음"}`
  ].join("\n");
};

const formatMessagingSection = (audience: AudienceMessagingData | null): string => {
  if (!audience) {
    return MISSING_SECTION_TEXT;
  }

  const supportRows = audience.support_messages.map((row) => [
    escapeCell(row.message || "해당 없음"),
    escapeCell(row.target_pain_point || "해당 없음"),
    escapeCell(row.evidence || "해당 없음")
  ]);
  const toneRows = Object.entries(audience.channel_tone_guide).map(([channel, tone]) => [
    escapeCell(channel),
    escapeCell(tone)
  ]);

  return [
    `핵심 메시지: ${audience.core_message || "해당 없음"}`,
    "",
    "보조 메시지",
    renderTable(["메시지", "대상 페인포인트", "근거"], supportRows),
    "",
    "채널별 톤 가이드",
    renderTable(["채널", "톤"], toneRows)
  ].join("\n");
};

const formatChannelSection = (channels: ChannelStrategyData | null): string => {
  if (!channels) {
    return MISSING_SECTION_TEXT;
  }

  const ownedRows = channels.owned_channels.map((row) => [
    escapeCell(row.channel),
    escapeCell(translateFormat(row.content_format || "해당 없음")),
    escapeCell(translateEffort(row.effort_level)),
    escapeCell(row.key_strategy || "해당 없음"),
    escapeCell(row.rationale || "해당 없음")
  ]);
  const earnedRows = channels.earned_channels.map((row) => [
    escapeCell(row.channel),
    escapeCell(translateEffort(row.effort_level)),
    escapeCell(row.execution || "해당 없음"),
    escapeCell(row.rationale || "해당 없음")
  ]);
  const paidRows = (channels.paid_reference ?? []).map((row) => [
    escapeCell(row.channel),
    escapeCell(row.estimated_budget || "해당 없음"),
    escapeCell(row.description || "해당 없음")
  ]);

  return [
    "자사 채널",
    renderTable(["채널", "형식", "난이도", "핵심 전략", "근거"], ownedRows),
    "",
    "획득 채널",
    renderTable(["채널", "난이도", "실행 방식", "근거"], earnedRows),
    "",
    "유료 채널 참고",
    paidRows.length
      ? renderTable(["채널", "예상 예산", "설명"], paidRows)
      : "유료 채널 참고 정보가 없습니다."
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
      escapeCell(translateFormat(item.format)),
      escapeCell(item.content_title || "해당 없음"),
      escapeCell(item.owner_hint || "해당 없음")
    ]);
    return [
      `### ${week.week_number}주차: ${week.theme} (${translatePhase(week.phase)})`,
      renderTable(["일차", "라벨", "채널", "형식", "제목", "담당"], rows)
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
    "의존 관계",
    dependencyRows.length
      ? renderTable(["선행 일차", "후속 일차", "설명"], dependencyRows)
      : "의존 관계가 없습니다."
  ].join("\n\n");
};

const formatAssetsSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  const rows = execution.required_assets.map((asset) => [
    String(asset.id),
    escapeCell(asset.name),
    escapeCell(asset.asset_type || "해당 없음"),
    escapeCell(translatePriority(asset.priority)),
    escapeCell(asset.deadline_hint || "해당 없음"),
    escapeCell(asset.description || "해당 없음")
  ]);
  return renderTable(["ID", "에셋", "유형", "우선순위", "마감", "설명"], rows);
};

const formatKpiSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }

  const primaryRows = execution.kpi_primary.map((row) => [
    escapeCell(row.metric),
    escapeCell(row.target || "해당 없음"),
    escapeCell(row.measurement || "해당 없음"),
    escapeCell(row.reporting_cadence || "해당 없음")
  ]);
  const secondaryRows = execution.kpi_secondary.map((row) => [
    escapeCell(row.metric),
    escapeCell(row.target || "해당 없음"),
    escapeCell(row.measurement || "해당 없음"),
    escapeCell(row.reporting_cadence || "해당 없음")
  ]);

  return [
    "핵심 KPI",
    renderTable(["지표", "목표", "측정 방식", "리포트 주기"], primaryRows),
    "",
    "보조 KPI",
    secondaryRows.length
      ? renderTable(["지표", "목표", "측정 방식", "리포트 주기"], secondaryRows)
      : "보조 KPI가 없습니다.",
    "",
    "리포팅 계획",
    `- 일간: ${execution.reporting_plan.daily || "해당 없음"}`,
    `- 주간: ${execution.reporting_plan.weekly || "해당 없음"}`,
    `- 캠페인 종료 후: ${execution.reporting_plan.post_campaign || "해당 없음"}`
  ].join("\n");
};

const formatBudgetSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  if (!execution.budget_breakdown || !execution.budget_breakdown.length) {
    return "이 초안에는 예산 배분이 아직 포함되지 않았습니다.";
  }
  return renderTable(
    ["항목", "예상 비용", "비고"],
    execution.budget_breakdown.map((entry) => [
      escapeCell(entry.item),
      escapeCell(entry.estimated_cost || "해당 없음"),
      escapeCell(entry.note || "해당 없음")
    ])
  );
};

const formatRiskSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  return renderTable(
    ["리스크", "발생 가능성", "대응 방안"],
    execution.risks.map((entry) => [
      escapeCell(entry.risk),
      escapeCell(translateLikelihood(entry.likelihood)),
      escapeCell(entry.mitigation || "해당 없음")
    ])
  );
};

const formatNextStepsSection = (execution: ExecutionData | null): string => {
  if (!execution) {
    return MISSING_SECTION_TEXT;
  }
  const nextStepLines = execution.next_steps.map((entry) => `${entry.action} (${entry.timing || "시점 미정"})`);
  const approvals = execution.approval_required.length
    ? execution.approval_required.map((entry) => `- ${entry}`).join("\n")
    : "- 없음";
  return ["다음 단계", renderList(nextStepLines), "", "승인 필요 항목", approvals].join("\n");
};

export const assembleCampaignPlanDocument = (params: {
  plan: CampaignPlan;
  audience: AudienceMessagingData | null;
  channels: ChannelStrategyData | null;
  calendar: ContentCalendarData | null;
  execution: ExecutionData | null;
  orgName: string;
  generatedAt: string;
}): string => {
  const title = `${params.orgName} 캠페인 계획서`;
  const section1 = [
    `캠페인 목표: ${params.plan.objective || "해당 없음"}`,
    `운영 채널: ${params.plan.channels.join(", ") || "해당 없음"}`,
    `운영 기간: ${params.plan.duration_days}일`,
    `콘텐츠 수: ${params.plan.post_count}`,
    params.audience?.core_message ? `핵심 메시지: ${params.audience.core_message}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const sections = [
    `# ${title}`,
    `생성 시각: ${params.generatedAt}`,
    "",
    "## 1. 캠페인 개요",
    section1 || MISSING_SECTION_TEXT,
    "",
    "## 2. 타깃 오디언스",
    formatAudienceSection(params.audience),
    "",
    "## 3. 핵심/보조 메시지",
    formatMessagingSection(params.audience),
    "",
    "## 4. 채널 전략",
    formatChannelSection(params.channels),
    "",
    "## 5. 콘텐츠 캘린더",
    formatCalendarSection(params.calendar),
    "",
    "## 6. 필요 에셋",
    formatAssetsSection(params.execution),
    "",
    "## 7. KPI 및 리포팅",
    formatKpiSection(params.execution),
    "",
    "## 8. 예산 구성",
    formatBudgetSection(params.execution),
    "",
    "## 9. 리스크 및 대응",
    formatRiskSection(params.execution),
    "",
    "## 10. 다음 단계 및 승인",
    formatNextStepsSection(params.execution)
  ];

  return sections.join("\n").trim();
};
