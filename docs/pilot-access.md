# Pilot access — connecting a DRH (HTTPS + Claude Desktop)

This is the V1 connection path: **Claude Desktop + `mcp-remote`**, sending the identity
headers per person. A native `claude.ai` custom connector (OAuth/bearer) is Phase 3.

## 1. HTTPS on the server (prerequisite)

`claude.ai` and a clean pilot require **HTTPS**. On Coolify:

1. Set a **domain** on the MCP app (e.g. `hris-mcp.yourdomain.com`).
2. Enable Coolify's automatic TLS (Let's Encrypt) for that domain — HTTPS is terminated at
   the proxy; the app keeps serving plain HTTP behind it.
3. Verify: `https://hris-mcp.yourdomain.com/healthz` returns `{ "ok": true }`.

The MCP endpoint is `POST https://<domain>/mcp`.

## 2. Identity headers (one set per person)

Every request carries authentication + identity headers (resolved server-side; never
inferred downstream):

| Header | Meaning |
| --- | --- |
| `x-api-key` | the API key (authentication). **V1: a single shared server key** — not yet per-company; the tenant comes from `x-company-id`. Per-company keys are planned. |
| `x-company-id` | the `companyId` from the company config |
| `x-actor-id` | this person's stable id (their email — the `Users` tab key) |
| `x-actor-role` | this person's role — **advisory** (fallback only; see below) |

**Identity from the Sheet (D2):** the effective role is resolved server-side from the
RH-editable `Users` tab (`email | role`) of the company sheet, keyed by `x-actor-id`. RH can
re-assign a person's role by editing that tab — no redeploy. The `x-actor-role` header is only
a fallback used when the `Users` tab is absent/empty or the person is unlisted. Either way the
effective role must be one of the company config's `roles` (the closed set of *valid* roles);
otherwise the request is rejected (`FORBIDDEN`). The `Config` (policy) and `Users` (identity)
tabs are separate; policy keys can never grant a role.

## 3. Claude Desktop config (per DRH)

Add an entry to the user's `claude_desktop_config.json` (Settings → Developer → Edit
Config), one block per person with their own `x-actor-id` / `x-actor-role`:

```json
{
  "mcpServers": {
    "hris-recruitment": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://hris-mcp.yourdomain.com/mcp",
        "--header", "x-api-key:${HRIS_API_KEY}",
        "--header", "x-company-id:acme",
        "--header", "x-actor-id:marie.dupont",
        "--header", "x-actor-role:manager"
      ],
      "env": { "HRIS_API_KEY": "<the company API key>" }
    }
  }
}
```

Restart Claude Desktop. The HRIS tools appear; the DRH can say *"j'ai besoin de
recruter…"* and the [hr-recruitment Skill](../skills/hr-recruitment/SKILL.md) drives the flow
(`get_recruitment_policy → submit → generate → approve`), producing a real, shared Google Doc.

## 4. Smoke check

- `list_available_business_tools` lists `submit_job_request`, `generate_job_description`,
  `approve_job_description`, `get_recruitment_policy` (4 tools).
- A full `submit → generate → approve` yields an `approved` fiche whose row in `rec_jobDesc`
  holds the **live** doc URL, openable by both a manager and an HR member of the shared
  Drive folder. At approve, HR is **notified by email** (D1) — recipients are the `Users` rows
  with role `hr_admin` (fallback: Config key `hrNotifyEmail`). Publishing/diffusion is a
  separate future module.
