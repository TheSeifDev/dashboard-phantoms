# PHANTOMS Web Projects — local implementation report

**Date:** 2026-11-20
**Repository:** `/home/ubuntu/phantoms-ui-refresh`
**Delivery state:** Implemented locally; uncommitted; shared migration and deployment remain unauthorized and untouched.

## Executive summary

The independent **Web Projects** feature has been implemented inside the existing PHANTOMS Dashboard, with separate Dashboard and member-portal entry points. It is not an Internal Teams redesign or a separate application. Project roles and membership are stored independently from Internal Teams and reuse the existing authenticated PHANTOMS members.

The local backend and SQL contract now pass a fresh PostgreSQL 17 validation: **45 migrations applied in the disposable database, 20 pgTAP suites, 928/928 assertions, and rollback confirmed for every suite**. Manifest/provenance and static SQL-contract tests also pass. The actual local Supabase Auth/Chromium run was attempted but the sandbox Docker bridge could not start because the host's legacy `iptables` lacks its `raw` table. I did not weaken network protections; exact temporary-resource cleanup succeeded. As a result, real-browser screenshots and responsive browser evidence are not available and are not claimed.

## Implemented module

- Added first-class Web Projects navigation, routes, separate feature permission, project API/repository and query-cache scope, administrator overview/workspaces, and a member-facing projects area. Internal Teams retains its separate eight-key permission model.
- Reuses existing Auth identities and `public.members.id`; project membership is many-to-many and carries its own `lead`, `contributor`, or read-only `viewer` role, responsibilities, agreement status, and project-specific authorization.
- Supports idea submission and administrator review, approved-idea conversion that preserves source/submitter and is idempotent, project discovery and workspaces, milestones/dependencies/deliverables, separate Agile sprints and tasks, assignment/comments/checklists/attachments, weekly reports/reviews/blockers, resources, activity, and integration metadata.
- Adds project-scoped tables, RPCs, RLS/policies, validation constraints, composite same-project relationships, append-only consent/agreement/audit histories, and invoker-security progress views derived from stored tasks/deliverables.
- Records ownership model/notes, licensing, attribution, PHANTOMS asset/brand permission, and public-showcase permission explicitly. Brand/showcase choices default off, require recorded contributor consent, and reset on agreement amendment. The system does not assume PHANTOMS owns project IP.
- Integration links are explicitly metadata-only. Safe external links are supported; no GitHub/Figma/provider connection is implied.

## Validation results

| Validation | Result |
|---|---:|
| Fresh disposable PG17 migration chain | 45/45 migrations applied |
| Existing pgTAP suites 01–19 | 815/815 assertions |
| New Web Projects pgTAP suite | 113/113 assertions |
| All database suites | 20/20; 928/928 assertions; every suite rolled back |
| Migration manifest, provenance, forward migration, SQL contract | 35/35 tests |
| `git diff --check` | Passed |
| Prior frontend regression checks | 21 navigation/API/Auth + 7 permission/domain tests passed |
| Prior frontend static/build checks | TypeScript, UX guard, lint (0 warnings/errors), production build, secret audit (0 secrets) passed; existing non-fatal chunk-size warning remains |
| Real Auth/API/Chromium/browser screenshots | Not run: Docker bridge failed before services started |

Detailed runtime facts and the sanitized evidence location are in [the local validation record](WEB_PROJECTS_LOCAL_VALIDATION.md). The API/table/RPC contract is documented in [the Web Projects API contract](WEB_PROJECTS_API_CONTRACT.md), and the read-only initial implementation audit is preserved in [the independent review](WEB_PROJECTS_INDEPENDENT_REVIEW.md).

## Security, ownership, and validation boundary

The successful SQL run used a fresh local-only PG17 runtime on Docker `network=none`, with no host-published ports. Every pgTAP fixture transaction rolled back. The runtime was stopped by its owner-aware cleanup runner; evidence records the assigned data directory removed. A separate attempted local Supabase/Auth/browser run used a unique temporary project and loopback-only bridge. Docker reported that it could not install its direct-access filtering rule because the sandbox has no legacy iptables `raw` table. The harness removed its exact temporary containers, volumes, and bridge, and a follow-up inventory found zero matching disposable resources. I did not change iptables, Docker daemon settings, or network isolation.

The Web Projects migration remains registered as **pending / `not_applied`**. Its SHA-256 is `c01a551caba77a91827a9566e5d9e1c9b4e1482dd99d636f4efc48c0ede75c64`. No hosted Supabase project was linked or contacted, and no shared database was modified. No commit, push, Vercel access, or deployment occurred. The changes remain in the local working tree.

## Open items before claiming full release acceptance

1. Run the real Auth/API/Chromium browser workflow, including desktop/mobile, Arabic/English, light/dark, and capture screenshots in a runtime whose Docker networking supports the same loopback-only isolation. Until then, browser behavior is unverified.
2. Configure and validate a storage provider/bucket before claiming that file uploads work. Current behavior is safe external links and storage-object metadata, not an active upload pipeline.
3. Keep third-party integrations described as metadata-only until provider credentials and real API flows are separately implemented and verified.
4. Apply the pending migration to any shared environment, commit/push, or deploy only after the user's separate explicit authorization. None of those actions are part of this local delivery.
