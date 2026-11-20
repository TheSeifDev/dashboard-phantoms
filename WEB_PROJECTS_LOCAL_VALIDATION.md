# Web Projects validation record

**Updated:** 2026-11-20 22:04 UTC
**Repository:** `/home/ubuntu/phantoms-ui-refresh`
**Latest feature/test commit on `main`:** `88fdf5b23187e0d8268db6008724100b455e1fa3`; implementation commit `1daa29ce06893b94b096b041b2f3227f0500d2c7`.

## Safety boundary and delivery state

The Web Projects migration `20261120223000_web_projects_foundation.sql` is the sole pending forward migration. The manifest records 20 historical forward migrations as applied and the Web Projects migration as `not_applied`; it has not been applied to any hosted/shared Supabase project. Its SHA-256 is `c01a551caba77a91827a9566e5d9e1c9b4e1482dd99d636f4efc48c0ede75c64`.

The implementation and focused CI-safety correction are pushed to `main`. GitHub reports `.github/workflows/deploy.yml` as `disabled_manually`; no GitHub Production run is present for the corrected SHA. Vercel was not accessed, and a separate Vercel Git integration deployment was not checked. No shared database write or migration apply occurred.

## Disposable PostgreSQL 17 migration and pgTAP — PASS

The full local SQL run used `/home/ubuntu/phantoms-handoff/web-projects-runtime-20261120/run-disposable-pgtap.py`. Its PostgreSQL container used the cached Supabase PG17 image, Docker `network=none`, and zero host-published ports. Auth bootstrap ran in that same isolated network namespace and exposed no listener. The runner created a fresh database, applied every repository migration in the disposable database, and executed all discovered pgTAP files.

| Check | Result |
|---|---:|
| Migration files applied in disposable DB | 45/45 |
| pgTAP suites completed | 20/20 |
| Existing suites 01–19 | 815/815 assertions |
| Web Projects suite 20 | 113/113 assertions |
| Total assertions | 928/928 |
| Test fixture rollback | 20/20 suites returned `ROLLBACK` |

The four original Web Projects assertion failures were test setup/expectation mistakes, not production-policy defects. The tests now expect the RPC's `WEB_PROJECT_CONTRIBUTOR_ROLE_REQUIRED` denial, use an accepted contributor for the cross-project deliverable FK case, inspect post-amendment state as program admin after preserving lead-access checks, and reset the simulated SQL role before switching identities. The pending migration itself was not edited during this correction.

Sanitized machine-readable evidence is at `/home/ubuntu/phantoms-handoff/web-projects-runtime-20261120/pgtap-evidence.json`. The exact PG17 runner was stopped through its ownership-verifying `stop` command; its cleanup record reports `passed: true` and `data_removed: true`.

## Manifest and static SQL checks — PASS

The original manifest/provenance/SQL-contract validation passed **35/35 tests**. The follow-up correction to `frontend/scripts/supabase-cli-safety.test.mjs` now expects the deliberate state of exactly one pending Web Projects migration and 20 applied forwards. It additionally verifies version `20261120223000`, name `web_projects_foundation`, and `remote_applied_timestamp: null`.

After that correction, the focused local run reported **32/32** manifest, provenance, forward-migration, and deployment-safety tests passed; the Supabase CLI safety suite reported **5/5** passed. The migration manifest preflight found 24 initialized migrations plus 21 forward files (20 applied, one pending), for 45 canonical SQL files. `git diff --check` passed.

## GitHub Actions for the corrected main SHA — PASS

Both runs below target exact SHA `88fdf5b23187e0d8268db6008724100b455e1fa3`:

- [Database Runtime Validation — run 44824844076](https://github.com/TheSeifDev/dashboard-phantoms/actions/runs/44824844076): passed. The frontend safeguards, controller, TypeScript, lint, build, and secret audit passed. The disposable-runtime job passed migration checks, loopback-only/PG17 health, full pgTAP history, inventory pagination, Auth fixture/process ownership, the real disposable dashboard workflow, existing real Auth workflow, member-password HTTP acceptance, SQL-only concurrency, sanitized-evidence validation, exact cleanup, and checksum revalidation.
- [Build PHANTOMS Android APK — run 44824844178](https://github.com/TheSeifDev/dashboard-phantoms/actions/runs/44824844178): passed, including the release APK publish step.

The earlier run on implementation SHA `1daa29ce06893b94b096b041b2f3227f0500d2c7` failed at the stale assertion expecting zero pending migrations. Evidence validation and cleanup messages after that early failure were cascades because the disposable stack and evidence files were never created. The test correction was pushed in commit `88fdf5b23187e0d8268db6008724100b455e1fa3`, after which all listed GitHub runtime steps passed.

## Frontend checks previously completed

The earlier local frontend validation passed 21 navigation/API/Auth regressions and 7 permission/domain checks; TypeScript, UX guard, lint (0 warnings/errors), production build, and build-artifact secret audit (0 secrets) also passed. The build emitted the existing non-fatal chunk-size warning.

## Auth/browser and visual QA boundary

A local attempt to start Supabase/Auth/Chromium with the harness's generated project and loopback-only Docker bridge stopped before the services or Playwright suite could start. Docker could not install its direct-access filtering rule because this sandbox's legacy iptables installation has no `raw` table (`Unable to enable DIRECT ACCESS FILTERING - DROP rule`). No filtering was disabled and no daemon/network security setting was weakened. The harness reported successful exact-resource cleanup, and a follow-up inventory found zero matching disposable Supabase containers, volumes, or bridges.

GitHub's disposable runtime run subsequently passed its real dashboard, Auth, and HTTP workflows. However, dedicated screenshot-based responsive QA for desktop/mobile, Arabic/English, and light/dark was not captured; those visual results are not claimed. No synthetic screenshot was substituted.

## Remaining operational limitations

- The shared Web Projects migration is still pending and requires separate authorization before any shared-environment apply.
- The GitHub Production workflow is manually disabled. Re-enabling it could affect future matching `main` pushes and needs explicit confirmation; no re-enable or production deployment was performed. No Vercel resource was accessed.
- File upload storage/bucket configuration was not present. The implementation supports safe external links and storage-object metadata; a real upload provider/bucket is still required before claiming uploads are operational.
- External repository/design/product integrations remain metadata-only links; no external provider is represented as connected.

See [the final implementation report](WEB_PROJECTS_FINAL_REPORT.md) and [the API contract](WEB_PROJECTS_API_CONTRACT.md) for the feature overview and schema details.
