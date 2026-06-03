// Composition root: wires config, modules, registries, connectors, storage, runtime.
// Nothing here is edited to onboard a company or add a module (SPEC §0).
import type { Connectors, Logger, ModuleContract } from "./shared/types/contracts.js";
import { createLogger } from "./core/logging/logger.js";
import { CompanyRegistry, loadCompanyConfig } from "./core/config/loadCompany.js";
import { resolveEnabledModules } from "./core/config/loadModules.js";
import { ModuleRegistry } from "./registry/moduleRegistry.js";
import { ToolRegistry, type ResolvedTool } from "./registry/toolRegistry.js";
import { ProcessRegistry } from "./registry/processRegistry.js";
import { buildConnectors } from "./connectors/index.js";
import { InMemoryStorageAdapter } from "./storage/inMemoryAdapter.js";
import { InMemoryIdempotencyStore } from "./runtime/idempotencyStore.js";
import { ProcessRuntime } from "./runtime/processRuntime.js";
import { validateModule } from "./registry/validateModule.js";
import { recruitmentModule } from "./modules/hr/recruitment/index.js";

export interface AppConfig {
  apiKey: string;
  companyConfigPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  googleConnectors: "simulated" | "live";
  serviceAccountJson?: string;
}

export interface App {
  config: AppConfig;
  logger: Logger;
  companies: CompanyRegistry;
  modules: ModuleRegistry;
  tools: ToolRegistry;
  processes: ProcessRegistry;
  connectors: Connectors;
  storage: InMemoryStorageAdapter;
  runtime: ProcessRuntime;
  // Business tools enabled for a given company (filtered by enabledModules).
  enabledToolsFor(companyId: string): ResolvedTool[];
}

// All modules shipped with the standard. Adding a module = adding it here (or via
// the registry); company config decides which are exposed.
export const ALL_MODULES: ModuleContract[] = [recruitmentModule];

export function buildApp(config: AppConfig): App {
  const logger = createLogger(config.logLevel);

  const modules = new ModuleRegistry();
  for (const m of ALL_MODULES) {
    validateModule(m); // fail fast on a malformed module contract
    modules.register(m);
  }

  const companies = new CompanyRegistry();
  const company = loadCompanyConfig(config.companyConfigPath);
  companies.add(company);
  // Validate every company's enabled modules + roles up front (fail fast, SPEC §6).
  for (const c of companies.list()) resolveEnabledModules(c, modules);

  const tools = new ToolRegistry(modules);
  const processes = new ProcessRegistry(modules);

  const connectors = buildConnectors(logger, {
    googleMode: config.googleConnectors,
    serviceAccountJson: config.serviceAccountJson,
  });
  const storage = new InMemoryStorageAdapter();
  const idempotency = new InMemoryIdempotencyStore();
  const runtime = new ProcessRuntime({ storage, connectors, logger, idempotency, companies });

  const enabledModuleNames = (companyId: string): Set<string> => {
    const c = companies.get(companyId);
    return new Set(c ? c.company.enabledModules : []);
  };

  return {
    config,
    logger,
    companies,
    modules,
    tools,
    processes,
    connectors,
    storage,
    runtime,
    enabledToolsFor(companyId: string): ResolvedTool[] {
      const enabled = enabledModuleNames(companyId);
      return tools.all().filter((rt) => enabled.has(rt.module.moduleName));
    },
  };
}

export function loadAppConfigFromEnv(): AppConfig {
  return {
    apiKey: process.env.API_KEY ?? "",
    companyConfigPath: process.env.COMPANY_CONFIG_PATH ?? "config/company.example.yaml",
    logLevel: (process.env.LOG_LEVEL as AppConfig["logLevel"]) ?? "info",
    googleConnectors: process.env.GOOGLE_CONNECTORS === "live" ? "live" : "simulated",
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  };
}
