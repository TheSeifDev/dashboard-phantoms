# PHANTOMS — Database Readiness Audit & Owner Account Verification

**Date:** 2026-11-12  
**Auditor:** Principal PostgreSQL Database Administrator & Supabase Security Engineer  
**Repository:** `TheSeifDev/dashboard-phantoms` (`C:\projects\phantoms\dashboard`)  
**Target Supabase Project:** `cbuiwgrmsmsidyjhzvla` (`dashboard-phantoms`)  
**Audit Scope:** Pre-flight Verification, Schema Inspection, Migration Analysis & Owner Authorization  
**Verdict:** `BLOCKED — MIGRATION ISSUES`

---

## 1. Executive Summary

A comprehensive forensic audit of the remote Supabase project `cbuiwgrmsmsidyjhzvla` and the repository migration chain (`0000` through `0023`) was executed.

Key findings:
1. **Target Project Identity Verified:** The linked Supabase project is confirmed as `cbuiwgrmsmsidyjhzvla` (`dashboard-phantoms`, hosted in `eu-west-2`, running PostgreSQL `17.11.0.018`).
2. **Remote Database State:** The remote database is **uninitialized**. `supabase_migrations.schema_migrations` contains **0 applied migrations**. Zero user/application tables exist in `public`.
3. **Owner Account Verified in Auth:** An initial administrator account exists in Supabase Auth:
   - **UUID:** `0fb919fc-1936-49c8-bc0a-b4616217b493`
   - **Email:** `se***@gmail.com`
   - **Created At:** `2026-11-11T22:31:07Z`
   - **Email Confirmed:** `true`
4. **Owner Authorization Status:**
   `AUTH ACCOUNT EXISTS — DATABASE OWNER AUTHORIZATION NOT YET INITIALIZED`
   Because `public.admin_accounts` has not been created on the remote project, this account is not yet linked or authorized as `owner`.
5. **Critical Blockers in Migration Sequence:** The current migration sequence cannot execute on a fresh database:
   - **Blocker 1 (0001 & 0003 Column Failure):** `0000_base_schema.sql` creates `members` without a `team` column. `0001_security_hardening.sql` attempts `GRANT SELECT (..., team, ...) ON members` and `0003` attempts `SELECT ... m.team ...`, causing an immediate PostgreSQL error: `column "team" of relation "members" does not exist`.
   - **Blocker 2 (0014 Foreign Key Violation):** `0014_admin_access_control.sql` attempts to insert hardcoded legacy UUID `'8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid` into `admin_accounts(user_id)`. Because that user does not exist in `auth.users`, it triggers an immediate foreign key constraint violation.
   - **Blocker 3 (Owner Bootstrap Disconnect):** The newly created confirmed administrator account (`0fb919fc-1936-49c8-bc0a-b4616217b493`) is never inserted into `admin_accounts` during the migration chain.
   - **Blocker 4 (Missing Supabase CLI Configuration):** The repository lacks `supabase/config.toml`, and migrations reside in `backend/migrations/` rather than `supabase/migrations/`, preventing standard `supabase db push`.

Therefore, the database initialization must be staged and resolved before pushing migrations.

---

## 2. Phase 1 — Project Identity & Connection Verification

The remote target was verified across multiple independent configuration sources:
* **Linked Project File:** `backend/supabase/.temp/linked-project.json`
  ```json
  {
    "ref": "cbuiwgrmsmsidyjhzvla",
    "name": "phantoms team",
    "organization_id": "ekzkpsybbkalzgsnjtkq",
    "organization_slug": "ekzkpsybbkalzgsnjtkq"
  }
  ```
* **Frontend Runtime Environment:** `frontend/.env` and `frontend/.env.production`
  - `VITE_SUPABASE_URL`: `https://cbuiwgrmsmsidyjhzvla.supabase.co`
* **Supabase CLI Project List:**
  - ID: `cbuiwgrmsmsidyjhzvla`
  - Name: `dashboard-phantoms`
  - Status: `ACTIVE_HEALTHY`
  - Host: `db.cbuiwgrmsmsidyjhzvla.supabase.co`
  - Engine: `PostgreSQL 17.11.0.018`
