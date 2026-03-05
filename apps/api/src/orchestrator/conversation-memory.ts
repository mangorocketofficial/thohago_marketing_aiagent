import { countTokens, truncateToTokenBudget } from "@repo/rag";
import { env } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase-admin";

type ChatRole = "user" | "assistant";
type ChatMessageType = "text" | "system" | "action_card";

type SessionChatMessage = {
  role: ChatRole;
  content: string;
  messageType: ChatMessageType;
  createdAt: string;
};

export type WorkingMemoryMessage = {
  role: ChatRole;
  content: string;
};

export type WorkingMemoryResult = {
  messages: WorkingMemoryMessage[];
  tokenCount: number;
  sourceMessageCount: number;
  includesCurrentUserMessage: boolean;
};

const isMissingTableError = (error: unknown, tableName: string): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes(tableName.toLowerCase()) &&
    (normalized.includes("could not find the table") || normalized.includes("does not exist"))
  );
};

const isMissingColumnError = (error: unknown, columnName: string): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const normalized = message.toLowerCase();
  const column = columnName.toLowerCase();
  return normalized.includes(column) && (normalized.includes("does not exist") || normalized.includes("could not find the column"));
};

const normalizeRole = (value: unknown): ChatRole | null => {
  if (value === "user") {
    return "user";
  }
  if (value === "assistant") {
    return "assistant";
  }
  return null;
};

const normalizeMessageType = (value: unknown): ChatMessageType => {
  if (value === "system") {
    return "system";
  }
  if (value === "action_card") {
    return "action_card";
  }
  return "text";
};

const normalizeText = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const normalizeForCompare = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const toSystemDigest = (content: string): string => {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return `[System note] ${truncateToTokenBudget(compact, 80)}`;
};

const readRecentSessionMessages = async (params: {
  orgId: string;
  sessionId: string;
  limit: number;
}): Promise<SessionChatMessage[]> => {
  const runPrimaryQuery = async () =>
    supabaseAdmin
      .from("chat_messages")
      .select("role,content,message_type,created_at")
      .eq("org_id", params.orgId)
      .eq("session_id", params.sessionId)
      .order("created_at", { ascending: false })
      .limit(params.limit);

  const runFallbackQuery = async () =>
    supabaseAdmin
      .from("chat_messages")
      .select("role,content,created_at")
      .eq("org_id", params.orgId)
      .eq("session_id", params.sessionId)
      .order("created_at", { ascending: false })
      .limit(params.limit);

  const { data, error } = await runPrimaryQuery();
  if (error) {
    if (isMissingTableError(error, "chat_messages")) {
      return [];
    }
    if (isMissingColumnError(error, "message_type")) {
      const { data: fallbackData, error: fallbackError } = await runFallbackQuery();
      if (fallbackError) {
        if (!isMissingTableError(fallbackError, "chat_messages")) {
          console.warn(`[CONVERSATION_MEMORY] Fallback message query failed: ${fallbackError.message}`);
        }
        return [];
      }
      return ((fallbackData as Record<string, unknown>[] | null) ?? []).flatMap((row) => {
        const role = normalizeRole(row.role);
        const content = normalizeText(row.content);
        const createdAt = normalizeText(row.created_at);
        if (!role || !content) {
          return [];
        }
        return [
          {
            role,
            content,
            messageType: "text",
            createdAt
          }
        ];
      });
    }
    console.warn(`[CONVERSATION_MEMORY] Message query failed: ${error.message}`);
    return [];
  }

  return ((data as Record<string, unknown>[] | null) ?? []).flatMap((row) => {
    const role = normalizeRole(row.role);
    const content = normalizeText(row.content);
    const createdAt = normalizeText(row.created_at);
    if (!role || !content) {
      return [];
    }
    return [
      {
        role,
        content,
        messageType: normalizeMessageType(row.message_type),
        createdAt
      }
    ];
  });
};

