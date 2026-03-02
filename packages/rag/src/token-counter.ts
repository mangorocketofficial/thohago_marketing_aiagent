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
