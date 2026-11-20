# PHANTOMS Web Projects — implementation and validation report

**Updated:** 2026-11-20 (UTC)
**Repository:** `/home/ubuntu/phantoms-ui-refresh`
**Latest feature/test commit on `main`:** `88fdf5b23187e0d8268db6008724100b455e1fa3` (`test: recognize pending Web Projects migration`), following implementation commit `1daa29ce06893b94b096b041b2f3227f0500d2c7`.

## Delivery status

The independent Web Projects module and its follow-up CI expectation correction are pushed to `origin/main`. The shared migration `20261120223000_web_projects_foundation.sql` remains pending and unapplied. GitHub's Production workflow `.github/workflows/deploy.yml` is `disabled_manually`, so no GitHub Production deployment ran for these commits. Vercel was not accessed; whether an independent Vercel Git integration deployed is unverified.

## Executive summary

Web Projects is implemented inside the existing PHANTOMS Dashboard; it is not an Internal Teams redesign or a separate application. Project membership and roles are separate from Internal Teams while reusing existing authenticated PHANTOMS members and identities.

Project-specific roles, consent, ownership, licensing, attribution, PHANTOMS branding/assets permission, and public-showcase consent are modeled explicitly. PHANTOMS ownership is never assumed. User-facing module entry points, administrator/member workspaces, project-scoped authorization, data persistence, and SQL-enforced access controls are included.

## Implemented module

- Added first-class Web Projects navigation, routes, separate feature permission, project API/repository and query-cache scope, administrator overview/workspaces, and a member-facing projects area. Internal Teams retains its separate permission model.
- Reuses existing Auth identities and `public.members.id`; project membership is many-to-many and carries its own `lead`, `contributor`, or read-only `viewer` role, responsibilities, agreement status, and project-specific authorization.
- Supports idea submission/review and idempotent approved-idea conversion; project discovery/workspaces; milestones, dependencies, and deliverables; separate Agile sprints/tasks; assignments, comments, checklists, and attachment metadata; weekly reports/reviews/blockers; resources, activity, and integration metadata.
- Adds project-scoped tables, RPCs, RLS/policies, validation constraints, composite same-project relationships, append-only consent/agreement/audit histories, and invoker-security progress views derived from stored tasks/deliverables.
- Records ownership model/notes, licensing, attribution, PHANTOMS asset/brand permission, and public-showcase permission explicitly. Brand/showcase choices default off, require recorded contributor consent, and reset on agreement amendment.
- Integration links are metadata-only. Safe external links are supported; no GitHub/Figma/provider connection is implied.

## Validation results

| Validation | Result |
|---|---:|
| Fresh isolated local PG17 migration chain | 45/45 migrations applied in disposable DB |
| Local pgTAP history | 20/20 suites; 928/928 assertions; every suite rolled back |
| New Web Projects pgTAP suite | 113/113 assertions |
| Initial manifest/provenance and static SQL checks | 35/35 tests passed |
| Follow-up manifest/provenance/deployment-safety tests | 32/32 passed |
| Follow-up Supabase CLI safety suite | 5/5 passed; asserts exactly 20 applied and 1 pending migration |
| GitHub Database Runtime Validation, corrected SHA | Passed all steps; run [44824844076](https://github.com/TheSeifDev/dashboard-phantoms/actions/runs/44824844076) |
| GitHub Android build, corrected SHA | Passed, including release APK publish step; run [44824844178](https://github.com/TheSeifDev/dashboard-phantoms/actions/runs/44824844178) |
| GitHub runtime steps | Loopback/PG17 health; full pgTAP; inventory pagination; Auth fixture/process lifecycle; real disposable dashboard; real Auth; member-password HTTP; SQL concurrency; sanitized evidence; exact cleanup; checksum revalidation — all passed |
| Earlier frontend regression/static/build checks | 21 navigation/API/Auth and 7 permission/domain tests; TypeScript, UX guard, lint, production build, and secret audit passed |
| Dedicated screenshot-based responsive Arabic/English/light/dark QA | Not evidenced; no screenshots are claimed |

The first implementation SHA's Database Runtime Validation run failed because `frontend/scripts/supabase-cli-safety.test.mjs` still expected zero pending migrations. The intended manifest state is one pending Web Projects migration and 20 applied forwards. The test was corrected to assert that exact pending migration (version/name and null remote timestamp); focused local checks passed, and both GitHub workflows then passed on the corrected SHA. The initial Android workflow also passed. The run links above provide the GitHub evidence.

## Security, ownership, and validation boundary

The local SQL run used a fresh local-only PG17 runtime on Docker `network=none`, with no host-published ports. Every pgTAP fixture transaction rolled back. The runtime was stopped by its owner-aware cleanup runner; evidence records the assigned data directory removed. A separate local Auth/Chromium attempt was blocked before services started because sandbox Docker lacked the legacy iptables `raw` table. Network protections were not weakened, and exact temporary-resource cleanup succeeded. GitHub's separate disposable runtime did pass its dashboard/Auth/HTTP workflow, but that does not provide the requested bilingual responsive/theme screenshot set.

The pending migration SHA-256 is `c01a551caba77a91827a9566e5d9e1c9b4e1482dd99d636f4efc48c0ede75c64`. No hosted Supabase project was linked or contacted, and no shared database was modified. No direct Vercel access occurred.

## Remaining operational items

1. Apply the pending migration to a shared environment only after separate explicit authorization. The feature's shared schema is not deployed.
2. The GitHub Production workflow is manually disabled. Re-enabling it affects future matching `main` pushes and a follow-up push would be needed to trigger it; no change was made. A Production rollout should be coordinated with the shared migration.
3. Run the requested screenshot-based responsive QA for desktop/mobile, Arabic/English, and light/dark in a suitable runtime. The local sandbox's Docker restriction prevented that evidence capture.
4. Configure a storage provider/bucket before claiming real file uploads. Current behavior supports safe external links and storage-object metadata, not an active upload pipeline.
5. Keep third-party integrations described as metadata-only until provider credentials and real API flows are separately implemented and verified.

The API/table/RPC contract is documented in [the Web Projects API contract](WEB_PROJECTS_API_CONTRACT.md); the read-only initial implementation audit is preserved in [the independent review](WEB_PROJECTS_INDEPENDENT_REVIEW.md).
