import { HttpError } from "./errors";

type ParseRequiredStringOptions = {
  maxLength?: number;
  status?: number;
  code?: string;
  missingMessage?: string;
  tooLongMessage?: string;
};

export const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

export const parseOptionalString = (value: unknown): string | null => {
  const trimmed = asString(value, "").trim();
  return trimmed ? trimmed : null;
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const parseRequiredString = (
  value: unknown,
  field: string,
  options: ParseRequiredStringOptions = {}
): string => {
  const parsed = parseOptionalString(value);
  const status = options.status ?? 400;
  const code = options.code ?? "invalid_payload";

  if (!parsed) {
    throw new HttpError(status, code, options.missingMessage ?? `${field} is required.`);
  }

  const maxLength =
    typeof options.maxLength === "number" && Number.isFinite(options.maxLength)
      ? Math.max(1, Math.floor(options.maxLength))
      : null;
  if (maxLength !== null && parsed.length > maxLength) {
    throw new HttpError(status, code, options.tooLongMessage ?? `${field} is too long.`);
  }

  return parsed;
};
