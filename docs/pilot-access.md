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
| `x-api-key` | the company's API key (authentication) |
| `x-company-id` | the `companyId` from the company config |
| `x-actor-id` | this person's stable id |
| `x-actor-role` | this person's role — must be one of the company's configured `roles` |

Roles are validated against the company config; an unknown company, missing actor, or role
not in the config is rejected (`FORBIDDEN`). **These headers are the only source of identity
— they cannot be overridden from the Sheet's Config tab.**

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
  `approve_job_description`, `get_recruitment_policy`.
- A full `submit → generate → approve` yields an `approved` fiche whose row in `rec_jobDesc`
  holds the **live** doc URL, openable by both a manager and an HR member of the shared
  Drive folder.