* **Credential Secrecy:** All tokens, keys, and passwords were read in memory without being echoed or written to logs.

---

## 3. Phase 2 — Remote Database Forensic Inspection

Read-only forensic inspection was performed via Supabase CLI and PostgREST endpoints.

### A. Schema & Object Inventory
* `information_schema.tables` in `public`: **0 tables**
* Querying `members`, `tasks`, `admin_accounts`, `whatsapp_settings`: All returned `HTTP 404 (PGRST205: Could not find the table in the schema cache)`.
* Roles present: Standard Supabase infrastructure roles only (`postgres`, `supabase_admin`, `authenticator`, `authenticated`, `anon`, `service_role`, `supabase_auth_admin`, `supabase_storage_admin`).
* Storage buckets and objects: **0 paths / 0 buckets**.

### B. Remote Migration History
* Inspected: `supabase_migrations.schema_migrations`
* Remote Result: `{"migrations":[]}`
* Applied Migrations: **0**
* Pending Migrations: **24** (`0000` through `0023`)

### C. Supabase Auth Account Verification
Querying `auth.users` via the administrative API revealed two registered accounts:
1. **Administrator Candidate:**
   - **UUID:** `0fb919fc-1936-49c8-bc0a-b4616217b493`
   - **Masked Email:** `se***@gmail.com`
   - **Created At:** `2026-11-11T22:31:07.899681Z`
   - **Confirmed At:** `2026-11-11T22:31:07.908962Z`
   - **Role:** `authenticated`
   - **Status:** Active, confirmed, eligible for authentication.
2. **Secondary Account:**
   - **UUID:** `2de73f81-c8ed-46b8-b281-dfcb75b11a00`
   - **Masked Email:** `mt***@gmail.com`
   - **Created At:** `2026-11-11T19:14:43.052362Z`
   - **Email Confirmed:** `false`

### D. Owner Authorization Status
Because `public.admin_accounts` and `get_admin_access()` do not exist yet on the remote database:
```text
AUTH ACCOUNT EXISTS — DATABASE OWNER AUTHORIZATION NOT YET INITIALIZED
```

---

## 4. Phase 3 & 4 — Base Schema & Migration Sequence Audit

### Complete Migration Inventory (24 Files)

