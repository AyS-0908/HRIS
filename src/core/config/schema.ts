// Per-company config schema (SPEC §6). zod is the source of truth; loader fails fast.
import { z } from "zod";

export const companyConfigSchema = z.object({
  company: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabledModules: z.array(z.string().min(1)),
    roles: z.array(z.string().min(1)).min(1),
  }),
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
