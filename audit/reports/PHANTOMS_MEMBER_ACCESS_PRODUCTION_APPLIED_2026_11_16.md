# PHANTOMS — Applied Member Access Correction

Verified on 16 November 2026. This records the executed correction, not a request to replay it.

## Production identity and application

- Supabase project: `wxwoaputugxwysuhcebv` (PHANTOMS, `eu-west-2`, `ACTIVE_HEALTHY`).
- The original 24 migration history entries were present before application; no forward correction entry was present.
- The single reviewed forward migration was applied through Supabase MCP using name `20261116061247_admin_member_column_access`.
- Actual generated remote version: `20261116100646`.
- Post-application inventory: the unchanged original 24 entries plus exactly one forward correction, 25 total.
- Canonical repository file: `backend/supabase/migrations/20261116100646_admin_member_column_access.sql`.
- Original source file: `backend/supabase/migrations/20261116061247_admin_member_column_access.sql`.
- SQL SHA-256, unchanged: `c3ec586e6fc50bc31733fcffbb8e3903eb87fe2979ee2fc8906f725168916be6`.

```sql
GRANT SELECT (
  team_notes,
  residence,
  work_conditions,
  phone,
  gender,
  bonus_infinite,
  custom_fields
) ON public.members TO authenticated;
```

No initialization SQL was replayed. No migration repair, reset or db push was executed.

## Independently verified security

Live catalog results were compared before and after application. Exactly these seven SELECT column grants were added; the authenticated readable column set grew from 10 to the intended 17 ordinary columns. Both `session_token` and `push_subscription` remain unreadable. There is no table-level SELECT grant on members for authenticated, anon or PUBLIC.

The four members RLS policy definitions, roles, commands and predicates are identical before and after. RLS remains enabled. All existing table-level privileges and INSERT/UPDATE/REFERENCES column grants are unchanged. The Owner count remains one and the Owner identity and permission object were not modified.

The initialization manifest and all 24 initialized SQL files were verified byte-identical to merged main. The forward SQL was renamed only; all SQL bytes and its checksum are preserved. The forward manifest now records applied status and the real remote timestamp, with original source filename/version provenance.

## Existing native production deployment

The authenticated canonical Vercel dashboard verifies project `prj_asWszTi8ZDh5qmb1LLOJyrOnS5Qa`, team `team_IY8rPeLSYKbbwndzqqIiDBWc`, Git repository `TheSeifDev/dashboard-phantoms`, production branch `main`, and deployment `dpl_6pjyHNhUUXXr9vosZtC2fLjjrA9u`.

Production already serves commit `471096128577c4e2ccc28d2fe997870fac3af3f8`, containing merged PR #8, at `https://dashboard-phantoms.vercel.app`. It is READY and was created by native Git. No duplicate deployment was requested.

All non-decrypted environment metadata remains identical to the previously approved configuration updates. The actual deployed SDK was verified to target PHANTOMS and to use its enabled publishable key. The existing Owner session restored after a full reload, and actual Members, Tasks and Notes reads returned HTTP 200 without 42501. Dashboard metrics rendered without an error banner.

## Provenance-only repository boundary

This repository update is on the existing Vercel-disabled branch `fix/phantoms-member-projections-wxwo`. It contains filename/manifest alignment, validator and inventory wording updates, and the disposable pgTAP maximum-version expectation. It must not be treated as another production migration or merged solely to trigger a duplicate deployment.

Operational member/task CRUD acceptance is recorded separately by the executing parent. At this record's creation, member persistence checks were ongoing and task creation was held pending a separately requested narrow Push-deferral guard approval. No Task CRUD success is claimed here.
