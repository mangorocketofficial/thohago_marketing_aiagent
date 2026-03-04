import type { EnrichedCampaignContext } from "../../rag-context";
import type { SurveyAnswer, SurveyQuestion, SurveyQuestionId } from "../../types";

const CHANNEL_CATALOG = [
  { id: "instagram", label: "Instagram", tokens: ["instagram", "인스타", "insta"] },
  { id: "naver_blog", label: "Naver Blog", tokens: ["naver blog", "blog", "블로그", "네이버"] },
  { id: "facebook", label: "Facebook", tokens: ["facebook", "페이스북"] },
  { id: "threads", label: "Threads", tokens: ["threads", "스레드"] },
  { id: "youtube", label: "YouTube", tokens: ["youtube", "유튜브"] }
] as const;

const EARLY_EXIT_TERMS = [
  "진행",
  "바로",
  "이정도면",
  "그만",
  "skip",
  "proceed",
  "go ahead",
  "enough"
];

const AFFIRMATIVE_TERMS = ["네", "예", "응", "좋아", "ok", "okay", "yes", "맞아", "그대로", "진행"];

const REQUIRED_QUESTION_IDS: SurveyQuestionId[] = ["campaign_goal", "channels"];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, terms: string[]): boolean => terms.some((term) => text.includes(term));

const toAnswerMap = (answers: SurveyAnswer[]): Partial<Record<SurveyQuestionId, SurveyAnswer>> => {
  const map: Partial<Record<SurveyQuestionId, SurveyAnswer>> = {};
  for (const answer of answers) {
    map[answer.question_id] = answer;
  }
  return map;
};

const detectGoal = (text: string): string | null => {
  if (!text) {
    return null;
  }
  if (/(awareness|인지|브랜딩|노출|알리)/.test(text)) {
    return "Awareness";
  }
  if (/(engagement|참여|반응|댓글|공유)/.test(text)) {
    return "Engagement";
  }
  if (/(conversion|전환|후원|모금|가입|신청|donation|signup)/.test(text)) {
    return "Conversion";
  }
  return null;
};

const detectChannels = (text: string): string[] => {
  if (!text) {
    return [];
  }
  const detected: string[] = [];
  for (const channel of CHANNEL_CATALOG) {
    if (channel.tokens.some((token) => text.includes(token))) {
      detected.push(channel.id);
    }
  }
  return [...new Set(detected)];
};

const formatChannels = (channels: string[]): string => {
  if (!channels.length) {
    return "";
  }
  const labels = channels.map((channelId) => CHANNEL_CATALOG.find((entry) => entry.id === channelId)?.label ?? channelId);
  return [...new Set(labels)].join(", ");
};

const detectDuration = (text: string): string | null => {
  if (!text) {
    return null;
  }

  const weekMatch = text.match(/(\d+)\s*(주|week)/);
  if (weekMatch) {
    return `${weekMatch[1]}주`;
  }

  const monthMatch = text.match(/(\d+)\s*(개월|달|month)/);
  if (monthMatch) {
    return `${monthMatch[1]}개월`;
  }

  if (/(1개월|한 달|one month)/.test(text)) {
    return "1개월";
  }
  if (/(2주|two weeks)/.test(text)) {
    return "2주";
  }
  if (/(1주|일주일|one week)/.test(text)) {
    return "1주";
  }

  return null;
};

const detectContentSource = (text: string): string | null => {
  if (!text) {
    return null;
  }
  if (/(없|없음|none|no asset|no assets)/.test(text)) {
    return "없음";
  }
  if (/(일부|조금|some)/.test(text)) {
    return "일부 있음";
  }
  if (/(사진|영상|비디오|문서|자료|asset|assets|content)/.test(text)) {
    return "있음";
  }
  return null;
};

const parseTotalFiles = (folderSummary: string | null): number => {
  if (!folderSummary) {
    return 0;
  }
  const match = folderSummary.match(/total files:\s*(\d+)/i);
  if (!match) {
    return 0;
  }
  const parsed = Number.parseInt(match[1] ?? "0", 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, parsed);
};

