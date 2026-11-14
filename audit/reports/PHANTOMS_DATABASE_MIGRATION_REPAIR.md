# PHANTOMS — Database Migration Repair Report

**Branch:** `fix/phantoms-database-initialization`
**Base:** `main` (`33d7137`)
**Target Supabase project:** `cbuiwgrmsmsidyjhzvla`
**Scope:** local implementation and disposable validation only

## Final verdict

> **READY FOR REMOTE DATABASE DRY-RUN**

This phase does not push, reset, bootstrap, or otherwise mutate the remote Supabase project. Remote application remains a separately approved operation.

## Repository state

The repair branch is one commit ahead of `main` and contains the canonical Supabase CLI workspace under `backend/supabase/`, 24 timestamped migrations, a hardened Owner bootstrap procedure, migration inventory tooling, and a GitHub Actions disposable-runtime workflow.

WhatsApp remains disabled. No WhatsApp worker, dispatch path, table, or historical data was removed.

## Repairs completed

### Migration chain

- Added the missing baseline `members.team` column required by early historical migrations, then removed it through the intended 0006 lifecycle.
- Fixed migration 0006 by dropping `public.lookup_member_by_email(text)` before recreating it with a changed table-return signature. PostgreSQL does not allow `CREATE OR REPLACE FUNCTION` to change OUT/table return types.
- Removed hardcoded Auth identities and production-like placeholder administrator emails from migrations.
- Preserved the final `admin_accounts.permissions` JSONB model with exactly eight keys: `dashboard`, `members`, `tasks`, `ranking`, `notes`, `announcements`, `whatsapp`, and `ai_assistant`.
- Disabled missing seed loading in `backend/supabase/config.toml`; no `seed.sql` is shipped and tests create rolled-back fixtures instead.

### Owner bootstrap

`backend/scripts/bootstrap-phantoms-owner.mjs` now:

- Requires `PHANTOMS_INITIAL_OWNER_ID`.
- Requires `PHANTOMS_SUPABASE_PROJECT_REF=cbuiwgrmsmsidyjhzvla`.
- Verifies the Supabase URL host matches the approved project reference.
- Refuses publishable/anon keys and requires a server-side key.
- Requires a confirmed Auth user.
- Queries only existing `role=owner` rows and enforces the single-owner invariant.
- Defaults to preview; only `--execute` can insert the Owner record.
- Does not print credentials or response bodies.

### Migration tooling

`frontend/scripts/run-migrations.mjs` is now inventory/print-only. It retains `--check` and `--print`, explicitly rejects `--apply`, and contains no REST SQL execution path. Supabase CLI is the only supported application mechanism:

```sh
supabase db push --workdir backend
supabase migration list --workdir backend --remote=cbuiwgrmsmsidyjhzvla
```

## Validation evidence

### Disposable PostgreSQL/Supabase runtime

Executed on a fresh local Supabase stack using the canonical CLI workspace:

```sh
supabase test db --workdir backend
```

Result:

- 6 pgTAP files
- 259 tests
- All tests successful
- Result: PASS

The suite covers migration history, final schema, foreign keys, indexes, triggers, RLS, RPC grants, SECURITY DEFINER search paths, Owner/Admin RBAC, member device binding, OTP-authenticated portal behavior, IDOR resistance, task submission, approvals/reversals, ratings, bonuses, invites, evaluations, custom fields, and push subscriptions.

### Static checks

The restored branch contains the existing frontend security and identity regression suites. These must remain green in CI; this report does not claim a fresh frontend run in this continuation unless the corresponding command output is recorded by CI.

### Remote read-only observations

The prior audit recorded a fresh remote project with zero application tables and zero applied migrations, plus existing Auth accounts. Those observations are context only and were not changed during this phase. Re-run read-only checks immediately before any approved remote dry-run.

## GitHub Actions gate

`.github/workflows/database-runtime-validation.yml` starts a disposable Ubuntu Supabase stack, validates all 24 migration files, applies the migrations locally, runs `supabase test db`, and always stops the stack. It has no production credentials and no `--remote` flag.

## Approved remote runbook

1. Review the Draft PR and confirm the target project reference.
2. Run a read-only migration inventory against the remote project:
   ```sh
   supabase migration list --workdir backend --remote=cbuiwgrmsmsidyjhzvla
   ```
3. Run the CLI dry-run using the approved operator environment:
   ```sh
   supabase db push --workdir backend --dry-run
   ```
4. Stop for explicit approval before any real `supabase db push`.
5. After an approved push, run the Owner bootstrap in preview mode with the exact project pin, then use `--execute` only after reviewing the preview.
6. Verify the final migration history, one Owner row, eight permission keys, and `whatsapp_settings.enabled = false`.

Never use the old REST `/rest/v1/rpc/exec_sql` path, a frontend key, a remote reset, or an Auth-user creation command for migration application.

## Remaining conditions

- Official release signing remains separate from this database phase.
- The remote database has not been modified.
- The Draft PR must be reviewed and approved before remote application.
