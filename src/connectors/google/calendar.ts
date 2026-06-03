// Provider-neutral Calendar connector. V1 = simulated skeleton (SPEC §8). Production
// Google auth is OUT of V1 scope; this returns a traceable simulated id.
import { createHash } from "node:crypto";
import type { CalendarConnector, HealthResult, Logger } from "../../shared/types/contracts.js";

export function createCalendarConnector(logger: Logger): CalendarConnector {
  return {
    name: "google.calendar",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async createEvent(input, idempotencyKey) {
      const eventId = "evt_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
      logger.info("connector.calendar.createEvent (simulated)", { eventId, title: input.title });
      return { eventId, url: `https://calendar.example/simulated/${eventId}` };
    },
  };
}