const filterAndNormalizeForPrompt = (messages: SessionChatMessage[]): WorkingMemoryMessage[] => {
  return messages.flatMap((message) => {
    if (message.messageType === "action_card") {
      return [];
    }
    if (message.messageType === "system") {
      if (message.role !== "assistant") {
        return [];
      }
      const digest = toSystemDigest(message.content);
      if (!digest) {
        return [];
      }
      return [
        {
          role: "assistant" as const,
          content: digest
        }
      ];
    }
    return [
      {
        role: message.role,
        content: message.content
      }
    ];
  });
};

export const loadWorkingMemoryForSession = async (params: {
  orgId: string;
  sessionId: string;
  currentUserMessage: string;
}): Promise<WorkingMemoryResult> => {
  const fetchLimit = Math.max(20, env.workingMemoryMaxTurns * 6);
  const recent = await readRecentSessionMessages({
    orgId: params.orgId,
    sessionId: params.sessionId,
    limit: fetchLimit
  });
  if (!recent.length) {
    return {
      messages: [],
      tokenCount: 0,
      sourceMessageCount: 0,
      includesCurrentUserMessage: false
    };
  }

  const normalized = filterAndNormalizeForPrompt(recent).reverse();
  const maxMessages = Math.max(2, env.workingMemoryMaxTurns * 2);
  const budget = Math.max(120, env.workingMemoryTokenBudget);
  const selected: WorkingMemoryMessage[] = [];
  let usedTokens = 0;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (selected.length >= maxMessages) {
      break;
    }

    const entry = normalized[index];
    const candidateTokenCount = countTokens(`${entry.role}:${entry.content}`);
    const remaining = budget - usedTokens;
    if (remaining <= 0) {
      break;
    }

    if (candidateTokenCount > remaining) {
      if (selected.length === 0) {
        const clipped = truncateToTokenBudget(entry.content, Math.max(30, remaining - 10));
        if (clipped) {
          selected.push({
            role: entry.role,
            content: clipped
          });
          usedTokens += countTokens(`${entry.role}:${clipped}`);
        }
      }
      continue;
    }

    selected.push(entry);
    usedTokens += candidateTokenCount;
  }

  selected.reverse();
  const currentUserNormalized = normalizeForCompare(params.currentUserMessage);
  const includesCurrentUserMessage =
    !!currentUserNormalized &&
    selected.some((entry) => entry.role === "user" && normalizeForCompare(entry.content) === currentUserNormalized);

  return {
    messages: selected,
    tokenCount: usedTokens,
    sourceMessageCount: recent.length,
    includesCurrentUserMessage
  };
};

const loadSessionMemoryRow = async (params: { orgId: string; sessionId: string }): Promise<{
  sourceMessageCount: number;
  rollingSummaryText: string;
} | null> => {
  const { data, error } = await supabaseAdmin
    .from("session_memory")
    .select("source_message_count,rolling_summary_text")
    .eq("org_id", params.orgId)
    .eq("session_id", params.sessionId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error, "session_memory")) {
      return null;
    }
    console.warn(`[CONVERSATION_MEMORY] Session memory read failed: ${error.message}`);
    return null;
  }

  if (!data) {
    return null;
  }

  const row = data as Record<string, unknown>;
  return {
    sourceMessageCount:
      typeof row.source_message_count === "number" && Number.isFinite(row.source_message_count)
        ? Math.max(0, Math.floor(row.source_message_count))
        : 0,
    rollingSummaryText: normalizeText(row.rolling_summary_text)
  };
};

const countSessionTextMessages = async (params: { orgId: string; sessionId: string }): Promise<number | null> => {
  const tryCountWithMessageType = async () =>
    supabaseAdmin
      .from("chat_messages")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", params.orgId)
      .eq("session_id", params.sessionId)
      .eq("message_type", "text");

  const tryCountFallback = async () =>
    supabaseAdmin
      .from("chat_messages")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", params.orgId)
      .eq("session_id", params.sessionId);

  const { count, error } = await tryCountWithMessageType();
  if (error) {
    if (isMissingTableError(error, "chat_messages")) {
      return null;
    }
    if (isMissingColumnError(error, "message_type")) {
      const { count: fallbackCount, error: fallbackError } = await tryCountFallback();
      if (fallbackError) {
        if (!isMissingTableError(fallbackError, "chat_messages")) {
          console.warn(`[CONVERSATION_MEMORY] Count fallback failed: ${fallbackError.message}`);
        }
        return null;
      }
      return typeof fallbackCount === "number" && Number.isFinite(fallbackCount) ? Math.max(0, fallbackCount) : 0;
    }
    console.warn(`[CONVERSATION_MEMORY] Count failed: ${error.message}`);
    return null;
  }

  return typeof count === "number" && Number.isFinite(count) ? Math.max(0, count) : 0;
};

