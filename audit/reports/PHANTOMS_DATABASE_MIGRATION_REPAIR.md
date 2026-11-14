# PHANTOMS — Database Migration Repair Report

**Branch:** `fix/phantoms-database-initialization`
**Base:** `main` (`33d7137`)
**Target Supabase project:** `cbuiwgrmsmsidyjhzvla`
**Current PR:** [#5](https://github.com/TheSeifDev/dashboard-phantoms/pull/5)
**Scope:** repository repair and disposable validation only

## Final verdict

> **READY FOR REMOTE DATABASE DRY-RUN**

This phase does not push, reset, bootstrap, or otherwise mutate the remote Supabase project. Remote application remains a separately approved operation.

## P0 migration-chain repairs

### Duplicate RLS policies

The baseline migration creates the administrative policies for `members`, `notes`, and `tasks` with `public.is_admin()` predicates. Migration 0001 previously recreated the same policy names with `USING (true)` and `WITH CHECK (true)`, causing fresh-install failure `SQLSTATE 42710` and weakening authorization.

The duplicate administrative policy block was removed from `20261112000001_security_hardening.sql`. Its historical anon hardening and Vault protections remain. The later policy transitions in migrations 0008, 0014, 0015, and 0022 remain authoritative and restricted through `public.is_admin()` / `admin_accounts` authorization.

### Administrator email seeds

All hardcoded administrator email inserts were removed from:

- `20261112000000_base_schema.sql`
- `20261112000008_admin_email_rls.sql`
- `20261112000023_phantoms_identity_migration.sql`

`public.admin_emails` remains as a legacy compatibility table but receives no default rows. No placeholder identity can grant administrator access. The Owner is provisioned only by the project-pinned, Auth-backed bootstrap procedure.

### Other migration repairs

- Added the missing baseline `members.team` column required by early historical migrations, then removed it through the intended 0006 lifecycle.
- Fixed migration 0006 by dropping `public.lookup_member_by_email(text)` before recreating it with a changed table-return signature. PostgreSQL cannot change OUT/table return types through `CREATE OR REPLACE FUNCTION`.
- Removed hardcoded Auth identities from migration data.
- Preserved the final `admin_accounts.permissions` JSONB model with exactly eight keys: `dashboard`, `members`, `tasks`, `ranking`, `notes`, `announcements`, `whatsapp`, and `ai_assistant`.
- Disabled missing seed loading in `backend/supabase/config.toml`; no `seed.sql` is shipped and tests create rolled-back fixtures instead.
- WhatsApp remains disabled; no worker, dispatch path, table, or historical data was activated or removed.

## Owner bootstrap safety

`backend/scripts/bootstrap-phantoms-owner.mjs`:

- Requires `PHANTOMS_INITIAL_OWNER_ID`.
- Requires `PHANTOMS_SUPABASE_PROJECT_REF=cbuiwgrmsmsidyjhzvla`.
- Verifies the Supabase URL host matches the approved project reference.
- Refuses publishable/anon keys and requires a server-side key.
- Requires a confirmed Auth user.
- Enforces the single-Owner invariant with an exact owner query.
- Defaults to preview; only `--execute` performs the insertion.
- Uses exactly the eight final permission keys.
- Never executes against the remote project during this task.

## Migration tooling and runtime gate

`frontend/scripts/run-migrations.mjs` is inventory/print-only. Unsupported execution arguments are rejected. Supabase CLI is the only supported application mechanism:

```sh
supabase db push --workdir backend
supabase migration list --workdir backend --remote=cbuiwgrmsmsidyjhzvla
```

`.github/workflows/database-runtime-validation.yml` starts a fresh Ubuntu Supabase stack, validates all 24 migrations, runs all six pgTAP files, and always stops the stack. It contains no production credentials and no remote flag.

The first CI run exposed the duplicate-policy failure described above. The follow-up commit removes that root cause; the post-fix CI run must be treated as the authoritative fresh-runtime result.

## Evidence boundaries

### Local disposable runtime

A prior local disposable run recorded **6 pgTAP files and 259 passing tests** before the newly discovered duplicate-policy and email-seed issues were fixed. Because Docker is unavailable in the current sandbox, the post-fix local runtime cannot be rerun here. Do not treat the prior result as post-fix proof.

### GitHub Actions

The post-fix workflow URL and conclusion must be recorded here after the current branch run completes. No claim is made that all 259 tests passed in GitHub Actions until that run proves it.

### Frontend CI

The local frontend checks passed after the first repair commit:

- Security regression: **45/45**
- Brand suite: **10/10**
- Storage suite: **6/6**
- Production build: **passed**

The GitHub Actions Quality Check and Build jobs remain the authoritative CI results for the current follow-up commit.

### Vercel integration

The Vercel preview failure was caused by running `npx vercel deploy` from `frontend` while the Vercel project root was already configured as `frontend`, producing `frontend/frontend`. Preview and production deploy commands now run from repository root so the configured frontend root is applied exactly once. The actual Vercel Preview result must be recorded from the current PR run; no production deployment was made.

### Remote Supabase

Previous read-only observations recorded a fresh remote project with zero application tables and zero applied migrations, plus existing Auth accounts. These observations were not changed. Re-run read-only checks immediately before any approved remote dry-run.

## Remote runbook after PR approval

1. Review the current PR and confirm the target project reference.
2. Run read-only migration inventory:
   ```sh
   supabase migration list --workdir backend --remote=cbuiwgrmsmsidyjhzvla
   ```
3. Run the CLI dry-run:
   ```sh
   supabase db push --workdir backend --dry-run
   ```
4. Stop for explicit approval before any real `supabase db push`.
5. Run Owner bootstrap in preview mode with the exact project pin, then use `--execute` only after reviewing the preview.
6. Verify migration history, one Owner row, eight permission keys, zero `admin_emails` rows, and `whatsapp_settings.enabled = false`.

Never use a frontend key, remote reset, Auth-user creation command, or the old REST SQL execution path for migration application.

## Safety boundary

No production Supabase mutation, remote SQL mutation, Auth account creation/deletion, Owner promotion, RLS modification, Storage deletion, secret rotation, WhatsApp activation, merge, or production deployment was performed.
