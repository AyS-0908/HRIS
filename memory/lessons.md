# Lessons

- 2026-06-03: Google service-account JSON may be pasted into `.env` as formatted multi-line JSON. Test scripts must support multi-line `GOOGLE_SERVICE_ACCOUNT_JSON`, not only one-line `.env` values.
- 2026-06-03: Typing `App.storage` as the `StorageAdapter` interface (not the concrete `InMemoryStorageAdapter`) immediately surfaced hidden coupling — the integration test called the impl-only `auditFor` helper. Lesson: expose interfaces in public types; tests needing impl-only helpers must cast explicitly (`as InMemoryStorageAdapter`). The compiler then guards the boundary for free.
