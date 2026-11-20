# Web Projects — Read-only database discovery

**Source:** Supabase MCP `list_projects` followed by `list_tables` (`public` schema, verbose), read only.
**Retrieved:** 2026-11-20.
**Project:** PHANTOMS, `wxwoaputugxwysuhcebv`, status `ACTIVE_HEALTHY`, Postgres 17.
**Scope:** No SQL writes, DDL, migration application, or database modifications were made.

## Relevant existing domain

- `public.members` (RLS enabled) is the canonical member identity directory; primary key `id bigint`. Existing member data must be referenced, not copied.
- `public.member_auth_bindings` (RLS enabled) binds existing members to Supabase Auth identities; do not create a separate project auth system.
- `public.admin_accounts` (RLS enabled) holds global `owner`/`admin` accounts and permissions. Treat global program administration separately from project roles.
- `public.teams`, `public.team_memberships`, `public.team_admin_assignments`, and related team tables implement Internal Teams. Web Project memberships must not reuse or mutate these records.
- `public.tasks` (RLS enabled) is the legacy internal/global task domain; `public.notes`, contribution ledger and team-task RPCs are related legacy workflows. New project tasks must use a separate project-owned domain.
- Public tables returned by the inventory all reported RLS enabled. The complete inventory contained no `web_projects`, `web_ideas`, or other Web Projects-specific tables.

## Inventory returned by `list_tables`

`members`, `notes`, `tasks`, `whatsapp_settings`, `admin_emails`, `announcements`, `member_device_sessions`, `admin_accounts`, `member_infinite_bonus_events`, `member_custom_fields`, `member_registration_invites`, `member_evaluations`, `member_auth_bindings`, `member_password_invitations`, `member_password_audit`, `member_password_rate_limits`, `task_contribution_events`, `task_contribution_ledger_config`, `teams`, `team_memberships`, `team_admin_assignments`, `team_access_audit`, `team_member_metrics`, `team_member_custom_field_values`, and `announcement_recipients`.

## Design implications

1. Add a fully namespaced Web Projects schema with explicit composite project-scope keys and project-specific membership/roles.
2. Bind all member participation to `members.id`; bind actors to existing `auth.users` identities where appropriate.
3. Protect every project table with RLS and server-side RPC checks for global project admins, project leads, project members, and viewers.
4. Preserve `public.tasks`, Internal Teams, global role permissions, authentication, and member profile behavior unchanged.
5. Capture ownership, licensing, attribution, PHANTOMS brand/assets permission, and public-showcase consent explicitly; consent must not be inferred.
6. Design local migrations/tests only; do not apply a migration to this shared Supabase project without explicit authorization.