| File | Purpose | Prerequisite Objects | Objects Created / Modified | Rollback / Idempotency | Fresh DB Safe? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `0000_base_schema.sql` | Baseline tables, basic RLS, is_admin() | None | `members`, `tasks`, `notes`, `whatsapp_settings`, `admin_emails` | Uses `IF NOT EXISTS` | **YES** |
| `0001_security_hardening.sql` | Tighten RLS, column privileges, trigger | `members`, `tasks`, `notes` | `trg_tasks_guard_anon`, Vault functions | Fails on column `team` | **NO (BLOCKER 1)** |
| `0002_whatsapp_settings.sql` | WhatsApp settings table | None | `whatsapp_settings` (redundant with 0000) | Uses `IF NOT EXISTS` | **YES** |
| `0003_atomic_approval_and_member_lookup.sql` | Atomic task approval & member lookup | `members`, `tasks` | `lookup_member_by_email`, `approve_task_submission` | Fails on `m.team` | **NO (BLOCKER 1)** |
| `0004_push_notifications.sql` | Push notification subscriptions | `members` | Adds `members.push_subscription`, `save_push_subscription` | Idempotent | **YES** |
| `0005_announcements_system.sql` | Announcements table & RPCs | None | `announcements`, 6 RPCs | Idempotent | **YES** |
| `0006_remove_team_concept.sql` | Drops legacy team concept | `members`, `notes` | Drops `members.team`, `notes.team` | Idempotent | **YES** |
| `0007_device_session_token.sql` | Single device session token | `members` | Adds `members.session_token` | Idempotent | **YES** |
| `0008_admin_email_rls.sql` | Admin email list & RLS policies | `admin_emails`, `members`, `tasks`, `notes`, `announcements` | Replaces `is_admin()`, updates policies | Idempotent | **YES** |
| `0009_member_device_binding.sql` | Device-bound member lookup | `members` | `assert_member_device`, updates `lookup_member_by_email` | Idempotent | **YES** |
| `0010_announcement_views.sql` | Announcement view tracking | `announcements` | `mark_announcement_viewed`, `get_announcement_details` | Idempotent | **YES** |
| `0011_rogue_policy_cleanup.sql` | Drop permissive legacy policies | `members`, `notes` | Drops `members_auth`, `notes_auth` | `IF EXISTS` | **YES** |
| `0012_task_bonus_and_deadline_time.sql` | Task bonus points & deadline | `tasks` | Adds `tasks.bonus_points`, updates `approve_task_submission` | Idempotent | **YES** |
| `0013_member_device_sessions.sql` | Multi-device session hashes | `members` | `member_device_sessions`, SHA-256 tokens | Idempotent | **YES** |
| `0014_admin_access_control.sql` | Owner & admin account table | `admin_emails` | `admin_accounts`, single owner index | Fails on hardcoded UUID FK | **NO (BLOCKER 2)** |
| `0015_admin_permissions_and_full_delete.sql` | Granular section permissions | `admin_accounts` | Adds `admin_accounts.permissions`, updates RPCs | References old hardcoded UUID | **CONDITIONAL** |
| `0016_member_infinite_bonus.sql` | Infinite bonus status & audit | `members` | Adds `members.bonus_infinite`, audit table | Idempotent | **YES** |
| `0017_member_bonus_privacy.sql` | Protect member bonus notes | `members`, `notes`, `tasks` | `get_member_tasks`, `get_member_bonus_total` | Idempotent | **YES** |
| `0018_task_approval_reversal_and_ratings.sql` | Approval reversal & ratings | `tasks`, `notes`, `members` | Adds `notes.source_task_id`, updates `approve_task_submission` | Idempotent | **YES** |
| `0019_member_information_and_ratings.sql` | Member info forms (legacy) | `admin_accounts` | Temporary forms (later dropped by 0020) | References old hardcoded UUID | **CONDITIONAL** |
| `0020_member_custom_fields.sql` | Dynamic custom fields & invites | `members` | `member_custom_fields`, `member_invitations` | Drops 0019 objects, idempotent | **YES** |
| `0021_member_evaluations.sql` | Official performance evaluations | `members`, `notes` | `member_evaluations`, `get_member_evaluations` | Idempotent | **YES** |
| `0022_dynamic_system_ownership.sql` | Dynamic system ownership | `admin_accounts`, `members` | Dynamic `is_owner()`, `is_admin()`, device binding hardening | Idempotent | **YES** |
| `0023_phantoms_identity_migration.sql` | PHANTOMS brand & identity | `member_evaluations`, `notes` | Default strings, `admin_add_member_rating` | Idempotent | **YES** |

---

## 5. Detailed Blocker Analysis

### Blocker 1: Missing `team` Column in `0000_base_schema.sql`
* **Fault Mechanism:** In `0000_base_schema.sql`, the `members` table is defined without `team`. However:
  * `0001_security_hardening.sql` (Line 57) executes:
    `GRANT SELECT (..., team, ...) ON public.members TO anon;`
  * `0003_atomic_approval_and_member_lookup.sql` (Line 59) executes:
    `SELECT ... m.team ... FROM public.members m`
* **Result:** PostgreSQL terminates with:
  `ERROR: column "team" of relation "members" does not exist`
* **Root Cause:** `0000_base_schema.sql` was drafted representing the post-migration-0006 state, while migrations `0001` through `0005` still expect `members.team` to exist until `0006_remove_team_concept.sql` explicitly drops it.