const upsertAnswers = (base: SurveyAnswer[], updates: SurveyAnswer[]): SurveyAnswer[] => {
  const map = new Map<SurveyQuestionId, SurveyAnswer>();
  for (const answer of base) {
    map.set(answer.question_id, answer);
  }
  for (const answer of updates) {
    map.set(answer.question_id, answer);
  }
  return [...map.values()];
};

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "campaign_goal",
    priority: "required",
    label: "이번 캠페인의 핵심 목표는 무엇인가요?",
    choices: ["Awareness", "Engagement", "Conversion", "Other"]
  },
  {
    id: "channels",
    priority: "required",
    label: "어떤 채널에서 운영할까요?",
    choices: ["Instagram", "Naver Blog", "Facebook", "Threads", "YouTube"],
    auto_fill_source: "brand_review"
  },
  {
    id: "duration",
    priority: "optional",
    label: "캠페인 기간은 어느 정도로 잡을까요?",
    choices: ["1주", "2주", "1개월", "직접 입력"]
  },
  {
    id: "content_source",
    priority: "optional",
    label: "활용할 기존 콘텐츠 자산(사진/영상/문서)이 있나요?",
    choices: ["있음", "없음", "일부 있음"],
    auto_fill_source: "folder_summary"
  }
];

export const buildSurveyAutoFillData = (
  ragContext: EnrichedCampaignContext
): Partial<Record<SurveyQuestionId, string>> => {
  const autoFill: Partial<Record<SurveyQuestionId, string>> = {};

  const brandChannels = detectChannels(
    normalizeText(`${ragContext.brandReviewMd ?? ""} ${ragContext.interviewAnswers?.q2 ?? ""}`)
  );
  if (brandChannels.length > 0) {
    autoFill.channels = formatChannels(brandChannels);
  }

  const totalFiles = parseTotalFiles(ragContext.folderSummary);
  if (totalFiles > 0 || (ragContext.documentExtracts && ragContext.documentExtracts.trim())) {
    autoFill.content_source = "있음";
  } else {
    autoFill.content_source = "없음";
  }

  return autoFill;
};

export const extractAnswersFromInitialMessage = async (
  message: string
): Promise<SurveyAnswer[]> => {
  const normalized = normalizeText(message);
  const answers: SurveyAnswer[] = [];
  const answeredAt = new Date().toISOString();

  const goal = detectGoal(normalized);
  if (goal) {
    answers.push({
      question_id: "campaign_goal",
      answer: goal,
      source: "extracted_from_initial_message",
      answered_at: answeredAt
    });
  }

  const channels = detectChannels(normalized);
  if (channels.length > 0) {
    answers.push({
      question_id: "channels",
      answer: formatChannels(channels),
      source: "extracted_from_initial_message",
      answered_at: answeredAt
    });
  }

  const duration = detectDuration(normalized);
  if (duration) {
    answers.push({
      question_id: "duration",
      answer: duration,
      source: "extracted_from_initial_message",
      answered_at: answeredAt
    });
  }

  const contentSource = detectContentSource(normalized);
  if (contentSource) {
    answers.push({
      question_id: "content_source",
      answer: contentSource,
      source: "extracted_from_initial_message",
      answered_at: answeredAt
    });
  }

  return answers;
};

export const buildPendingQuestions = (
  allQuestions: SurveyQuestion[],
  answers: SurveyAnswer[]
): SurveyQuestionId[] => {
  const answeredIds = new Set(answers.map((answer) => answer.question_id));
  return allQuestions.map((question) => question.id).filter((questionId) => !answeredIds.has(questionId));
};

const formatQuestionChoices = (question: SurveyQuestion): string =>
  Array.isArray(question.choices) && question.choices.length > 0
    ? `선택 예시: ${question.choices.join(" / ")}`
    : "자유롭게 답변해 주세요.";

export const buildSurveyPrompt = (params: {
  pendingQuestions: SurveyQuestionId[];
  autoFillData: Partial<Record<SurveyQuestionId, string>>;
  answeredSoFar: SurveyAnswer[];
}): string => {
  const nextQuestionId = params.pendingQuestions[0];
  if (!nextQuestionId) {
    return "필수 정보는 충분합니다. 원하시면 '진행'이라고 답해 주세요. 바로 계획 초안을 만들겠습니다.";
  }

  const question = SURVEY_QUESTIONS.find((entry) => entry.id === nextQuestionId);
  if (!question) {
    return "다음 정보를 알려주세요.";
  }

  const suggestion = params.autoFillData[nextQuestionId];
  const answerMap = toAnswerMap(params.answeredSoFar);
  const summaryLines = SURVEY_QUESTIONS.filter((entry) => answerMap[entry.id]).map(
    (entry) => `- ${entry.label}: ${answerMap[entry.id]?.answer ?? ""}`
  );

  const summaryBlock = summaryLines.length > 0 ? `현재까지 정리:\n${summaryLines.join("\n")}\n\n` : "";
  if (suggestion) {
    return `${summaryBlock}${question.label}\n기존 설정 기준 추천값: ${suggestion}\n이대로 진행하면 "네"라고 답하고, 변경하려면 원하는 값을 알려주세요.\n${formatQuestionChoices(
      question
    )}`;
  }

  return `${summaryBlock}${question.label}\n${formatQuestionChoices(question)}`;
};

