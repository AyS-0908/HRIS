// Loads + validates a company YAML config, failing fast on schema errors (SPEC §6).
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { companyConfigSchema, type CompanyConfig } from "./schema.js";
import { validationError } from "../errors/appError.js";

export function loadCompanyConfig(path: string): CompanyConfig {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    throw validationError(`cannot read/parse company config at ${path}: ${String(e)}`);
  }
  const parsed = companyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationError(
      `invalid company config at ${path}`,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

// In-memory registry of loaded companies, keyed by company id.
export class CompanyRegistry {
  private readonly byId = new Map<string, CompanyConfig>();

  add(cfg: CompanyConfig): void {
    this.byId.set(cfg.company.id, cfg);
  }
  get(companyId: string): CompanyConfig | undefined {
    return this.byId.get(companyId);
  }
  has(companyId: string): boolean {
    return this.byId.has(companyId);
  }
  list(): CompanyConfig[] {
    return [...this.byId.values()];
  }
}
