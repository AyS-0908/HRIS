// Provider-neutral Gmail connector. V1 = simulated skeleton (SPEC §8). Production
// Google auth is OUT of V1 scope; this returns a traceable simulated id.
import { createHash } from "node:crypto";
import type { GmailConnector, HealthResult, Logger } from "../../shared/types/contracts.js";

export function createGmailConnector(logger: Logger): GmailConnector {
  return {
    name: "google.gmail",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async sendEmail(input, idempotencyKey) {
      const messageId = "msg_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
      logger.info("connector.gmail.sendEmail (simulated)", { messageId, to: input.to });
      return { messageId };
    },
  };
}
