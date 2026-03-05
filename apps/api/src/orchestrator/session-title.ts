const SESSION_TITLE_MAX_LENGTH = 42;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const truncateWithEllipsis = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const firstSentenceCandidate = (value: string): string => {
  const split = value
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
  return split[0] ?? "";
};

/**
 * Builds a deterministic session title from the first user message.
 * The title is designed to be set once and never mutated afterward.
 */
export const buildSessionTitleFromFirstUserMessage = (userMessage: string): string => {
  const normalized = normalizeWhitespace(userMessage);
  if (!normalized) {
    return "New session";
  }

  const firstSentence = firstSentenceCandidate(normalized);
  const candidate = firstSentence.length >= 3 ? firstSentence : normalized;
  return truncateWithEllipsis(candidate, SESSION_TITLE_MAX_LENGTH) || "New session";
};