### Blocker 2: Hardcoded Legacy UUID Foreign Key Violation in `0014_admin_access_control.sql`
* **Fault Mechanism:** `0014_admin_access_control.sql` (Lines 28-31) attempts to bootstrap the system owner:
  ```sql
  INSERT INTO public.admin_accounts (user_id, role, created_by)
  VALUES ('8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid, 'owner', NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET role = 'owner', created_by = NULL;
  ```
* **Constraint:** `admin_accounts.user_id REFERENCES auth.users (id) ON DELETE CASCADE`.
* **Result:** The user `'8ce17aae-84c1-4c89-a020-8b683a0dbabb'` does not exist in `auth.users` on the target project `cbuiwgrmsmsidyjhzvla`. The transaction immediately fails with:
  `ERROR: insert or update on table "admin_accounts" violates foreign key constraint "admin_accounts_user_id_fkey"`.

### Blocker 3: Owner Bootstrap Disconnect
* The verified confirmed Auth user is `0fb919fc-1936-49c8-bc0a-b4616217b493` (`se***@gmail.com`).
* Even if migration `0014` were bypassed, migration `0022` checks `admin_accounts.role = 'owner'`, but `admin_accounts` will have zero rows. No subsequent migration inserts the actual administrator account.

### Blocker 4: Directory Structure & CLI Linkage
* Supabase CLI commands (`supabase db push`) look for `supabase/config.toml` and migrations in `supabase/migrations/`.
* The repository currently maintains migrations in `backend/migrations/` and functions in `backend/supabase/functions/`.

---

## 6. Security & RLS Assessment

### Table Security Summary

| Table | RLS Enabled | Anon Access | Authenticated (Admin) Access | Service Role Access | Security Assessment |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `members` | **YES** | Revoked (RPC only) | Controlled via `has_admin_permission` | Full | **SECURE** |
| `tasks` | **YES** | Revoked (RPC only) | Controlled via `has_admin_permission('tasks')` | Full | **SECURE** |
| `notes` | **YES** | Revoked (RPC only) | Controlled via `has_admin_permission` | Full | **SECURE** |
| `whatsapp_settings` | **YES** | Revoked | Revoked | Full (Backend service) | **SECURE** |
| `admin_emails` | **YES** | Revoked | Legacy lookup only | Full | **SECURE** |
| `announcements` | **YES** | Revoked (RPC only) | Controlled via `is_admin()` | Full | **SECURE** |
| `member_device_sessions` | **YES** | Revoked | Revoked | Managed via SECURITY DEFINER RPCs | **SECURE** |
| `admin_accounts` | **YES** | Revoked | Owner-only management (`is_owner()`) | Full | **SECURE** |
| `member_infinite_bonus_events`| **YES** | Revoked | Immutable audit trigger | Full | **SECURE** |
| `member_custom_fields` | **YES** | Read active via RPC | Controlled via `has_admin_permission('members')` | Full | **SECURE** |
| `member_invitations` | **YES** | Token validation RPC | Controlled via `has_admin_permission('members')` | Full | **SECURE** |
| `member_evaluations` | **YES** | Device-bound RPC | Controlled via `has_admin_permission` | Full | **SECURE** |

### RPC & SECURITY DEFINER Audit
* **Search Path Hardening:** All RPCs in migrations `0013` through `0023` explicitly declare `SET search_path = ''` or `SET search_path = public`, neutralizing search_path injection attacks.
* **Privilege Escalation:**
  - `admin_add_account` and `admin_update_permissions` require `is_owner()`.
  - Ordinary authenticated users or anon visitors cannot create admin accounts or alter permissions.
* **IDOR / BOLA Protections:**
  - Member tasks and evaluations require device token authentication matching `member_device_sessions` (`assert_member_device`).
  - Tasks cannot be self-approved by members (enforced via database trigger `trg_tasks_guard_anon`).

---

## 7. Feature-to-Database Dependency Matrix

