// Composition root: wires config, modules, registries, connectors, storage, runtime.
// Onboarding a company (COMPANY_CONFIG_PATH, comma-separated for several) and adding a
// module (src/modules/index.ts manifest) happen outside this file — core stays untouched
// (SPEC §0). What lives here is generic wiring only.
import type { Connectors, Logger, StorageAdapter } from "./shared/types/contracts.js";
import { createLogger } from "./core/logging/logger.js";
import { CompanyRegistry, loadCompanyConfig } from "./core/config/loadCompany.js";
import { resolveEnabledModules } from "./core/config/loadModules.js";
import { ModuleRegistry } from "./registry/moduleRegistry.js";
import { ToolRegistry, type ResolvedTool } from "./registry/toolRegistry.js";
import { ProcessRegistry } from "./registry/processRegistry.js";
import { buildConnectors } from "./connectors/index.js";
import { buildStorage } from "./storage/index.js";
import { InMemoryIdempotencyStore } from "./runtime/idempotencyStore.js";
import { ProcessRuntime } from "./runtime/processRuntime.js";
import { validateModule } from "./registry/validateModule.js";
import { ALL_MODULES } from "./modules/index.js";
import { resolveServiceAccountJsonFromEnv } from "./connectors/google/auth.js";

export interface AppConfig {
  // No server-wide API key: authentication is per-company (auth.apiKeyHash in each company
  // config). A key both authenticates and binds the tenant (SPEC §2) — see core/auth/apiKey.ts.
  companyConfigPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  googleConnectors: "simulated" | "live";
  storageBackend: "memory" | "sheets";
  serviceAccountJson?: string;
  // Optional OAuth user-delegation for the Docs/Drive connector (all three required to
  // activate). Lets real Doc creation work on a personal Gmail account; absent ⇒ Docs uses
  // the service account (Shared Drive path).
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRefreshToken?: string;
}

export interface App {
  config: AppConfig;
  logger: Logger;
  companies: CompanyRegistry;
  modules: ModuleRegistry;
  tools: ToolRegistry;
  processes: ProcessRegistry;
  connectors: Connectors;
  storage: StorageAdapter; // interface, not the concrete impl — lets the backend be swapped
  runtime: ProcessRuntime;
  // Business tools enabled for a given company (filtered by enabledModules).
  enabledToolsFor(companyId: string): ResolvedTool[];
}

// Re-exported from the modules manifest (src/modules/index.ts) — that is the drop-in
// registration point. Kept here for back-compat with scripts importing from app.js.
export { ALL_MODULES } from "./modules/index.js";

export function buildApp(config: AppConfig): App {
  const logger = createLogger(config.logLevel);

  const modules = new ModuleRegistry();
  for (const m of ALL_MODULES) {
    validateModule(m); // fail fast on a malformed module contract
    modules.register(m);
  }

  // COMPANY_CONFIG_PATH may list several paths (comma-separated) to onboard multiple
  // tenants without a core edit; the registry is multi-company by design.
  const companies = new CompanyRegistry();
  const paths = config.companyConfigPath.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of paths) companies.add(loadCompanyConfig(p));
  // Validate every company's enabled modules + roles up front (fail fast, SPEC §6).
  for (const c of companies.list()) resolveEnabledModules(c, modules);

  const tools = new ToolRegistry(modules);
  const processes = new ProcessRegistry(modules);

  // Docs live config is resolved PER COMPANY at call time (the runtime threads the calling
  // company's resources into the service — P2.3). The connector is selected purely by live
  // mode; no first-company bias here.
  const connectors = buildConnectors(logger, {
    googleMode: config.googleConnectors,
    serviceAccountJson: config.serviceAccountJson,
    oauthClientId: config.oauthClientId,
    oauthClientSecret: config.oauthClientSecret,
    oauthRefreshToken: config.oauthRefreshToken,
  });
  // Sheets storage is routed PER COMPANY: each tenant's process state + audit persist to ITS
  // OWN recruitment spreadsheet (proc_state / proc_audit tabs). The in-memory backend is a
  // single companyId-keyed store. Swappable without core edits (StorageAdapter interface).
  const storage = buildStorage(logger, {
    backend: config.storageBackend,
    serviceAccountJson: config.serviceAccountJson,
    companies: companies.list().map((c) => ({
      companyId: c.company.id,
      sheetId: c.resources.googleSheets?.hrRecruitmentSheetId,
    })),
  });
  const idempotency = new InMemoryIdempotencyStore();
  const runtime = new ProcessRuntime({
    storage,
    connectors,
    logger,
    idempotency,
    companies,
    googleMode: config.googleConnectors,
  });

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
    companyConfigPath: process.env.COMPANY_CONFIG_PATH ?? "config/company.example.yaml",
    logLevel: (process.env.LOG_LEVEL as AppConfig["logLevel"]) ?? "info",
    googleConnectors: process.env.GOOGLE_CONNECTORS === "live" ? "live" : "simulated",
    storageBackend: process.env.STORAGE_BACKEND === "sheets" ? "sheets" : "memory",
    serviceAccountJson: resolveServiceAccountJsonFromEnv(),
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined,
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || undefined,
    oauthRefreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() || undefined,
  };
}
