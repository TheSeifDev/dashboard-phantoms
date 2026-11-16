# PHANTOMS — Executed production initialization

**Date:** 14 November 2026  
**Repository:** https://github.com/TheSeifDev/dashboard-phantoms  
**Approved source commit:** `fd7e75442c7a138920de933b87273b5640022008`  
**Supabase:** `wxwoaputugxwysuhcebv` — PHANTOMS, `eu-west-2`, organization `zfgjqsgqxnytjsodzhol`  
**Project URL:** https://wxwoaputugxwysuhcebv.supabase.co

## Result

**Database initialization is complete. Application production rollout is not yet complete.** All 24 approved migration files were applied, unchanged and in order, through Supabase MCP. Every application returned `success: true`; the final remote inventory contains exactly 24 matching migration names in the approved order. No reset, blind history repair, unrelated-object removal, direct PostgreSQL password connection, Auth-user creation, or Owner promotion was performed.

The two core Edge Functions, `admin-invite` and `admin-delete-account`, are deployed and **ACTIVE, version 2, with `verify_jwt: true`**. Their owner checks remain intact and their CORS allowlists include the CI-confirmed canonical frontend origin, `https://dashboard-phantoms.vercel.app`. WhatsApp remains disabled. AI is deferred. Push dispatch was not deployed because VAPID configuration is absent.

The remaining external gates are Vercel connector authorization and a confirmed Auth-backed Owner identity. A GitHub public-environment update also encountered an explicit integration-permission denial, described below. No successful Vercel environment update or new frontend deployment is claimed.

## 1. Confirmed MCP connectivity and initial snapshot

All requested tool types executed successfully against the exact project: `get_project`, `list_migrations`, `list_tables`, `list_extensions`, `execute_sql`, and security/performance `get_advisors`. `list_projects` first discovered and confirmed the target. `get_project` returned PHANTOMS, `ACTIVE_HEALTHY`, PostgreSQL 17.11, the expected organization and region.

The initial catalog and aggregate SELECT results were:

| Inspection | Actual result |
|---|---|
| Remote migration history | Empty |
| Public tables, views, materialized views, sequences and foreign tables | Empty |
| Public routines and RLS policies | Empty |
| Auth schema | `auth.users` exists; aggregate user count **0** |
| Storage | Buckets and objects tables exist; bucket count **0**, object count **0**; bucket metadata empty |
| Vault | `vault.secrets` available; no secret value was read |
| Crypto prerequisites | `extensions.digest(text,text)` and `extensions.digest(bytea,text)` available |
| Installed extensions | `pgcrypto` 1.3, `uuid-ossp` 1.1, `plpgsql` 1.0, `pg_stat_statements` 1.11, `supabase_vault` 0.3.2 |
| CREATE privileges | `postgres` can CREATE in public/extensions; anon/authenticated cannot |
| Default grants | Supabase defaults initially expose newly created public objects; the approved chain explicitly revokes/restricts access |
| Security/performance advisors | No findings before initialization |

An immediate pre-application SELECT reconfirmed zero public objects, zero public routines, zero Auth users, zero buckets and zero Storage objects.

Only catalog metadata, configuration metadata and aggregate counts were inspected. Personal user rows, device tokens, credentials, Storage object contents and Vault secret values were not retrieved.

## 2. Migration reconciliation and execution

The whole tightly coupled chain was reviewed in order. Its exact SQL bytes were compared with the approved commit before creating the MCP payloads. Independent migration review and successful approved-commit CI provided the safety gate.

The approved commit's [Database Runtime Validation run](https://github.com/TheSeifDev/dashboard-phantoms/actions/runs/43612658668) applied all 24 files on a disposable Supabase stack and reported **6 pgTAP files, 258 tests, PASS**. This is the post-repair result; the older 259-test observation in a historical report is not used as current evidence. Fixtures were not inserted into production to repeat the pgTAP suite.

Focused reconciliation:

