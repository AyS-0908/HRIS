// Provider-neutral Drive connector. V1 = simulated skeleton (SPEC §8).
import type { DriveConnector, HealthResult, Logger } from "../../shared/types/contracts.js";

export function createDriveConnector(logger: Logger): DriveConnector {
  return {
    name: "google.drive",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async getFileText(input) {
      logger.info("connector.drive.getFileText (simulated)", { ref: input.fileIdOrUrl });
      return { text: `[simulated content for ${input.fileIdOrUrl}]` };
    },
  };
}
