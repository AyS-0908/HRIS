// Provider-neutral webhook connector. V1 = simulated skeleton (SPEC §8).
import { createHash } from "node:crypto";
import type { HealthResult, Logger, WebhookConnector } from "../../shared/types/contracts.js";

export function createWebhookConnector(logger: Logger): WebhookConnector {
  return {
    name: "generic.webhook",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async send(input, idempotencyKey) {
      const deliveryId =
        "wh_" + createHash("sha256").update(`${input.url}:${idempotencyKey}`).digest("hex").slice(0, 16);
      logger.info("connector.webhook.send (simulated)", { deliveryId, url: input.url });
      return { deliveryId };
    },
  };
}