- **0006:** The baseline supplies the transitional team column. The lookup function is dropped before its return signature changes, and the intended team columns are subsequently removed.
- **0013:** Crypto overloads exist. Legacy plaintext-token migration/clearing had no member rows to affect; the final private session table stores hashes.
- **0018:** Approval/tracking backfill had no tasks or notes to affect. Final approval/reversal routines exist.
- **0020:** `CASCADE` retires the two empty tables created by 0019. The initial public catalog contained no unrelated dependencies or data. Final custom-field/invite objects replaced that transitional surface.
- **0023:** Evaluation labels/defaults normalize to `إدارة PHANTOMS`; no existing evaluations or Auth identities were changed.

The only seeded application row is `whatsapp_settings(id=1, enabled=false)`. There are no seeded administrators or legacy administrator emails.

### Remote migration identifiers: important operational note

Supabase MCP's `apply_migration` generates the remote **version timestamp**. It does not accept the source file's timestamp as a separate parameter. Therefore each migration name includes the original full source stem, while its remote version reflects this execution on 14 November.

The preserved manifest maps all 24 **source filenames, source versions, SHA-256 checksums, MCP names and remote versions**. The first remote version is `20261114163426`, and the last is `20261114164006`.

**Do not blindly run `supabase db push` against the old local timestamps.** Reconcile this explicit mapping first; otherwise the CLI can interpret already-applied source files as pending. No reset, source-file renaming, remote-version rewrite or repair was performed. Future migrations should continue through an explicitly reconciled mechanism, not replay this chain.

## 3. Verified final database

| Invariant | Actual result |
|---|---:|
| Applied migrations | **24** |
| Public application tables | **12** |
| Public sequences | **8** |
| Public routines | **37** |
| Public views/materialized views | **0** |
| Tables without RLS | **0** |
| Anonymous direct table privileges | **0** |
| Anonymous direct column privileges | **0** |
| SECURITY DEFINER routines without pinned search_path | **0** |
| Anonymous or unconditional-true public policies | **0** |
| Feature-scoped authenticated policies | **22** |
| Auth users / Owners / legacy admin emails | **0 / 0 / 0** |
| Members / tasks / notes | **0 / 0 / 0** |
| Storage buckets / objects | **0 / 0** |
| WhatsApp setting | Singleton `id=1`, **enabled=false** |

The exact final table set is `admin_accounts`, `admin_emails`, `announcements`, `member_custom_fields`, `member_device_sessions`, `member_evaluations`, `member_infinite_bonus_events`, `member_registration_invites`, `members`, `notes`, `tasks`, and `whatsapp_settings`.

The obsolete `member_info_fields`, `member_info_submissions`, one-argument member lookup, administrative direct-delete RPC, and team columns are absent. The member lookup return type contains neither a session token nor team data. The expected custom fields, infinite-bonus flag, approval-note source columns and task bonus column exist.

Catalog inspection verified owner/admin access routines, permission checking, member/device/invite routines, approval/reversal, rating, evaluation, announcement and push subscription routines. Privileged administration and Vault routines are not executable by anon. Vault getter/setter routines are service-role-only. The private device, audit, administration and WhatsApp tables have no direct authenticated privileges.

The single-Owner partial unique index exists. The permissions default and check constraint require exactly eight boolean keys: `dashboard`, `members`, `tasks`, `ranking`, `notes`, `announcements`, `whatsapp`, and `ai_assistant`.

## 4. Advisor findings: retained transparently

Post-application advisors are **not empty**. No unapproved 25th migration was applied to suppress findings.

