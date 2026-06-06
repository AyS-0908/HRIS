// Per-company config schema (SPEC §6). zod is the source of truth; loader fails fast.
import { z } from "zod";

export const companyConfigSchema = z.object({
  company: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabledModules: z.array(z.string().min(1)),
    roles: z.array(z.string().min(1)).min(1),
  }),
  // Per-company API key (SPEC §2). The raw key is never stored — only its sha256 hex digest.
  // A key authenticates AND selects the tenant (a key can act only as its own company), so the
  // spoofable x-company-id header can no longer choose the tenant. Optional so an example/dev
  // config still loads; a company with no apiKeyHash simply has no key that authenticates to it.
  auth: z
    .object({
      // Company-wide key — the Claude Desktop path. The caller sends their own identity via the
      // x-actor-id / x-actor-role headers (resolved against the Users tab, D2).
      apiKeyHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/, "apiKeyHash must be a sha256 hex digest (64 lowercase hex chars)")
        .optional(),
      // Per-actor keys — the claude.ai WEB path. claude.ai web cannot send custom per-person
      // headers, so the token itself must carry the identity: each entry binds a key (by hash)
      // to one actor. `role` is optional — when omitted the role is resolved from the Users tab
      // (D2) like the header path. This keeps identity at core/auth, never on a handler.
      actorKeys: z
        .array(
          z.object({
            keyHash: z
              .string()
              .regex(/^[0-9a-f]{64}$/, "keyHash must be a sha256 hex digest (64 lowercase hex chars)"),
            actorId: z.string().min(1),
            role: z.string().min(1).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  resources: z
    .object({
      googleDrive: z.record(z.string()).optional(),
      googleSheets: z.record(z.string()).optional(),
      googleDocs: z.record(z.string()).optional(),
    })
    .partial()
    .default({}),
});

export type CompanyConfig = z.infer<typeof companyConfigSchema>;
