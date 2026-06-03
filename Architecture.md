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

Enforceable constraints live in `AGENTS.md` "Locked architecture"; this file is only the compact system map.

---
