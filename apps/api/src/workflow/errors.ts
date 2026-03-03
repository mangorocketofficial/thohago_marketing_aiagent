export class WorkflowRepositoryError extends Error {
  readonly dbCode: string | null;
  readonly details: string | null;

  constructor(message: string, dbCode: string | null = null, details: string | null = null) {
    super(message);
    this.name = "WorkflowRepositoryError";
    this.dbCode = dbCode;
    this.details = details;
  }
}

export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof WorkflowRepositoryError && error.dbCode === "23505";
