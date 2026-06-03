// API key authentication (SPEC §2, §9). Secrets come only from env; never logged.
import { createHash } from "node:crypto";
import { unauthenticated } from "../errors/appError.js";

// Resolves the calling client's API key into a stable, non-secret id.
export function resolveApiKeyId(provided: string | undefined, expected: string): string {
  if (!expected) {
    throw unauthenticated("server API_KEY not configured");
  }
  if (!provided || provided !== expected) {
    throw unauthenticated("invalid API key");
  }
  // Short, non-reversible id for audit/correlation — never the key itself.
  return "key_" + createHash("sha256").update(provided).digest("hex").slice(0, 12);
}
