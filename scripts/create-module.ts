// Scaffolds modules/{domain}/{module}/ from _template (SPEC §12).
// Usage: npm run create-module -- --domain hr --module recruitment
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, "..", "src", "modules", "_template", "process");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const domain = arg("domain");
const moduleName = arg("module");
if (!domain || !moduleName) {
  console.error("usage: create-module --domain <domain> --module <module>");
  process.exit(1);
}

const tokens: Record<string, string> = {
  __MODULE_NAME__: `${domain}.${moduleName}`,
  __DOMAIN__: domain,
  __MODULE__: moduleName,
};
const substitute = (s: string) =>
  Object.entries(tokens).reduce((acc, [k, v]) => acc.split(k).join(v), s);

const targetDir = join(__dirname, "..", "src", "modules", domain, moduleName);
if (existsSync(targetDir)) {
  console.error(`refusing to overwrite existing module: ${targetDir}`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });

for (const file of readdirSync(TEMPLATE_DIR)) {
  const content = substitute(readFileSync(join(TEMPLATE_DIR, file), "utf8"));
  const outName = substitute(file.replace(/\.tmpl$/, ""));
  writeFileSync(join(targetDir, outName), content);
}

console.log(`scaffolded module ${tokens.__MODULE_NAME__} at src/modules/${domain}/${moduleName}/`);
console.log("next: register it in the ALL_MODULES manifest (src/modules/index.ts) and enable it in a company config.");
