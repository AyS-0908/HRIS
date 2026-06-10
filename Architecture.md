# Architecture.md — MCP Custom Standard

## Overview

A reusable MCP server. Core code is generic; business logic plugs in as **modules** (per domain, e.g. HR) and **processes** (per workflow) via config + drop-in folders. Onboarding a company or adding a module never edits core code. Full authoritative structure: `SPEC.md` §3. This file is the compact map.

The MCP server is the **business brain** of a larger HRIS product (vision: `docs/hris_macro_spec.md`); the current HR recruitment module is module 1 of N. A companion **Apps Script layer** (bound to the company spreadsheet, spec: `docs/hris_appscript_spec_final.txt`) owns workspace setup and the *downstream* HR workflow after the MCP handoff (`rec_jobDesc.status = "approved"`). Apps Script never calls MCP tools, never writes the MCP technical tabs (`proc_state`, `proc_audit`, `rec_jobDesc` rows), and never duplicates auth/status logic.

## Components

- `server/`: MCP entry, transport (streamable HTTP).
- `core/`: auth + identity, config loading, logging, errors, permissions, validation.
- `runtime/processRuntime.ts`: the only place status logic, status gating, and audit emission live.
- `registry/`: discovers and registers modules, tools, processes.
- `modules/{domain}/{process}/`: business logic (tools, schemas, services, permissions). `_template` is the scaffold source.
- `connectors/`: provider-neutral surface to external systems (google/* , http, webhook).
- `storage/`: the `StorageAdapter` interface (declared in `shared/types/contracts.ts`) and two impls — `inMemoryAdapter.ts` (default) and `sheetsStorageAdapter.ts` (the Google Sheets reference impl, selected by `STORAGE_BACKEND=sheets`). `index.ts` is the backend factory.
- `config/`: per-company YAML wiring, validated by zod.

## Data flow

1. MCP client request → transport (streamable HTTP).
2. `core/auth` resolves `RequestContext` (companyId, actorId, actorRole, apiKeyId).
3. `processRuntime` runs the fixed order: auth → permission → validate input → status gate → idempotency → handler → status update → audit.
4. Handler calls a module **service**; the service calls a **connector**. Handlers never call connectors directly.
5. State + audit persisted through `StorageAdapter` (InMemory by default; Google Sheets via `STORAGE_BACKEND=sheets`).

## External dependencies

- Google connectors (drive, docs, sheets, gmail, forms, calendar): provider-neutral surfaces. Live paths: **Sheets** (service account), **Docs** (service-account Shared Drive *or* OAuth user-delegation), **Gmail** (OAuth `gmail.send`). Drive/forms/calendar remain simulated skeletons.
- Generic connectors: http, webhook.
- Deploy target: Docker / Coolify VPS.

## Google Sheets structure (locked 2026-06-09)

**One spreadsheet per company, transversal across all HR modules.** Shared tabs are unprefixed (`Config`, `Users`, `employees`, `library`, `proc_state`, `proc_audit`); module tabs are prefixed (`rec_*`, future `trn_*`, `perf_*`, `eng_*`; legacy exception: `Applications`, `Activities`). Tab ownership and exact headers: `docs/hris_appscript_spec_final.txt` §4. Documented V2 split trigger: a module's high-volume data tab may move to its own spreadsheet (same Drive folder, keyed by `job_process_id`); governance + MCP tabs never move.

## Constraints

Enforceable constraints live in `AGENTS.md` "Locked architecture"; this file is only the compact system map.

---
