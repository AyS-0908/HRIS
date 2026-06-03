// Closed error model (SPEC §10). Clients receive safe codes only — never internal
// messages or stack traces.
import type { ErrorCode } from "../../shared/types/contracts.js";

const SAFE_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Authentication required or invalid.",
  FORBIDDEN: "Not allowed for this actor or company.",
  VALIDATION_ERROR: "Input failed validation.",
  INVALID_STATE: "Action not allowed in the current process state.",
  CONNECTOR_ERROR: "An external system call failed.",
  INTERNAL: "Internal error.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, internalMessage: string, details?: unknown) {
    super(internalMessage);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export const unauthenticated = (m = "unauthenticated") => new AppError("UNAUTHENTICATED", m);
export const forbidden = (m = "forbidden") => new AppError("FORBIDDEN", m);
export const validationError = (m = "validation error", d?: unknown) =>
  new AppError("VALIDATION_ERROR", m, d);
export const invalidState = (m = "invalid state") => new AppError("INVALID_STATE", m);
export const connectorError = (m = "connector error") => new AppError("CONNECTOR_ERROR", m);
export const internalError = (m = "internal error") => new AppError("INTERNAL", m);

// Normalizes any thrown value into a client-safe { code, message } pair.
export function toClientError(err: unknown): { code: ErrorCode; message: string } {
  const code: ErrorCode = err instanceof AppError ? err.code : "INTERNAL";
  return { code, message: SAFE_MESSAGE[code] };
}
