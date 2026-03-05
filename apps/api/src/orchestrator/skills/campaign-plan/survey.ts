import type { EnrichedCampaignContext } from "../../rag-context";
import type { SurveyAnswer, SurveyQuestion, SurveyQuestionId } from "../../types";

const CHANNEL_CATALOG = [
  { id: "instagram", label: "Instagram", tokens: ["instagram", "인스타", "insta"] },
  { id: "naver_blog", label: "Naver Blog", tokens: ["naver blog", "blog", "블로그", "네이버"] },
  { id: "facebook", label: "Facebook", tokens: ["facebook", "페이스북"] },
  { id: "threads", label: "Threads", tokens: ["threads", "스레드"] },
  { id: "youtube", label: "YouTube", tokens: ["youtube", "유튜브"] }
] as const;

const EARLY_EXIT_TERMS = ["진행", "바로", "이정도면", "그만", "skip", "proceed", "go ahead", "enough"];
const AFFIRMATIVE_TERMS = ["네", "예", "응", "좋아", "ok", "okay", "yes", "맞아", "그대로", "진행"];
const DIRECT_INPUT_HINT = '직접 입력이 필요하면 "직접입력: 내용" 형식으로 답변해 주세요.';
const DIRECT_INPUT_PREFIXES = ["직접입력", "직접 입력", "direct input", "custom", "other"];
const DIRECT_INPUT_CHOICE = "직접 입력";

const REQUIRED_QUESTION_IDS: SurveyQuestionId[] = ["campaign_goal", "channels"];
const QUESTION_ORDER: SurveyQuestionId[] = ["campaign_goal", "channels", "duration", "content_source"];

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
  if (/(없음|없어|없습니다|없어요|none|no asset|no assets|without asset|without assets)/.test(text)) {
    return "없음";
  }
  if (/(일부|조금|몇|some|partial)/.test(text)) {
    return "일부 있음";
  }
  if (/(있음|있어|있습니다|있어요|보유|have|has|available)/.test(text)) {
    return "있음";
  }
  if (/(사진|영상|비디오|문서|자료|폴더|asset|assets|content|folder)/.test(text)) {
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

const parseChoiceIndex = (normalizedMessage: string, choiceCount: number): number | null => {
  const indexMatch = normalizedMessage.match(/^(?:선택\s*)?(\d+)(?:\s*번)?$/);
  if (!indexMatch) {
    return null;
  }
  const parsed = Number.parseInt(indexMatch[1] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 1 || parsed > choiceCount) {
    return null;
  }
  return parsed - 1;
};

const isDirectInputChoice = (value: string): boolean => normalizeText(value) === normalizeText(DIRECT_INPUT_CHOICE);

const extractDirectInput = (
  rawMessage: string
): {
  isDirectInput: boolean;
  value: string;
} => {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return {
      isDirectInput: false,
      value: ""
    };
  }

  const lower = trimmed.toLowerCase();
  for (const prefix of DIRECT_INPUT_PREFIXES) {
    const normalizedPrefix = prefix.toLowerCase();
    if (lower.startsWith(`${normalizedPrefix}:`) || lower.startsWith(`${normalizedPrefix} :`)) {
      const index = trimmed.indexOf(":");
      return {
        isDirectInput: true,
        value: index >= 0 ? trimmed.slice(index + 1).trim() : ""
      };
    }
  }

  return {
    isDirectInput: false,
    value: trimmed
  };
};

const parseGoalByChoice = (question: SurveyQuestion, normalizedMessage: string): string | null => {
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const idx = parseChoiceIndex(normalizedMessage, choices.length);
  if (idx !== null) {
    const selected = choices[idx] ?? null;
    if (selected && !isDirectInputChoice(selected)) {
      return selected;
    }
    return null;
  }

  for (const choice of choices) {
    if (normalizeText(choice) === normalizedMessage && !isDirectInputChoice(choice)) {
      return choice;
    }
  }
  return detectGoal(normalizedMessage);
};

const parseChannelsByChoice = (question: SurveyQuestion, normalizedMessage: string): string | null => {
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const idx = parseChoiceIndex(normalizedMessage, choices.length);
  if (idx !== null) {
    const selected = choices[idx] ?? null;
    if (selected && !isDirectInputChoice(selected)) {
      return selected;
    }
    return null;
  }

  for (const choice of choices) {
    if (normalizeText(choice) === normalizedMessage && !isDirectInputChoice(choice)) {
      return choice;
    }
  }

  const channels = detectChannels(normalizedMessage);
  if (channels.length > 0) {
    return formatChannels(channels);
  }
  return null;
};

