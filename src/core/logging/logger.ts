// Structured JSON logging — one event per line (SPEC §1, §9).
import type { Logger, LogLevel } from "../../shared/types/contracts.js";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(minLevel: LogLevel = "info"): Logger {
  const threshold = ORDER[minLevel];

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (ORDER[level] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields,
    });
    // stderr keeps logs off the MCP stdout/JSON-RPC channel.
    process.stderr.write(line + "\n");
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