| Finding | Count / disposition |
|---|---|
| [RLS enabled with no policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | **5 INFO**: the private admin, legacy-email, device-session, immutable-audit and WhatsApp tables intentionally deny direct client access |
| [Mutable function search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) | **1 WARN**, `guard_anon_tracking_update`; this is an existing SECURITY INVOKER trigger, not an unpinned definer. Hardening remains a separately reviewed follow-up |
| [Anonymous SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) | **17 WARN**: intended device/invite-guarded portal RPC surface; blanket revocation would break that design |
| [Authenticated SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | **31 WARN**: intended guarded member/admin RPC surface; owner/feature checks remain required |
| [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) | **7 INFO**, performance follow-up |
| [Unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) | **13 INFO**, expected on a newly initialized empty database; no indexes were dropped |

These exposure warnings were reconciled with the approved guarded-RPC design and disposable security tests; they are not evidence that anonymous direct table access was granted. This report does not claim that every advisor warning has been remediated.

## 5. Application work executed

Active changes correct the obsolete Owner-bootstrap project pin and local Supabase project ID. The bootstrap retains explicit target matching, Auth confirmation, preview-by-default, server-side key requirements and the single-Owner check. Five local negative/pin tests pass without contacting production.

Core function JWT settings are explicit in `config.toml`. Both administration functions were deployed, then updated to allow the verified `dashboard-phantoms.vercel.app` origin. The old default alias remains a compatibility origin; CORS is not authorization, and gateway JWT plus owner checks remain intact.

The health helper now uses `backend/supabase/migrations` and 14-digit filenames; expected anonymous table denial is accepted; absent VAPID is a warning; disabled WhatsApp and deferred AI are not probed. The existing frontend required-file resolution was already correct and was not needlessly rewritten.

The private local build environment contains only the correct Supabase URL, a live enabled **publishable** key returned by MCP, and the canonical public web URL. No service-role credential was fetched or put into frontend configuration. The environment example's canonical frontend domain was corrected.

### Tests and build evidence

- Security regression: **45/45**.
- Runtime integration regression: **8/8**.
- Brand checks: **10/10**.
- Storage migration checks: **6/6**.
- Spreadsheet safety checks: **10/10**.
- Supabase CLI safety checks: **4/4**.
- Owner-bootstrap pin/safety checks: **5/5**.
- TypeScript production build and UX guard: **passed**.
- Oxlint: **0 warnings, 0 errors**.
- Source/outgoing/build credential scanners: **0 findings**.
- Feature-aware frontend health: **25 PASS, 2 optional-feature WARN, 0 FAIL**.
- Production assets and service worker: **built successfully**; existing large-chunk/deprecation warnings remain non-blocking.

### HTTP evidence and scope

Supabase Auth health returns **200** using the public key. The REST OpenAPI root returns **401, “Secret API key required”**: that endpoint deliberately refuses publishable-key schema introspection, so no secret was requested as a workaround. Protected anonymous table access is denied.

Both core functions return **401** for unauthenticated POST and **200** for canonical-origin OPTIONS, with `Access-Control-Allow-Origin: https://dashboard-phantoms.vercel.app`.

The approved-commit GitHub deployment log identifies `https://dashboard-phantoms.vercel.app` as the canonical frontend. Its `/admin/login` returns **200**, with CSP, HSTS, `nosniff` and `DENY`. The historical/default `admin-phantoms.vercel.app` URL returns 404. These are checks of the **existing** frontend, not proof of a newly deployed version or proof of its current Vercel environment values.

## 6. Exact remaining blockers and safe continuation

1. **Vercel connector authorization:** tool discovery reports the Vercel MCP server requires login. Its project/environment configuration cannot yet be read or changed. The repository binding is project `prj_TF9RUPoL6m7KBHmqoTicNz8ckaFX`, team `team_lXM44i2rcXEpwbIUTBDfAhHm`. After authorization, verify that binding, inspect production variables without exposing private values, set the correct public Supabase URL/key and public web URL, and deploy/verify the intended frontend version. Also inspect Supabase Auth site/redirect configuration for `/admin/set-password`; local config URLs are not evidence of remote Auth settings.
2. **Owner identity:** Auth count is **0**, so no confirmed Auth UUID exists to bootstrap. No identity was fabricated, queried from personal data, or promoted. A separately approved Auth-backed Owner provisioning step is necessary. The corrected bootstrap is ready but was not executed against a nonexistent user.
3. **GitHub Actions environment permissions:** attempting to update the two known public build values failed before any write: **HTTP 403, “Resource not accessible by integration”**, on `/repos/TheSeifDev/dashboard-phantoms/actions/secrets/public-key`. Neither variable was changed. Do not assume the existing GitHub build configuration now targets the new project. Vercel deployment configuration should be corrected through its authorized connector; future GitHub-driven builds also require those public values to be reconciled through an authorized Actions-secrets capability.
4. **Optional services:** WhatsApp stays disabled; AI remains undeployed/deferred; push needs properly configured server-side VAPID secrets plus its public key before deployment.

Application changes should remain on a non-production branch until the Vercel production environment is verified, to avoid an automatic deployment against stale configuration. Do not replay migrations, reset the initialized database, enable optional services or bypass access gates.
