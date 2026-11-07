# PHANTOMS — Database Migration & Ownership Bootstrap Guide

**Date:** November 8, 2026  
**Author:** Principal Software Engineer & Database Architect  
**Target Codebase:** `C:\projects\phantoms\dashboard`  
**Current Application Identity:** Wasla Tech Management System (v2)  
**Future Target Identity:** PHANTOMS

---

## 1. Executive Summary

This guide outlines the complete database schema evolution, migration order, owner bootstrapping mechanism, and operational rollback procedures for adopting the PHANTOMS management platform.

### Key Architectural Improvements
1. **Dynamic Ownership (Migration 0022):** Eliminated static owner UUID `'8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid`. System ownership is now resolved dynamically through `public.admin_accounts` where `role = 'owner'`.
2. **Hardened Member Authentication:** Closed anonymous account hijacking in `lookup_member_by_email`. Binding new devices now requires email ownership verification (Supabase Auth OTP / Magic Link) or explicit administrator provisioning.
3. **Multi-Device Session Persistence:** Maintained full compatibility with migration 0013's `public.member_device_sessions`, ensuring existing members on already-bound devices experience zero session disruption.
4. **Quarantine of Deprecated Scripts:** `backend/patch.sql` has been neutralized with an active SQL exception block to prevent accidental rollback of security controls.

---

## 2. Complete Migration Inventory (0001 – 0022)

All migrations are sequential, forward-only, and idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, safe conflict handling).

| Sequence | Migration File | Scope & Technical Purpose |
| :---: | :--- | :--- |
| **0001** | `0001_security_hardening.sql` | Locks anon RLS policies; restricts anon to column-level grants; protects Groq Vault keys. |
| **0002** | `0002_whatsapp_settings.sql` | Provisions settings table for WhatsApp Cloud API & bridge credentials. |
| **0003** | `0003_atomic_approval_and_member_lookup.sql` | Atomic task approval transactions; initial `lookup_member_by_email` RPC. |
| **0004** | `0004_push_notifications.sql` | WebPush subscription column and device endpoint registration. |
| **0005** | `0005_announcements_system.sql` | Announcements infrastructure, target audiences, and read receipts. |
| **0006** | `0006_remove_team_concept.sql` | Deprecates siloed teams in favor of unified organization-wide tasks and notes. |
| **0007** | `0007_device_session_token.sql` | Early device token binding in `members.session_token`. |
| **0008** | `0008_admin_email_rls.sql` | Initial admin email access control. |
| **0009** | `0009_member_device_binding.sql` | Complete revocation of direct table access on members/tasks from anon; RPC device guards. |
| **0010** | `0010_announcement_views.sql` | Announcement view tracking and granular read status per member. |
| **0011** | `0011_rogue_policy_cleanup.sql` | Drops legacy wide-open authenticated policies. |
| **0012** | `0012_task_bonus_and_deadline_time.sql` | Per-task bonus point awards and ISO deadline time support. |
| **0013** | `0013_member_device_sessions.sql` | Provisions `member_device_sessions` table with SHA-256 token hashing; 90-day TTL. |
| **0014** | `0014_admin_access_control.sql` | Provisions `admin_accounts` table with unique owner index and permission tracking. |
| **0015** | `0015_admin_permissions_and_full_delete.sql` | Granular section-level permissions and full account deletion support. |
| **0016** | `0016_member_infinite_bonus.sql` | Infinite rank bonus override with audit logging. |
| **0017** | `0017_member_bonus_privacy.sql` | Device-verified bonus point queries; private administrative notes. |
| **0018** | `0018_task_approval_reversal_and_ratings.sql` | Permission-checked approval reversals and administrative ratings. |
| **0019** | `0019_member_information_and_ratings.sql` | Custom onboarding information submission forms and member score calculation. |
| **0020** | `0020_member_custom_fields.sql` | Dynamic custom fields metadata table and JSONB member column integration. |
| **0021** | `0021_member_evaluations.sql` | Formal performance evaluation records (`member_evaluations` table) with grading criteria. |
| **0022** | `0022_dynamic_system_ownership.sql` | **Decouples owner from hardcoded UUID; enforces verified member device binding.** |

---

## 3. Migration 0022 Detailed Specification

### 3.1. Dynamic Ownership Resolution
Migration `0022_dynamic_system_ownership.sql` drops the static UUID check and queries `public.admin_accounts`:

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    WHERE a.user_id = auth.uid()
      AND a.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    WHERE a.user_id = auth.uid()
      AND a.role = 'owner'
  );
$$;
```

### 3.2. Secure Member Device Binding
Anonymous callers cannot create new device sessions arbitrarily. `bind_member_device_session` requires verified authentication:

```sql
CREATE OR REPLACE FUNCTION public.bind_member_device_session(
  p_email TEXT,
  p_device_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
...
  v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF NOT (
    (v_caller_email <> '' AND v_caller_email = pg_catalog.lower(pg_catalog.btrim(p_email)))
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: يلزم التحقق من البريد الإلكتروني عبر رمز الدخول أو تأكيد الإدارة.';
  END IF;
...
```

---

## 4. Safe System Owner Bootstrapping Procedure

### Rules
- **NEVER** automatically designate the first registered user as the system owner.
- **NEVER** expose service-role credentials to frontend applications.
- System ownership must be provisioned through explicit administrative action.

### Procedure for Existing Deployment
Existing environments that already have user `'8ce17aae-84c1-4c89-a020-8b683a0dbabb'` in `admin_accounts` with `role = 'owner'` will continue functioning with zero disruption, because migration 0022 queries `admin_accounts` dynamically.

### Procedure for New / Staging Deployments
When initializing a fresh database:

1. Create the primary administrator account in Supabase Auth (via Supabase Studio / CLI / Auth API).
2. Note the user's `UUID` from `auth.users`.
3. In the Supabase SQL Editor (running as `postgres` or `service_role`), execute:

```sql
-- Designate the official PHANTOMS system owner
INSERT INTO public.admin_accounts (user_id, role, created_at, created_by, permissions)
VALUES (
  'YOUR_NEW_ADMIN_UUID'::uuid,
  'owner',
  now(),
  NULL,
  '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true}'::jsonb
)
ON CONFLICT (user_id) DO UPDATE
SET role = 'owner';
```

4. The owner can now sign in at `/admin/login` and invite additional administrators or manage sections from the UI at `/admin/accounts`.

---

## 5. Migration Execution Runbook

### Pre-requisites
- Local Node.js environment (`>= 20`).
- Valid Supabase project URL and keys in `.env.local` or environment variables.

### Verification Run (Dry-Run / Check)
```bash
cd frontend
node scripts/run-migrations.mjs --check
```
*Output should report all 22 migration files verified.*

### Inspect Migration SQL Statements
```bash
node scripts/run-migrations.mjs --print
```

### Applying Migration 0022
In the Supabase SQL Editor or via Supabase CLI:
```bash
supabase db push
# OR execute backend/migrations/0022_dynamic_system_ownership.sql directly
```

---

## 6. Rollback & Disaster Recovery Plan

If an issue arises after applying Migration 0022:

### Rollback Strategy
1. **Functions are Replaceable:** All modified functions use `CREATE OR REPLACE FUNCTION`. They can be restored without dropping dependent tables.
2. **Table Safety:** Migration 0022 does not drop any table or alter table structures; it only updates PL/pgSQL logic.
3. **To Rollback Ownership Checks:** Execute the previous function definitions from `backend/migrations/0020_member_custom_fields.sql` (lines 379–500).
4. **Member Sessions Intact:** `public.member_device_sessions` is preserved throughout, preventing any session invalidation for active members.

