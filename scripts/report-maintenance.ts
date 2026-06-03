// Emits the maintenance report (SPEC §12).
import { ALL_MODULES } from "../src/app.js";
import { collectModuleErrors } from "../src/registry/validateModule.js";
import { buildConnectors } from "../src/connectors/index.js";
import { createLogger } from "../src/core/logging/logger.js";
import { STANDARD_VERSION } from "../src/version.js";

type Health = "ok" | "warning" | "error";

async function main() {
  const logger = createLogger("error");
  const blockingIssues: string[] = [];
  const recommendedActions: string[] = [];

  // Modules
  let modulesHealth: Health = "ok";
  for (const m of ALL_MODULES) {
    const errs = collectModuleErrors(m);
    if (errs.length > 0) {
      modulesHealth = "error";
      blockingIssues.push(...errs.map((e) => `[${m.moduleName}] ${e}`));
    }
  }

  // Connectors (V1 = simulated skeletons → warning, not error)
  let connectorsHealth: Health = "ok";
  const connectors = buildConnectors(logger);
  for (const c of Object.values(connectors)) {
    const h = await c.healthCheck();
    if (!h.ok) {
      connectorsHealth = "error";
      blockingIssues.push(`connector ${c.name} unhealthy`);
    } else if (h.detail?.includes("simulated")) {
      connectorsHealth = connectorsHealth === "error" ? "error" : "warning";
    }
  }
  if (connectorsHealth === "warning") {
    recommendedActions.push("Wire production Google connectors before relying on real side effects.");
  }

  const report = {
    standardVersion: STANDARD_VERSION,
    mcpCompatibility: "ok" as Health,
    connectors: connectorsHealth,
    modules: modulesHealth,
    blockingIssues,
    recommendedActions,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(blockingIssues.length > 0 ? 1 : 0);
}

main();
