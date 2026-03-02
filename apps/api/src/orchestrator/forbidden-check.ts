import { env } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase-admin";

export type ForbiddenCheckResult = {
  passed: boolean;
  violations: string[];
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

export const checkForbiddenWords = async (orgId: string, content: string): Promise<ForbiddenCheckResult> => {
  if (!env.ragForbiddenCheckEnabled) {
    return { passed: true, violations: [] };
  }

  const { data, error } = await supabaseAdmin
    .from("org_brand_settings")
    .select("forbidden_words, forbidden_topics")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error || !data) {
    return { passed: true, violations: [] };
  }

  const forbiddenWords = toStringArray(data.forbidden_words);
  const forbiddenTopics = toStringArray(data.forbidden_topics);
  const allForbidden = [...new Set([...forbiddenWords, ...forbiddenTopics])];
  if (!allForbidden.length) {
    return { passed: true, violations: [] };
  }

  const contentLower = content.toLowerCase();
  const violations = allForbidden.filter((term) => contentLower.includes(term.toLowerCase()));

  return {
    passed: violations.length === 0,
    violations
  };
};
