// Builds a redacted input summary for audit (SPEC §4.3, §9) — no secrets.
const SECRET_KEY = /(password|secret|token|key|credential|authorization|apikey)/i;
const MAX_STR = 200;

export function redactForAudit(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { value: redactValue(input) };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactValue(v);
  }
  return out;
}

function redactValue(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) + "…" : v;
  if (v === null || ["number", "boolean"].includes(typeof v)) return v;
  if (Array.isArray(v)) return `[array(${v.length})]`;
  if (typeof v === "object") return "[object]";
  return String(v);
}