| Feature | Tables Required | RPCs Required | Required Initial Data | Operable Without WhatsApp? |
| :--- | :--- | :--- | :--- | :--- |
| **Admin Login & RBAC** | `admin_accounts` | `get_admin_access`, `is_admin`, `is_owner` | 1 Owner record in `admin_accounts` | **YES** |
| **Member Portal Login** | `members`, `member_device_sessions` | `lookup_member_by_email`, `bind_member_device_session` | Member records | **YES** |
| **Task Management** | `tasks`, `notes` | `approve_task_submission`, `submit_task_status`, `get_member_tasks` | None | **YES** |
| **Announcements** | `announcements` | `get_member_announcements`, `mark_announcement_viewed` | None | **YES** |
| **Rankings & Bonus** | `members`, `notes`, `member_infinite_bonus_events` | `set_member_bonus_infinite`, `get_member_bonus_total` | None | **YES** |
| **Performance Evaluations**| `member_evaluations`, `notes` | `get_member_evaluations`, `admin_add_member_rating` | None | **YES** |
| **Member Custom Fields** | `member_custom_fields` | Form generation RPCs | Optional field definitions | **YES** |
| **Member Invitations** | `member_invitations` | `validate_invitation_token`, `submit_member_registration` | None | **YES** |
| **WhatsApp Integration** | `whatsapp_settings` | None | Row `id=1, enabled=false` | **TEMPORARILY DISABLED** |
| **AI Assistant** | None (Vault / Secrets) | `get_groq_key_from_vault` (Edge Function) | `GROQ_API_KEY` | **YES** |

---

## 8. Simulation & Validation Results

* **Docker / Local Supabase:** Docker is not installed on the Windows execution environment. In accordance with Phase 7 instructions, runtime container tests are labeled as **NOT RUN**.
* **Static SQL & Dependency Analysis:** Completed on all 24 migration files. The static analyzer identified 2 fatal structural flaws (missing column `team` in `0001`/`0003`, and hardcoded UUID foreign key failure in `0014`).

---

## 9. Data Preservation & Backup Checklist

* **Target Database User Data:** 0 rows in application tables.
* **Storage Data:** 0 buckets, 0 objects.
* **Auth Users to Preserve:**
  - `0fb919fc-1936-49c8-bc0a-b4616217b493` (`se***@gmail.com`) — **MUST NOT BE DELETED**. This account represents the confirmed project administrator.

---

## 10. Recommended Remediation & Execution Blueprint

To safely initialize the database and link the Owner account, the following sequence must be prepared:

1. **Option A (Consolidated Clean Baseline — Recommended for Fresh DB):**
   Since the remote database is completely empty (0 migrations applied), rather than executing 24 legacy historical migrations that create and then drop columns/tables (`team`, `member_info_fields`, etc.) and attempt invalid foreign key inserts:
   - Create a clean, unified baseline migration `0000_phantoms_production_schema.sql` that defines the exact final schema (post-0023 state).
   - In the Owner initialization script, dynamically link the existing confirmed Auth user:
     ```sql
     INSERT INTO public.admin_accounts (user_id, role, permissions)
     VALUES ('0fb919fc-1936-49c8-bc0a-b4616217b493'::uuid, 'owner',
       '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true}'::jsonb
     )
     ON CONFLICT (user_id) DO UPDATE SET role = 'owner';
     ```
2. **Option B (Incremental Migration Patch):**
   - Add `team TEXT` to `members` in `0000_base_schema.sql` so that `0001` and `0003` succeed before `0006` drops it.
   - Patch `0014_admin_access_control.sql` to remove the hardcoded insert of `8ce17aae-84c1-4c89-a020-8b683a0dbabb` and replace it with a conditional insert or parameterized bootstrap.
   - Add an initial Owner bootstrap statement linking `0fb919fc-1936-49c8-bc0a-b4616217b493`.

---

## 11. Final Readiness Verdict

```text
BLOCKED — MIGRATION ISSUES
```

**Reason:** Running the current migration files against `cbuiwgrmsmsidyjhzvla` will fail at migration `0001` (missing column `team`) and migration `0014` (foreign key violation on non-existent UUID). The existing confirmed administrator account `0fb919fc-1936-49c8-bc0a-b4616217b493` is verified in Supabase Auth, but cannot be authorized by the current migration chain.