const parseDurationByChoice = (question: SurveyQuestion, normalizedMessage: string): string | null => {
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const idx = parseChoiceIndex(normalizedMessage, choices.length);
  if (idx !== null) {
    const selected = choices[idx] ?? null;
    if (selected && !isDirectInputChoice(selected)) {
      return selected;
    }
    return null;
  }

  const normalizedChoices = choices.map((entry) => normalizeText(entry));
  const exactChoice = choices.find((choice, index) => normalizedChoices[index] === normalizedMessage);
  if (exactChoice && !isDirectInputChoice(exactChoice)) {
    return exactChoice;
  }
  return detectDuration(normalizedMessage);
};

const parseContentSourceByChoice = (question: SurveyQuestion, normalizedMessage: string): string | null => {
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const idx = parseChoiceIndex(normalizedMessage, choices.length);
  if (idx !== null) {
    const selected = choices[idx] ?? null;
    if (selected && !isDirectInputChoice(selected)) {
      return selected;
    }
    return null;
  }

  for (const choice of choices) {
    if (normalizeText(choice) === normalizedMessage && !isDirectInputChoice(choice)) {
      return choice;
    }
  }
  return detectContentSource(normalizedMessage);
};

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "campaign_goal",
    priority: "required",
    label: "이번 캠페인의 핵심 목표는 무엇인가요?",
    choices: ["Awareness", "Engagement", "Conversion", DIRECT_INPUT_CHOICE]
  },
  {
    id: "channels",
    priority: "required",
    label: "어떤 채널에서 운영할까요?",
    choices: ["Instagram", "Naver Blog", "Facebook", "Threads", "YouTube", DIRECT_INPUT_CHOICE],
    auto_fill_source: "brand_review"
  },
  {
    id: "duration",
    priority: "optional",
    label: "캠페인 기간은 어느 정도로 잡을까요?",
    choices: ["1주", "2주", "1개월", DIRECT_INPUT_CHOICE]
  },
  {
    id: "content_source",
    priority: "optional",
    label: "활용할 기존 콘텐츠 자산(사진/영상/문서)이 있나요?",
    choices: ["있음", "없음", "일부 있음", DIRECT_INPUT_CHOICE],
    auto_fill_source: "folder_summary"
  }
];

const QUESTION_MAP: Record<SurveyQuestionId, SurveyQuestion> = {
  campaign_goal: SURVEY_QUESTIONS[0],
  channels: SURVEY_QUESTIONS[1],
  duration: SURVEY_QUESTIONS[2],
  content_source: SURVEY_QUESTIONS[3]
};

const parseAnswerByQuestion = (
  questionId: SurveyQuestionId,
  normalizedMessage: string
): string | null => {
  const question = QUESTION_MAP[questionId];
  if (!question) {
    return null;
  }
  switch (questionId) {
    case "campaign_goal":
      return parseGoalByChoice(question, normalizedMessage);
    case "channels":
      return parseChannelsByChoice(question, normalizedMessage);
    case "duration":
      return parseDurationByChoice(question, normalizedMessage);
    case "content_source":
      return parseContentSourceByChoice(question, normalizedMessage);
    default:
      return null;
  }
};

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
  autoFill.content_source = totalFiles > 0 || (ragContext.documentExtracts && ragContext.documentExtracts.trim()) ? "있음" : "없음";

  return autoFill;
};