const buildRollingSummary = (messages: WorkingMemoryMessage[]): {
  summaryJson: Record<string, unknown>;
  summaryText: string;
} | null => {
  if (!messages.length) {
    return null;
  }

  const userMessages = messages.filter((entry) => entry.role === "user").map((entry) => entry.content);
  const assistantMessages = messages.filter((entry) => entry.role === "assistant").map((entry) => entry.content);
  const latestUserRequests = userMessages.slice(Math.max(0, userMessages.length - 6)).map((entry) =>
    truncateToTokenBudget(entry, 40)
  );
  const latestAssistantReplies = assistantMessages
    .slice(Math.max(0, assistantMessages.length - 6))
    .map((entry) => truncateToTokenBudget(entry, 40));

  const openQuestions = latestUserRequests
    .filter((entry) => entry.includes("?"))
    .slice(Math.max(0, latestUserRequests.length - 3));

  const summaryJson = {
    latest_user_requests: latestUserRequests,
    latest_assistant_replies: latestAssistantReplies,
    open_questions: openQuestions,
    last_updated_at: new Date().toISOString()
  };

  const lines: string[] = ["Session snapshot", "Recent user requests:"];
  if (latestUserRequests.length) {
    for (const item of latestUserRequests) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- none");
  }

  lines.push("Recent assistant replies:");
  if (latestAssistantReplies.length) {
    for (const item of latestAssistantReplies) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- none");
  }

  if (openQuestions.length) {
    lines.push("Open questions:");
    for (const item of openQuestions) {
      lines.push(`- ${item}`);
    }
  }

  const summaryText = truncateToTokenBudget(lines.join("\n"), env.sessionSummaryTokenBudget);
  if (!summaryText) {
    return null;
  }

  return {
    summaryJson,
    summaryText
  };
};

export const getSessionRollingSummaryText = async (params: {
  orgId: string;
  sessionId: string;
}): Promise<string | null> => {
  const row = await loadSessionMemoryRow({
    orgId: params.orgId,
    sessionId: params.sessionId
  });
  if (!row?.rollingSummaryText) {
    return null;
  }
  return row.rollingSummaryText;
};

export const refreshSessionMemorySnapshot = async (params: {
  orgId: string;
  sessionId: string;
}): Promise<void> => {
  const totalTextMessages = await countSessionTextMessages({
    orgId: params.orgId,
    sessionId: params.sessionId
  });
  if (typeof totalTextMessages !== "number" || !Number.isFinite(totalTextMessages) || totalTextMessages < 1) {
    return;
  }

  const existing = await loadSessionMemoryRow({
    orgId: params.orgId,
    sessionId: params.sessionId
  });
  const updateThreshold = Math.max(1, env.sessionSummaryUpdateEveryTurns);
  if (existing && totalTextMessages - existing.sourceMessageCount < updateThreshold) {
    return;
  }

  const working = await loadWorkingMemoryForSession({
    orgId: params.orgId,
    sessionId: params.sessionId,
    currentUserMessage: ""
  });
  const built = buildRollingSummary(working.messages);
  if (!built) {
    return;
  }

  const { error } = await supabaseAdmin.from("session_memory").upsert(
    {
      session_id: params.sessionId,
      org_id: params.orgId,
      rolling_summary_json: built.summaryJson,
      rolling_summary_text: built.summaryText,
      source_message_count: totalTextMessages,
      last_compacted_at: new Date().toISOString()
    },
    {
      onConflict: "session_id",
      ignoreDuplicates: false
    }
  );

  if (error) {
    if (isMissingTableError(error, "session_memory")) {
      return;
    }
    console.warn(`[CONVERSATION_MEMORY] Upsert failed: ${error.message}`);
  }
};
