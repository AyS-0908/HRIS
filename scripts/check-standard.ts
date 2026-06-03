// Validates the standard offline: every module contract + unique tool names (SPEC §12).
import { ALL_MODULES } from "../src/app.js";
import { collectModuleErrors } from "../src/registry/validateModule.js";

const issues: string[] = [];
const seenTools = new Set<string>();

for (const m of ALL_MODULES) {
  for (const e of collectModuleErrors(m)) issues.push(`[${m.moduleName}] ${e}`);
  for (const t of m.tools) {
    if (seenTools.has(t.name)) issues.push(`duplicate tool name across modules: ${t.name}`);
    seenTools.add(t.name);
  }
}

if (issues.length > 0) {
  console.error("standard check FAILED:");
  for (const i of issues) console.error(" - " + i);
  process.exit(1);
}
console.log(`standard check OK — ${ALL_MODULES.length} module(s), ${seenTools.size} tool(s).`);
