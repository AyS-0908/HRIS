# Architecture.md — MCP Custom Standard

## Overview

A reusable MCP server. Core code is generic; business logic plugs in as **modules** (per domain, e.g. HR) and **processes** (per workflow) via config + drop-in folders. Onboarding a company or adding a module never edits core code. Full authoritative structure: `SPEC.md` §3. This file is the compact map.

## Components

- `server/`: MCP entry, transport (streamable HTTP).
- `core/`: auth + identity, config loading, logging, errors, permissions, validation.
- `runtime/processRuntime.ts`: the only place status logic, status gating, and audit emission live.
- `registry/`: discovers and registers modules, tools, processes.
- `modules/{domain}/{process}/`: business logic (tools, schemas, services, permissions). `_template` is the scaffold source.
- `connectors/`: provider-neutral surface to external systems (google/* , http, webhook).
- `storage/`: `StorageAdapter` interface + Sheets reference impl.
- `config/`: per-company YAML wiring, validated by zod.

## Important paths

- `runtime/processRuntime.ts`: enforces the fixed execution order (SPEC §5). Do not reimplement in handlers.
- `core/auth/`: resolves `RequestContext` once; only source of identity.
- `storage/storageAdapter.ts`: backend is pluggable; core depends on the interface only.
- `config/company.<id>.yaml`: enables modules + roles per company.

## Data flow

1. MCP client request → transport (streamable HTTP).
2. `core/auth` resolves `RequestContext` (companyId, actorId, actorRole, apiKeyId).
3. `processRuntime` runs the fixed order: auth → permission → validate input → status gate → idempotency → handler → status update → audit.
4. Handler calls a module **service**; the service calls a **connector**. Handlers never call connectors directly.
5. State + audit persisted through `StorageAdapter` (Sheets impl in V1).

## External dependencies

- Google connectors (drive, docs, sheets, gmail, forms, calendar): V1 = provider-neutral skeletons; only Sheets is a working path.
- Generic connectors: http, webhook.
- Deploy target: Docker / Coolify VPS.

## Constraints

- Strict top-down layering: `client → transport → core → runtime → module → service → connector`.
- zod is the single schema source; MCP `input_schema` is derived from it.
- Human validation = an explicit status transition; AI never auto-validates.
- See `AGENTS.md` "Locked architecture" for the full enforceable list.

## Known risks

- Google auth is out of V1 scope — non-Sheets connectors are not production-ready.
- Header-based identity is `[Assumed]` in the spec; extraction may change, resolved fields must not.
