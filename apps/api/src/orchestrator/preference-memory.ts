import { env } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase-admin";

type PreferenceSignal = {
  key: string;
  value: string;
  confidence: number;
  source: string;
};

type PreferenceRow = {
  id: string;
  preference_key: string;
  preference_value: string;
  confidence: number;
  evidence_count: number;
  last_seen_at: string;
  user_id: string | null;
};

const isMissingPreferenceTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("conversation_preferences") &&
    (normalized.includes("could not find the table") || normalized.includes("does not exist"))
  );
};

const addSignal = (collection: PreferenceSignal[], key: string, value: string, confidence: number, source: string): void => {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return;
  }
  collection.push({
    key,
    value: normalizedValue,
    confidence: Math.max(0, Math.min(1, confidence)),
    source
  });
};

const extractPreferenceSignals = (message: string): PreferenceSignal[] => {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const signals: PreferenceSignal[] = [];

  if (/instagram|인스타/.test(normalized)) {
    addSignal(signals, "preferred_channel", "instagram", 0.82, "channel_keyword");
  }
  if (/threads|스레드/.test(normalized)) {
    addSignal(signals, "preferred_channel", "threads", 0.82, "channel_keyword");
  }
  if (/naver blog|네이버\s*블로그|블로그/.test(normalized)) {
    addSignal(signals, "preferred_channel", "naver_blog", 0.82, "channel_keyword");
  }
  if (/facebook|페이스북/.test(normalized)) {
    addSignal(signals, "preferred_channel", "facebook", 0.82, "channel_keyword");
  }
  if (/youtube|유튜브/.test(normalized)) {
    addSignal(signals, "preferred_channel", "youtube", 0.82, "channel_keyword");
  }

  if (/짧게|간결|짧은|brief|short/.test(normalized)) {
    addSignal(signals, "preferred_length", "short", 0.78, "length_keyword");
  }
  if (/길게|자세히|상세|long-form|long form|detailed/.test(normalized)) {
    addSignal(signals, "preferred_length", "long", 0.78, "length_keyword");
  }

  if (/친근|캐주얼|부드럽|casual|friendly/.test(normalized)) {
    addSignal(signals, "preferred_tone", "friendly", 0.76, "tone_keyword");
  }
  if (/공식|전문|격식|formal|professional/.test(normalized)) {
    addSignal(signals, "preferred_tone", "professional", 0.76, "tone_keyword");
  }
  if (/따뜻|감성|warm|empathetic/.test(normalized)) {
    addSignal(signals, "preferred_tone", "warm", 0.7, "tone_keyword");
  }

  if (/cta\s*강|행동\s*유도\s*강|직접\s*행동/.test(normalized)) {
    addSignal(signals, "preferred_cta_style", "strong", 0.72, "cta_keyword");
  }
  if (/cta\s*약|부드러운\s*cta|소프트\s*cta/.test(normalized)) {
    addSignal(signals, "preferred_cta_style", "soft", 0.72, "cta_keyword");
  }

  const avoidPattern = /["'“”]?([^"'“”\n]{2,40})["'“”]?\s*(?:은|는|을|를)?\s*(?:쓰지\s*마|금지|사용하지\s*마|빼줘|제외해)/g;
  for (const match of normalized.matchAll(avoidPattern)) {
    const phrase = (match[1] ?? "").trim();
    if (phrase && phrase.length >= 2) {
      addSignal(signals, "forbidden_phrase", phrase, 0.8, "forbidden_phrase_rule");
    }
  }

  const dontUseEnglish = /don't use\s+([a-z0-9_\- ]{2,40})/g;
  for (const match of normalized.matchAll(dontUseEnglish)) {
    const phrase = (match[1] ?? "").trim();
    if (phrase) {
      addSignal(signals, "forbidden_phrase", phrase, 0.8, "forbidden_phrase_rule_en");
    }
  }

  const deduped = new Map<string, PreferenceSignal>();
  for (const signal of signals) {
    const mapKey = `${signal.key}:${signal.value}`;
    const previous = deduped.get(mapKey);
    if (!previous || signal.confidence > previous.confidence) {
      deduped.set(mapKey, signal);
    }
  }

  return [...deduped.values()];
};

