// Module manifest — the single drop-in registration point (SPEC §0: core code is never
// edited to add a module). Adding a module = import it here and append to ALL_MODULES;
// the composition root (src/app.ts) and core/ stay untouched. Company config still
// decides which of these are exposed per tenant.
import type { ModuleContract } from "../shared/types/contracts.js";
import { recruitmentModule } from "./hr/recruitment/index.js";

export const ALL_MODULES: ModuleContract[] = [recruitmentModule];
