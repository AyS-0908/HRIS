// Provider-neutral HTTP connector. V1 = simulated skeleton (SPEC §8).
import { createHash } from "node:crypto";
import type { HealthResult, HttpConnector, Logger } from "../../shared/types/contracts.js";

export function createHttpConnector(logger: Logger): HttpConnector {
  return {
    name: "generic.http",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async request(input, idempotencyKey) {
      const requestId =
        "req_" + createHash("sha256").update(`${input.method}:${input.url}:${idempotencyKey}`).digest("hex").slice(0, 16);
      logger.info("connector.http.request (simulated)", {
        requestId,
        method: input.method,
        url: input.url,
      });
      return { requestId, status: 200 };
    },
  };
}