const loadExistingPreference = async (params: {
  orgId: string;
  userId: string | null;
  key: string;
  value: string;
}): Promise<PreferenceRow | null> => {
  const baseQuery = supabaseAdmin
    .from("conversation_preferences")
    .select("id,preference_key,preference_value,confidence,evidence_count,last_seen_at,user_id")
    .eq("org_id", params.orgId)
    .eq("preference_key", params.key)
    .eq("preference_value", params.value);

  const { data, error } = params.userId
    ? await baseQuery.eq("user_id", params.userId).maybeSingle()
    : await baseQuery.is("user_id", null).maybeSingle();

  if (error) {
    if (isMissingPreferenceTableError(error)) {
      return null;
    }
    console.warn(`[PREFERENCE_MEMORY] Load failed for org ${params.orgId}: ${error.message}`);
    return null;
  }

  if (!data) {
    return null;
  }

  const row = data as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : "",
    preference_key: typeof row.preference_key === "string" ? row.preference_key : "",
    preference_value: typeof row.preference_value === "string" ? row.preference_value : "",
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0.5,
    evidence_count:
      typeof row.evidence_count === "number" && Number.isFinite(row.evidence_count) ? Math.max(1, Math.floor(row.evidence_count)) : 1,
    last_seen_at: typeof row.last_seen_at === "string" ? row.last_seen_at : new Date().toISOString(),
    user_id: typeof row.user_id === "string" ? row.user_id : null
  };
};

export const upsertPreferencesFromUserMessage = async (params: {
  orgId: string;
  userId?: string | null;
  message: string;
}): Promise<void> => {
  const signals = extractPreferenceSignals(params.message);
  if (!signals.length) {
    return;
  }

  const userId = typeof params.userId === "string" && params.userId.trim() ? params.userId.trim() : null;
  const now = new Date().toISOString();

  for (const signal of signals) {
    const existing = await loadExistingPreference({
      orgId: params.orgId,
      userId,
      key: signal.key,
      value: signal.value
    });

    if (!existing) {
      const { error } = await supabaseAdmin.from("conversation_preferences").insert({
        org_id: params.orgId,
        user_id: userId,
        preference_key: signal.key,
        preference_value: signal.value,
        confidence: signal.confidence,
        evidence_count: 1,
        last_seen_at: now,
        metadata: {
          source: signal.source
        }
      });

      if (error && !isMissingPreferenceTableError(error)) {
        console.warn(`[PREFERENCE_MEMORY] Insert failed for org ${params.orgId}: ${error.message}`);
      }
      continue;
    }

    const nextEvidenceCount = existing.evidence_count + 1;
    const nextConfidence = Math.max(existing.confidence, signal.confidence);
    const { error } = await supabaseAdmin
      .from("conversation_preferences")
      .update({
        confidence: nextConfidence,
        evidence_count: nextEvidenceCount,
        last_seen_at: now,
        metadata: {
          source: signal.source,
          updated_from: "user_message"
        }
      })
      .eq("id", existing.id);

    if (error && !isMissingPreferenceTableError(error)) {
      console.warn(`[PREFERENCE_MEMORY] Update failed for org ${params.orgId}: ${error.message}`);
    }
  }
};

