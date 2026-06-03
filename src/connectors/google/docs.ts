// Provider-neutral Docs connector. V1 = simulated skeleton (SPEC §8). Production
// Google auth is OUT of V1 scope; this returns a traceable simulated id.
import { createHash } from "node:crypto";
import type { DocsConnector, HealthResult, Logger } from "../../shared/types/contracts.js";

export function createDocsConnector(logger: Logger): DocsConnector {
  return {
    name: "google.docs",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async createDocument(input, idempotencyKey) {
      const docId = "doc_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
      logger.info("connector.docs.createDocument (simulated)", { docId, title: input.title });
      return { docId, url: `https://docs.example/simulated/${docId}` };
    },
  };
}
