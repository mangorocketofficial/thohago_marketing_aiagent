export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TABLE_MISSING_IN_SCHEMA_CACHE_RE =
  /Could not find the table '([^']+)' in the schema cache/i;

const toSchemaNotReadyError = (message: string): HttpError | null => {
  const match = message.match(TABLE_MISSING_IN_SCHEMA_CACHE_RE);
  if (!match) {
    return null;
  }

  const table = match[1] ?? "unknown_table";
  return new HttpError(
    503,
    "schema_not_ready",
    `Required table ${table} is not available in Supabase schema cache. Apply Supabase migrations in order through 20260303143000_phase_3_2_chat_action_card_projection.sql on the connected project and retry.`
  );
};

export const toHttpError = (error: unknown): HttpError => {
  if (error instanceof HttpError) {
    const mapped = toSchemaNotReadyError(error.message);
    if (mapped) {
      return mapped;
    }
    return error;
  }

  if (error instanceof Error) {
    const mapped = toSchemaNotReadyError(error.message);
    if (mapped) {
      return mapped;
    }
    return new HttpError(500, "internal_error", error.message);
  }

  return new HttpError(500, "internal_error", "Unknown error");
};
