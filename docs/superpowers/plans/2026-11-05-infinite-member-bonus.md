# Infinite Member Bonus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audited, permission-checked `∞` member bonus that ranks above every numeric balance and is visible in admin and member views.

**Architecture:** Store the active state separately from numeric bonus notes, and mutate it through a transactional Supabase RPC that checks the `ranking` permission and appends an immutable audit event. Admin ranking and dashboard queries read the current member flag; the member portal reads it through a device-verified RPC. A shared comparator keeps ranking behavior consistent.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, React, TypeScript, TanStack Query, Vite.

---

### Task 1: Persist and secure infinite bonus state

**Files:**
- Create: `backend/migrations/0016_member_infinite_bonus.sql`
- Modify: `frontend/scripts/run-migrations.mjs`
- Modify: `frontend/src/types/db.ts`

- [x] Add `members.bonus_infinite BOOLEAN NOT NULL DEFAULT false`.
- [x] Create an append-only event table containing member ID, enable/disable action, trimmed reason, authenticated actor UUID/email, member identity snapshot, and timestamp. Do not cascade-delete audit rows with a member.
- [x] Revoke direct event-table access and block event updates/deletes. Add `set_member_bonus_infinite(member_id, enabled, reason)`: require `has_admin_permission('ranking')`, lock the member row, reject blank/oversized reasons and duplicate state changes, then update the flag and insert the event atomically. Add a trigger so the flag cannot be changed by direct table updates.
- [x] Add a member portal read RPC that calls `assert_member_device(member_id, device_token)` before returning the flag.
- [x] Register migration 0016 after 0015 without altering the existing migration-script edits. Add `bonus_infinite` to `Member`; exclude it from `MemberInsert`/`MemberUpdate` so it can only change via the RPC. Add RPC signatures to `Database`. Allow ranking admins to read numeric bonus notes needed by the ranking page.

### Task 2: Add reasoned controls to member rating

**Files:**
- Create: `frontend/src/features/ranking/api.ts`
- Modify: `frontend/src/features/ranking/BonusAdjustmentModal.tsx`

- [x] Add a `useSetMemberInfiniteBonus` mutation that calls the secure RPC and invalidates `['members']` and the member's portal-state query.
- [x] Add a separate `∞` mode alongside numeric rating. For an inactive member, show an enable action; for an active member, show a manual cancel action. Both actions require a reason and preserve existing numeric-note behavior.
- [x] Surface server permission and duplicate-state errors in the modal; do not change the numeric task bonus flow.

### Task 3: Apply infinite-first ordering and admin displays

**Files:**
- Create: `frontend/src/features/ranking/rankingUtils.ts`
- Modify: `frontend/src/features/ranking/useRanking.ts`
- Modify: `frontend/src/features/ranking/RankingPage.tsx`
- Modify: `frontend/src/features/ranking/RankingTable.tsx`
- Modify: `frontend/src/features/ranking/RankingPodium.tsx`
- Modify: `frontend/src/features/members/MemberProfileModal.tsx`
- Modify: `frontend/src/features/dashboard/metrics.ts`
- Modify: `frontend/src/features/dashboard/DashboardWidgets.tsx`

- [x] Use one comparator: active `∞` members precede finite balances; two active members and equal finite balances use completion rank ascending, then join date descending; finite balances otherwise sort descending.
- [x] Include `∞` members in the “members with bonus” filter, show `∞` in table/podium/profile/dashboard, include them in dashboard leaders even with zero numeric points, and exclude them from the negative-balance list.

### Task 4: Show the state in the member portal

**Files:**
- Modify: `frontend/src/features/portal/useMemberBonus.ts`
- Modify: `frontend/src/features/portal/MemberPortalPage.tsx`
- Modify: `frontend/src/features/portal/MemberHero.tsx`
- Modify: `frontend/src/features/portal/SubmissionSuccessModal.tsx`

- [x] Read the state with the device-verified RPC using the stored device token. Keep numeric bonus calculation unchanged.
- [x] Display `∞` in the member's bonus balance and submission-success total while active; continue saving numeric task bonuses to the existing ledger.

### Task 5: Build and run locally

**Files:**
- No additional files.

- [x] Review the migration SQL and changed-file diff to confirm no existing working-tree edits were overwritten.
- [x] Run `npm run build` from `frontend` (build/typecheck only; no tests added or run).
- [x] Start the Vite dev server on port 5173 and confirm the local page returns HTTP 200. After user approval, apply migration 0016 to the linked Supabase project and verify the flag defaults to false, no audit events were created, anonymous users cannot toggle/read audit data, and authenticated execution is available for the permission-checked toggle RPC.

---

## Self-review

- Spec coverage: separate boolean state; immutable actor/time/reason audit; permission-checked atomic transitions; multiple active members; manual cancel restores the unchanged numeric ledger; infinite-first ordering; ranking, podium, dashboard, profile, and member-portal displays; task numeric bonus behavior unchanged.
- Placeholder scan: no TBD/TODO steps; every listed file and RPC has a concrete responsibility.
- Type consistency: `bonus_infinite` is a member read field, while insert/update types exclude it; only the RPC can mutate it. Portal read uses member ID plus device token and returns a boolean.
- Verification: build and local HTTP availability only; no tests are added or run.
