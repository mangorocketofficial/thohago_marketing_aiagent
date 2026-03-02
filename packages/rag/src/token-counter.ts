import { get_encoding } from "tiktoken";

const FALLBACK_DIVISOR = 2;

let cachedEncoder: ReturnType<typeof get_encoding> | null = null;

const getEncoder = () => {
  if (!cachedEncoder) {
    cachedEncoder = get_encoding("cl100k_base");
  }
  return cachedEncoder;
};

export const countTokens = (value: string): number => {
  if (!value.trim()) {
    return 0;
  }

  try {
    return getEncoder().encode(value).length;
  } catch {
    return Math.ceil(value.length / FALLBACK_DIVISOR);
  }
};

export const truncateToTokenBudget = (value: string, tokenBudget: number): string => {
  const budget = Math.max(0, Math.floor(tokenBudget));
  if (budget <= 0) {
    return "";
  }

  const input = value.trim();
  if (!input) {
    return "";
  }

  if (countTokens(input) <= budget) {
    return input;
  }

  const suffix = "...";
  const suffixTokens = countTokens(suffix);
  const useSuffix = suffixTokens < budget;

  let left = 0;
  let right = input.length;
  let best = "";

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const head = input.slice(0, middle).trimEnd();
    const candidate = useSuffix && head ? `${head}${suffix}` : head;
    const tokenCount = countTokens(candidate);

    if (tokenCount <= budget) {
      best = candidate;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  if (best) {
    return best;
  }

  return useSuffix ? suffix : "";
};