const parseSingleAnswer = (
  questionId: SurveyQuestionId,
  normalizedMessage: string,
  rawMessage: string
): string | null => {
  switch (questionId) {
    case "campaign_goal":
      return detectGoal(normalizedMessage) ?? null;
    case "channels": {
      const channels = detectChannels(normalizedMessage);
      return channels.length > 0 ? formatChannels(channels) : null;
    }
    case "duration":
      return detectDuration(normalizedMessage) ?? null;
    case "content_source":
      return detectContentSource(normalizedMessage) ?? null;
    default: {
      const trimmed = rawMessage.trim();
      return trimmed || null;
    }
  }
};

export const parseSurveyAnswer = async (params: {
  userMessage: string;
  pendingQuestions: SurveyQuestionId[];
  autoFillData: Partial<Record<SurveyQuestionId, string>>;
}): Promise<SurveyAnswer[]> => {
  const normalized = normalizeText(params.userMessage);
  const answeredAt = new Date().toISOString();
  const parsed: SurveyAnswer[] = [];

  for (const questionId of params.pendingQuestions) {
    const parsedValue = parseSingleAnswer(questionId, normalized, params.userMessage);
    if (parsedValue) {
      parsed.push({
        question_id: questionId,
        answer: parsedValue,
        source: "user",
        answered_at: answeredAt
      });
      continue;
    }

    const suggestion = params.autoFillData[questionId];
    if (suggestion && hasAny(normalized, AFFIRMATIVE_TERMS)) {
      parsed.push({
        question_id: questionId,
        answer: suggestion,
        source: "auto_filled",
        answered_at: answeredAt
      });
    }
  }

  return upsertAnswers([], parsed);
};

export const applyAutoFillToPendingOptional = (params: {
  answers: SurveyAnswer[];
  pendingQuestions: SurveyQuestionId[];
  autoFillData: Partial<Record<SurveyQuestionId, string>>;
}): SurveyAnswer[] => {
  const now = new Date().toISOString();
  const optionalPending = params.pendingQuestions.filter((questionId) => !REQUIRED_QUESTION_IDS.includes(questionId));
  const autoAnswers: SurveyAnswer[] = optionalPending.map((questionId) => ({
    question_id: questionId,
    answer: params.autoFillData[questionId] ?? "미정",
    source: "auto_filled",
    answered_at: now
  }));
  return upsertAnswers(params.answers, autoAnswers);
};

export const isEarlyExitIntent = (message: string): boolean => hasAny(normalizeText(message), EARLY_EXIT_TERMS);

const hasAllRequiredAnswers = (answers: SurveyAnswer[]): boolean => {
  const answerMap = toAnswerMap(answers);
  return REQUIRED_QUESTION_IDS.every((questionId) => {
    const answer = answerMap[questionId]?.answer?.trim();
    return !!answer;
  });
};

export const canEarlyExit = (params: {
  answers: SurveyAnswer[];
  pendingQuestions: SurveyQuestionId[];
}): boolean => {
  if (!hasAllRequiredAnswers(params.answers)) {
    return false;
  }
  return params.pendingQuestions.every((questionId) => !REQUIRED_QUESTION_IDS.includes(questionId));
};

export const isSurveyComplete = (params: {
  answers: SurveyAnswer[];
  pendingQuestions: SurveyQuestionId[];
  earlyExitRequested: boolean;
}): boolean => {
  if (!hasAllRequiredAnswers(params.answers)) {
    return false;
  }
  if (params.pendingQuestions.length === 0) {
    return true;
  }
  return params.earlyExitRequested && canEarlyExit({ answers: params.answers, pendingQuestions: params.pendingQuestions });
};

export const buildChainInputFromSurvey = (answers: SurveyAnswer[]): string => {
  const answerMap = toAnswerMap(answers);
  const goal = answerMap.campaign_goal?.answer ?? "미정";
  const channels = answerMap.channels?.answer ?? "미정";
  const duration = answerMap.duration?.answer ?? "미정";
  const contentSource = answerMap.content_source?.answer ?? "미정";

  return [
    "사용자 캠페인 브리프",
    `- 목표: ${goal}`,
    `- 채널: ${channels}`,
    `- 기간: ${duration}`,
    `- 기존 콘텐츠 자산: ${contentSource}`,
    "위 정보를 기반으로 실행 가능한 캠페인 계획을 작성하세요."
  ].join("\n");
};