const loadPreferenceRows = async (params: {
  orgId: string;
  userId?: string | null;
  limit: number;
}): Promise<PreferenceRow[]> => {
  const normalizedUserId = typeof params.userId === "string" && params.userId.trim() ? params.userId.trim() : null;
  const rows: PreferenceRow[] = [];

  if (normalizedUserId) {
    const { data: userData, error: userError } = await supabaseAdmin
      .from("conversation_preferences")
      .select("id,preference_key,preference_value,confidence,evidence_count,last_seen_at,user_id")
      .eq("org_id", params.orgId)
      .eq("user_id", normalizedUserId)
      .order("confidence", { ascending: false })
      .order("evidence_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(params.limit);

    if (userError) {
      if (!isMissingPreferenceTableError(userError)) {
        console.warn(`[PREFERENCE_MEMORY] Query (user) failed for org ${params.orgId}: ${userError.message}`);
      }
      return [];
    }

    for (const item of (userData as Record<string, unknown>[] | null) ?? []) {
      rows.push({
        id: typeof item.id === "string" ? item.id : "",
        preference_key: typeof item.preference_key === "string" ? item.preference_key : "",
        preference_value: typeof item.preference_value === "string" ? item.preference_value : "",
        confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) ? item.confidence : 0.5,
        evidence_count:
          typeof item.evidence_count === "number" && Number.isFinite(item.evidence_count)
            ? Math.max(1, Math.floor(item.evidence_count))
            : 1,
        last_seen_at: typeof item.last_seen_at === "string" ? item.last_seen_at : "",
        user_id: typeof item.user_id === "string" ? item.user_id : null
      });
    }
  }

  const { data: orgData, error: orgError } = await supabaseAdmin
    .from("conversation_preferences")
    .select("id,preference_key,preference_value,confidence,evidence_count,last_seen_at,user_id")
    .eq("org_id", params.orgId)
    .is("user_id", null)
    .order("confidence", { ascending: false })
    .order("evidence_count", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(params.limit);

  if (orgError) {
    if (!isMissingPreferenceTableError(orgError)) {
      console.warn(`[PREFERENCE_MEMORY] Query (org) failed for org ${params.orgId}: ${orgError.message}`);
    }
    return rows;
  }

  for (const item of (orgData as Record<string, unknown>[] | null) ?? []) {
    rows.push({
      id: typeof item.id === "string" ? item.id : "",
      preference_key: typeof item.preference_key === "string" ? item.preference_key : "",
      preference_value: typeof item.preference_value === "string" ? item.preference_value : "",
      confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) ? item.confidence : 0.5,
      evidence_count:
        typeof item.evidence_count === "number" && Number.isFinite(item.evidence_count)
          ? Math.max(1, Math.floor(item.evidence_count))
          : 1,
      last_seen_at: typeof item.last_seen_at === "string" ? item.last_seen_at : "",
      user_id: typeof item.user_id === "string" ? item.user_id : null
    });
  }

  return rows;
};

const formatPreferenceLabel = (key: string): string => {
  switch (key) {
    case "preferred_channel":
      return "Preferred channel";
    case "preferred_length":
      return "Preferred length";
    case "preferred_tone":
      return "Preferred tone";
    case "preferred_cta_style":
      return "Preferred CTA style";
    case "forbidden_phrase":
      return "Avoid phrase";
    default:
      return key;
  }
};

export const buildPreferenceContextText = async (params: {
  orgId: string;
  userId?: string | null;
  maxItems?: number;
}): Promise<string | null> => {
  const maxItems =
    typeof params.maxItems === "number" && Number.isFinite(params.maxItems) && params.maxItems > 0
      ? Math.floor(params.maxItems)
      : env.preferenceMemoryMaxItems;

  const rows = await loadPreferenceRows({
    orgId: params.orgId,
    userId: params.userId ?? null,
    limit: maxItems
  });
  if (!rows.length) {
    return null;
  }

  const deduped = new Map<string, PreferenceRow>();
  for (const row of rows) {
    if (!row.preference_key || !row.preference_value) {
      continue;
    }
    const key = `${row.preference_key}:${row.preference_value}`;
    const existing = deduped.get(key);
    if (!existing || row.confidence > existing.confidence) {
      deduped.set(key, row);
    }
  }

  const selected = [...deduped.values()]
    .sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }
      if (left.evidence_count !== right.evidence_count) {
        return right.evidence_count - left.evidence_count;
      }
      return right.last_seen_at.localeCompare(left.last_seen_at);
    })
    .slice(0, maxItems);

  if (!selected.length) {
    return null;
  }

  const lines = selected.map((row) => `- ${formatPreferenceLabel(row.preference_key)}: ${row.preference_value}`);
  return lines.join("\n");
};

