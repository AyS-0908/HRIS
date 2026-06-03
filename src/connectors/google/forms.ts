// Provider-neutral Forms connector. V1 = simulated skeleton (SPEC §8). Production
// Google auth is OUT of V1 scope; this returns a traceable simulated id.
import { createHash } from "node:crypto";
import type { FormsConnector, HealthResult, Logger } from "../../shared/types/contracts.js";

export function createFormsConnector(logger: Logger): FormsConnector {
  return {
    name: "google.forms",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async createForm(input, idempotencyKey) {
      const formId = "form_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
      logger.info("connector.forms.createForm (simulated)", { formId, title: input.title });
      return { formId, url: `https://forms.example/simulated/${formId}` };
    },
  };
}