export const extractAnswersFromInitialMessage = async (message: string): Promise<SurveyAnswer[]> => {
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

const formatQuestionChoices = (question: SurveyQuestion): string => {
  if (!Array.isArray(question.choices) || question.choices.length === 0) {
    return "자유롭게 답변해 주세요.";
  }
  return question.choices.map((choice, index) => `${index + 1}. ${choice}`).join("\n");
};

const buildAnsweredSummaryLines = (answers: SurveyAnswer[]): string[] => {
  const answerMap = toAnswerMap(answers);
  return QUESTION_ORDER.filter((questionId) => answerMap[questionId]).map((questionId) => {
    const question = QUESTION_MAP[questionId];
    return `- ${question.label}: ${answerMap[questionId]?.answer ?? ""}`;
  });
};

export const buildSurveyPrompt = (params: {
  pendingQuestions: SurveyQuestionId[];
  autoFillData: Partial<Record<SurveyQuestionId, string>>;
  answeredSoFar: SurveyAnswer[];
}): string => {
  const nextQuestionId = params.pendingQuestions[0];
  if (!nextQuestionId) {
    return "필수 정보는 충분합니다. 원하시면 '진행'이라고 답해 주세요. 바로 계획 초안을 만들겠습니다.";
  }

  const question = QUESTION_MAP[nextQuestionId];
  if (!question) {
    return "다음 정보를 알려주세요.";
  }

  const suggestion = params.autoFillData[nextQuestionId];
  const summaryLines = buildAnsweredSummaryLines(params.answeredSoFar);
  const summaryBlock = summaryLines.length > 0 ? `현재까지 정리:\n${summaryLines.join("\n")}\n\n` : "";
  const recommendationBlock = suggestion ? `기존 설정 기준 추천값: ${suggestion}\n` : "";

  return [
    `${summaryBlock}${question.label}`,
    recommendationBlock,
    "아래 선택지에서 번호나 값을 그대로 답변해 주세요.",
    formatQuestionChoices(question),
    DIRECT_INPUT_HINT
  ]
    .filter((line) => !!line)
    .join("\n");
};

export const buildSurveyPromptMetadata = (params: {
  pendingQuestions: SurveyQuestionId[];
  autoFillData: Partial<Record<SurveyQuestionId, string>>;
  answeredSoFar: SurveyAnswer[];
}): Record<string, unknown> => {
  const nextQuestionId = params.pendingQuestions[0];
  if (!nextQuestionId) {
    return {};
  }
  const question = QUESTION_MAP[nextQuestionId];
  if (!question) {
    return {};
  }

  const suggestion = params.autoFillData[nextQuestionId] ?? null;
  const summaryLines = buildAnsweredSummaryLines(params.answeredSoFar);
  return {
    survey_prompt: {
      type: "campaign_plan_survey",
      question_id: nextQuestionId,
      label: question.label,
      choices: question.choices ?? [],
      suggested_value: suggestion,
      allow_direct_input: true,
      direct_input_hint: DIRECT_INPUT_HINT,
      answered_summary: summaryLines,
      selection_mode: nextQuestionId === "channels" ? "single_or_multi" : "single"
    }
  };
};

export const parseSurveyAnswer = async (params: {
  userMessage: string;
  pendingQuestions: SurveyQuestionId[];
  autoFillData: Partial<Record<SurveyQuestionId, string>>;
  classifyDirectInput?: (input: {
    questionId: SurveyQuestionId;
    userMessage: string;
    choices: string[];
    suggestedValue: string | null;
    answeredSoFar?: SurveyAnswer[];
  }) => Promise<{ answer: string; confidence: number; reason?: string } | null>;
  answeredSoFar?: SurveyAnswer[];
}): Promise<SurveyAnswer[]> => {
  const answeredAt = new Date().toISOString();
  const nextQuestionId = params.pendingQuestions[0];
  if (!nextQuestionId) {
    return [];
  }

  const suggestion = params.autoFillData[nextQuestionId] ?? null;
  const question = QUESTION_MAP[nextQuestionId];
  if (!question) {
    return [];
  }

  const directInput = extractDirectInput(params.userMessage);
  const normalizedDirect = normalizeText(directInput.value);
  const normalizedRaw = normalizeText(params.userMessage);
  const parsedValue = parseAnswerByQuestion(nextQuestionId, normalizedDirect || normalizedRaw);

  if (parsedValue) {
    return [
      {
        question_id: nextQuestionId,
        answer: parsedValue,
        source: "user",
        answered_at: answeredAt
      }
    ];
  }

  if (!directInput.isDirectInput && suggestion && hasAny(normalizedRaw, AFFIRMATIVE_TERMS)) {
    return [
      {
        question_id: nextQuestionId,
        answer: suggestion,
        source: "auto_filled",
        answered_at: answeredAt
      }
    ];
  }

  if (directInput.isDirectInput && params.classifyDirectInput && directInput.value.trim()) {
    const llmResult = await params.classifyDirectInput({
      questionId: nextQuestionId,
      userMessage: directInput.value.trim(),
      choices: question.choices ?? [],
      suggestedValue: suggestion,
      answeredSoFar: params.answeredSoFar
    });

    if (llmResult && llmResult.answer.trim()) {
      return [
        {
          question_id: nextQuestionId,
          answer: llmResult.answer.trim(),
          source: "user",
          answered_at: answeredAt
        }
      ];
    }
  }

  if (directInput.isDirectInput && directInput.value.trim()) {
    return [
      {
        question_id: nextQuestionId,
        answer: directInput.value.trim(),
        source: "user",
        answered_at: answeredAt
      }
    ];
  }

  return [];
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
