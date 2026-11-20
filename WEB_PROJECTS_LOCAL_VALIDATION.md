# Web Projects local validation record

**Updated:** 2026-11-20 21:26 UTC
**Scope:** PHANTOMS Web Projects changes in `/home/ubuntu/phantoms-ui-refresh`. Everything remains local and uncommitted.

## Safety boundary and current state

- The Web Projects migration `20261120223000_web_projects_foundation.sql` is registered as the sole pending forward migration. The manifest still records 20 historical forward migrations as applied and the Web Projects migration as `not_applied`; the migration has not been applied to any hosted/shared Supabase project.
- No hosted Supabase project was linked or contacted. No shared database write, commit, push, deployment, Vercel access, or Vercel change occurred.
- The pending migration SHA-256 is `c01a551caba77a91827a9566e5d9e1c9b4e1482dd99d636f4efc48c0ede75c64`.

## Disposable PostgreSQL 17 migration and pgTAP run — PASS

The full local SQL run used `/home/ubuntu/phantoms-handoff/web-projects-runtime-20261120/run-disposable-pgtap.py`. Its PostgreSQL container used the cached Supabase PG17 image, Docker `network=none`, and zero host-published ports. Auth bootstrap ran in that same isolated network namespace; it exposed no listener. The runner created a fresh database, applied every repository migration, and executed all discovered pgTAP files.

| Check | Result |
|---|---:|
| Migration files applied locally | 45/45 |
| pgTAP suites completed | 20/20 |
| Existing suites 01–19 | 815/815 assertions |
| Web Projects suite 20 | 113/113 assertions |
| Total assertions | 928/928 |
| Test fixture rollback | 20/20 suites returned `ROLLBACK` |

The four original Web Projects assertion failures were test setup/expectation mistakes, not production-policy defects. The tests now expect the RPC's `WEB_PROJECT_CONTRIBUTOR_ROLE_REQUIRED` denial, use an accepted contributor for the cross-project deliverable FK case, inspect post-amendment state as program admin after preserving lead-access checks, and reset the simulated SQL role before switching identities. The pending migration itself was not edited during this correction.

Sanitized machine-readable evidence is at `/home/ubuntu/phantoms-handoff/web-projects-runtime-20261120/pgtap-evidence.json`. The exact PG17 runner was stopped through its ownership-verifying `stop` command; its cleanup record reports `passed: true` and `data_removed: true`.

## Manifest and static SQL checks — PASS

Command:

```bash
node --test backend/scripts/migration-manifest.test.mjs backend/scripts/forward-migrations.test.mjs backend/scripts/web-projects-sql-contract.test.mjs
```

Result: **35 passed, 0 failed**. The checks confirmed unchanged historical provenance/checksums, the one pending additive migration, and the project-scoped SQL/security contracts. `git diff --check` also passed. The migration-manifest preflight found 24 initialized migrations plus 21 forward files (20 applied, one pending), for 45 canonical SQL files.

## Frontend checks previously completed on this unchanged UI snapshot

The earlier local frontend validation passed 21 navigation/API/Auth regressions and 7 permission/domain checks; TypeScript, UX guard, lint (0 warnings/errors), production build, and build-artifact secret audit (0 secrets) also passed. The build emitted the existing non-fatal chunk-size warning. No frontend source was changed during the resumed SQL-test correction.

## Actual local Auth/browser/responsive QA — BLOCKED BY SANDBOX NETWORKING

The non-mutating preflight for `backend/scripts/validate-web-projects-local.sh` passed: all 20 pgTAP files retained balanced transaction/rollback boundaries, and the manifests/checksums validated. I then attempted its real disposable Supabase/Auth/Chromium flow with its generated project and a Docker bridge explicitly bound to `127.0.0.1`.

The attempt stopped before the local database/Auth services or Playwright suite could start. Docker failed to create the database container endpoint because legacy `iptables` in this sandbox has no `raw` table (`Unable to enable DIRECT ACCESS FILTERING - DROP rule`). No filtering was disabled and no daemon/network security setting was weakened. The harness reported successful exact-resource cleanup. A follow-up inventory found zero matching disposable Supabase containers, volumes, or bridges; the independent network-none PG17 runner had also already been cleaned up.

Consequently, `frontend/scripts/web-projects-live.test.mjs` did **not** execute, and no real-browser screenshots or responsive Arabic/English/light/dark browser results are claimed. No synthetic screenshot was substituted for the requested evidence. Browser QA should be rerun in a runtime where the same loopback-only Docker policy can start successfully.

## Remaining operational limitations

- File upload storage/bucket configuration was not present. The implementation supports safe external links and storage-object metadata; a real upload provider/bucket is still required before claiming uploads are operational.
- External repository/design/product integrations remain metadata-only links; no external provider is represented as connected.
- The broad product acceptance checklist remains open where browser QA, storage setup, or other end-to-end evidence is required. See [the final implementation report](WEB_PROJECTS_FINAL_REPORT.md) and [the API contract](WEB_PROJECTS_API_CONTRACT.md).
