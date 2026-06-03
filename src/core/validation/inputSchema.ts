// MCP `input_schema` is DERIVED from zod (SPEC §1) — never hand-authored.
import type { ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function toInputSchema(schema: ZodSchema): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" });
  // MCP expects an object schema at the tool boundary.
  return json as Record<string, unknown>;
}
