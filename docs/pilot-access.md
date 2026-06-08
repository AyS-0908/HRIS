# Pilot access — connecting a DRH (Claude Desktop AND claude.ai web)

Two connection paths, both over HTTPS, both per-company authenticated:

| Path | Who/where | Identity model |
| --- | --- | --- |
| **Claude Desktop + `mcp-remote`** (§3) | a workstation with the desktop app | the **company key** (`x-api-key`/bearer) + per-person `x-actor-*` **headers** |
| **claude.ai web custom connector** (§5) | any browser, no install | a **per-actor token** (bearer) that *binds the person* — claude.ai web can't send custom headers, so the token carries the identity |

Both resolve identity server-side at `core/auth` (never inferred in a handler). Pick either or
both per person.

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
| `x-api-key` | the company's API key — **authenticates AND selects the tenant**. Each company has its own key (`auth.apiKeyHash` in its config); a key can act **only** as its own company. |
| `x-company-id` | optional, advisory. If sent it must **match** the key's company, else `FORBIDDEN` (anti-spoof). The tenant is always derived from the key, never from this header. |
| `x-actor-id` | this person's stable id (their email — the `Users` tab key) |
| `x-actor-role` | this person's role — **advisory** (fallback only; see below) |

> **Per-company keys (resolved).** The old single shared `API_KEY` is gone. A stolen/guessed
> header can no longer impersonate another tenant: without that company's key, no request
> authenticates, and a mismatched `x-company-id` is rejected.

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
  with role `hr_admin` or `admin_user` (fallback: Config key `hrNotifyEmail`). Publishing/diffusion is a
  separate future module.

## 5. claude.ai web custom connector (no install)

claude.ai web ("Settings → Connectors → Add custom connector") connects to a remote MCP server
by **URL** and authenticates with a **bearer token** — it does **not** let you set arbitrary
per-person headers the way Claude Desktop does. So the token itself must carry the person's
identity. That is exactly what a **per-actor key** does: it resolves to `{ companyId, actorId,
role }` at `core/auth`, so no `x-actor-*` header is needed.

### 5.1 Mint a per-actor token (operator, once per person)

Two stores. Pick **A** for a permanent company member, **B** for a beta tester you want to add or
revoke without touching Coolify or restarting the server.

**A. Config file (`auth.actorKeys`).** Persistent; needs a server restart to load:

```bash
npm run add-actor-key -- --company config/company.acme.yaml \
  --actor marie.dupont@acme.com --role manager
# prints the token ONCE; only its sha256 hash is stored in the config (auth.actorKeys).
```

`--role` is optional — omit it to let the role come from the `Users` tab (D2). Re-running for the
same `--actor` **re-issues** (replaces) that person's token. Restart the server to load it.

**B. `Users` tab (`--store users-sheet`) — beta testers, no Coolify, no restart.** First keep the
tester's row in the `Users` tab (`email | role`), then:

```bash
# add / re-issue
npm run add-actor-key -- --company config/company.acme.yaml \
  --actor friend@example.com --store users-sheet
# revoke (or set Users.mcpKeyStatus = revoked by hand)
npm run add-actor-key -- --company config/company.acme.yaml \
  --actor friend@example.com --store users-sheet --revoke
```

This writes `mcpKeyHash` (sha256 of the token), `mcpKeyStatus` (`active`/`revoked`) and
`mcpKeyCreatedAt` to that person's `Users` row — **never** the raw token, which is printed once.
The server reads the `Users` tab live (cached 60 s), so an add/revoke takes effect within ~1
minute with **no Coolify edit and no restart**. (Requires `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` /
`GOOGLE_SERVICE_ACCOUNT_JSON` so the helper can reach the sheet; the service account needs edit
access to it.) The tester just pastes the token (5.2) — they never run Terminal or open Coolify.

### 5.2 Add the connector (the DRH, in the browser)

1. claude.ai → **Settings → Connectors → Add custom connector**.
2. **URL:** `https://hris-mcp.<domain>/mcp`
3. **Authentication:** bearer token → paste the token from 5.1.
4. Save. The HRIS tools appear; the DRH runs the same flow as Desktop, with no headers to set.

> **Why this stays within the architecture:** the token is checked by
> `resolveApiKeyIdentity` (core/auth) which returns the bound `actorId`/`role`; the server then
> builds the same `RequestContext` it would from headers. Identity is never bolted onto a
> handler — a per-actor key and a header-carried identity converge at the same `core/auth` point.

### 5.3 HTTPS / TLS prerequisite (current blocker)

claude.ai web **requires HTTPS**. Today `http://hris-mcp.sourcinno.com` serves plain HTTP (no
TLS certificate), so the native web connector **cannot be live-verified yet**. Enable TLS on
Coolify first:

1. Coolify → the **HRIS** app → **Domains**: set `https://hris-mcp.sourcinno.com` (note the
   `https://`).
2. Ensure the DNS A record for `hris-mcp.sourcinno.com` points at the Coolify host, and ports
   **80 + 443** are open (Let's Encrypt needs 80 for the ACME challenge; 443 serves TLS).
3. Coolify auto-provisions a Let's Encrypt certificate. Redeploy if needed.
4. Verify: `https://hris-mcp.sourcinno.com/healthz` → `{ "ok": true }` over TLS.

### 5.4 Verification checklist

The auth model itself is **already verified locally** (curl, both paths):

```bash
# company-wide key + actor headers (Desktop path)
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <company-key>" \
  -H "x-actor-id: drh@acme.com" -H "x-actor-role: hr_admin" \
  -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_available_business_tools","arguments":{}}}'

# per-actor token, NO headers (claude.ai web path) — identity comes from the token
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <per-actor-token>" \
  -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"submit_job_request","arguments":{"title":"QA","justification":"growth","plannedHire":true}}}'

# anti-spoof: wrong x-company-id → FORBIDDEN ; wrong key → UNAUTHENTICATED
```

**Blocked until TLS (5.3):** adding the connector in claude.ai web and running the flow from a
browser. Once `https://…/healthz` is green, complete 5.2 and confirm the tools list + a
`submit → generate → approve`.
