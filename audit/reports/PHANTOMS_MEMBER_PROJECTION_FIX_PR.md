# PHANTOMS — member projection correction (PR and disposable CI only)

## Authorization boundary

The user approved preparation of a separate fix PR and disposable CI on 16 November 2026. Production application, migration history, grants, data and frontend deployment must remain unchanged. This branch is `fix/phantoms-member-projections-wxwo`, based on main `ca129a2cf231b964f44a2b1b945490906a8a968e`. It must not be merged or deployed automatically.

## Observed production blocker

The exact approved Owner signs in successfully, `get_admin_access` confirms both Owner and administrator status, and the session survives a full reload. The deployed Dashboard and Members page fail to load member data. An authenticated bounded query through the actual deployed SDK reports `403`, code `42501`, `permission denied for table members` for `SELECT *`; selecting `members.id`, `tasks.id` and `notes.id` succeeds.

The existing immutable `20261114163750_member_device_sessions.sql` revokes table-wide member SELECT and grants only ten safe columns. The frontend still requests wildcard member lists and wildcard create/update/upsert responses. Seven ordinary administrator columns lack authenticated SELECT grants; `session_token` and `push_subscription` correctly remain denied. Live catalog checks confirm that authenticated INSERT/UPDATE/DELETE grants already exist, so DML-grant changes are not needed.

## Correction prepared in this PR

1. Use one explicit administrator projection with all 17 non-secret member fields for member reads and mutation responses. Keep the existing restricted public projection and write-field sanitizers.
2. Add `20261116061247_admin_member_column_access.sql`, containing only a transactional named SELECT grant for `team_notes`, `residence`, `work_conditions`, `phone`, `gender`, `bonus_infinite` and `custom_fields` to `authenticated`. Do not grant table-wide SELECT or secrets. Preserve existing row-level permissions, anonymous/public access and write grants.
3. Keep `production-initialization-manifest.json` and all 24 initialization migration bytes unchanged. Register the one new file separately in `forward-migration-manifest.json` with its own SHA-256, `production_status: not_applied`, and null remote applied timestamp. The separate registration is not evidence of production application.
4. Validate the strict 24-entry historical provenance plus explicitly registered forward files. Unregistered files, altered bytes, backward/duplicate versions and invented application status remain errors. The repository/disposable stack contains 25 migrations; production remains at its original 24.
5. Add frontend projection regressions and a disposable seventh pgTAP suite covering administrator reads and CRUD, secret-column denials, failed wildcard-return rollback, anonymous denial and permission-scoped RLS. Scope the original history assertions to the initial 24-migration cohort instead of falsely treating the new file as originally applied.

## Validation and deployment safety

The Database Runtime Validation workflow runs in a fresh Docker-local Supabase stack with no remote project link, production DB URL, access token or database password. It applies 25 local files and runs all pgTAP suites, Node tests, TypeScript, lint and a production build configured with localhost-only public values. It has no remote mutation or frontend deployment step.

Both root and frontend Vercel Git settings disable deployment for this exact branch. The legacy `PHANTOMS — Build & Deploy` workflow remains disabled; defensive PR guards also exclude this branch from legacy health/Preview paths. Existing guards and unrelated routing/header configuration are preserved.

Exact CI results and run URLs will be recorded in the PR description and delivered evidence after the runs finish. This document does not claim pending tests have passed.

## Remaining production gate

No production correction is authorized by this PR-preparation approval. After review and passing disposable CI, a new explicit approval is required before applying the single forward correction or merging a new native Git rollout. Do not replay the original 24 SQL files, edit remote history, execute migration repair, or run a real db push as part of this work.

Only after an approved correction/deployment should the real Owner-session member create/read/reload/update/delete test be repeated with exact-record cleanup. PHANTOMS remains operationally blocked until that actual persistence workflow succeeds. WhatsApp, AI and Push remain deferred throughout.
