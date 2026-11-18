# PHANTOMS member-password operator runbook

## Scope and non-negotiable boundary

This runbook is for an authorized PHANTOMS operator or separately approved engineering responder handling an existing member-password invitation, enrollment, or reset. It is an inspection and escalation procedure. It is not a production rollout plan, an Auth user-management guide, or a browser recovery feature.

The inventory is deliberately read-only. Run it only against the explicitly selected disposable/local database or an approved read replica. Do not point it at the hosted production project without separate written approval and a reviewed privacy boundary. Never include a service key, password, encrypted password, access token, refresh token, invitation plaintext, token hash, raw Auth metadata, raw request body, or `member_password_audit.details` in an evidence package.

The following actions are prohibited during reconciliation:

- no automatic retry of an Auth password write;
- no release, reset, deletion, or recreation of a reserved invitation or Auth user;
- no competing invitation while an uncertain attempt is reserved or quarantined;
- no browser force-complete action;
- no generic instruction to “run the completion RPC” when a marker or Auth outcome is uncertain;
- no global sign-out to hide a reset problem;
- no ownership decision from a matching email address alone;
- no relaxation of the current Admin/Member overlap exclusion.

A human recovery requires a separately approved engineering change with exact proof of the member ID, Auth UUID, normalized email, current membership status, marker state, and audit sequence. The proof is a prerequisite for a reviewed forward-only repair; it is not permission for an operator to improvise a write.

## Admin-issued member links

The Admin UI issues and copies a one-time link; it does not create a member password on the member's behalf, request a manual Auth UUID, or send email through an application SMTP flow. The operator shares the copied link out-of-band. The invitation secret remains in the URL fragment, not the query or path.

- **New member (`join`):** From Members, choose Add member and generate a registration link. The Admin supplies the invitation email but does not enter the member's profile or password and no `member_id` is supplied. The recipient enters their own profile and password at `/join`. Successful redemption creates the member as inactive and pending Admin review. It does not automatically sign the member into the portal or grant member access. If the member tries to log in before approval, the pending-review check clears the local login session and the portal remains closed until an Admin separately reviews and activates the membership.
- **Existing member, first password (`enroll`):** Select the existing member from the server-populated member list and share the link. The server resolves the existing exact binding or provisions a new identity only through the guarded flow; the operator must not enter an Auth UUID. The HTTP issue endpoint strictly rejects caller-supplied `expectedAuthUserId` and `associationEvidence`; the Admin client exposes neither field. Existing active-status, exact-email, uniqueness, binding, and password-state checks remain mandatory. If an older Auth identity exists for the email but lacks an exact binding, issuance is denied; do not adopt it from an email match or work around the endpoint. A separately reviewed association repair must occur outside this invitation API before normal issuance.
- **Existing member, password reset (`reset`):** Select the existing member and share the reset link. The member sets a password at `/reset`; this path is password-only and does not accept or update profile fields, membership status, or membership relationships. The server rejects profile data for reset at both the Edge controller and SQL boundary.

`get_member_pending_review()` is a narrow, authenticated status check for the currently bound member. It returns status only and exposes no member/profile identifier. Admin approval is a separate decision; consuming a join link is not approval or reactivation.

## Current database contract

The migration `20261116234800_member_password_auth.sql` owns four service tables:

| Object | Current contract |
|---|---|
| `public.member_auth_bindings` | One exact `member_id` to one exact `auth_user_id`; normalized email snapshot; boolean `password_ready`; unique member, Auth UUID, and normalized binding email. RLS enabled; direct `PUBLIC`, `anon`, and `authenticated` table privileges revoked. |
| `public.member_password_invitations` | Purpose `join`, `enroll`, or `reset`; `member_id` may be null only for a `join` invitation. Lifecycle is `pending`, `reserved`, `complete`, `review_required`, `revoked`, or `expired`. Reservations do not automatically expire, release, retry, or become reusable. |
| `public.member_password_audit` | Append-style action records for issued, reserved, completed, review-required, revoked, and expired transitions. Inspect action/time/IDs only; do not select `details`. |
| `public.member_password_rate_limits` | Service-owned durable counters keyed by a SHA-256-shaped key. It is not an operator recovery queue. |

The service-only RPCs are granted to `service_role` and are not operator SQL shortcuts: `member_password_issue_invitation`, `member_password_list_invitations`, `member_password_revoke_invitation`, `member_password_reserve`, `member_password_complete`, `member_password_mark_review_required`, `member_password_identity_by_email`, `member_password_identity_state`, `member_password_check_rate_limit`, and `member_password_service_health`. The portal access function is granted to `authenticated`; member device binding is intentionally available to `anon`/`authenticated` under its own exact-member checks. Direct table access to the service-owned tables is revoked from `PUBLIC`, `anon`, and `authenticated`.

The forward-only self-service extension is `20261118153000_member_password_self_service_join.sql`. It adds the guarded join/pending-review path while keeping reset profileless; its status RPC is granted only to `authenticated` and returns the pending-review status without identifiers.

Admin issuance and revocation are application-mediated and must use a currently authenticated, live Admin/Owner with members-management permission. The database rechecks the actor against `auth.users` and `public.admin_accounts`; an old client role claim, stale UI permission, or email match is not sufficient. An `owner` has the members permission by role. An `admin` must have `permissions ->> 'members' = 'true'`. An Admin identity that also has an exact Member binding remains excluded from member password operations; do not relax this rule.

## Run the bounded inventory

Use a disposable/local connection or a separately approved read replica. The SQL begins a `READ ONLY` transaction, validates all bounds and selected IDs, and fails closed for malformed input. Every result set is paginated with named limit/offset inputs.

```bash
psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --dbname "$LOCAL_READ_ONLY_DB_URL" \
  -v current_operation=all \
  -v member_limit=100 -v member_offset=0 \
  -v auth_limit=100 -v auth_offset=0 \
  -v invitation_limit=100 -v invitation_offset=0 \
  -v selected_member_id='' \
  -v selected_auth_user_id='' \
  -v selected_invitation_id='' \
  -f backend/scripts/member-password-inventory.sql
```

For a focused inspection, use `current_operation=member`, `auth`, or `invitation` and set only the corresponding selected ID. IDs are bound as quoted psql values and validated before query execution. A matching normalized email is reported as an `auth_email_candidate_unbound`; it is never reported as an ownership binding.

The inventory exposes exact member/Auth/invitation UUIDs, normalized emails for comparison, status, timestamps, boolean password/confirmation/provider/disabled state, binding consistency, marker booleans, and the latest audit action. It does not expose password hashes, invitation hashes or plaintext, raw Auth metadata, invitation notes, or audit details.

## Read-only evidence checklist

Capture only the output fields needed for the case. Redact emails if evidence leaves the authorized operator boundary.

### 1. Member and exact binding

```sql
SELECT m.id AS member_id,
       lower(btrim(m.email)) AS normalized_member_email,
       m.work_status,
       b.auth_user_id AS exact_bound_auth_user_id,
       b.normalized_email AS exact_binding_email,
       b.password_ready
FROM public.members AS m
LEFT JOIN public.member_auth_bindings AS b ON b.member_id = m.id
WHERE m.id = :selected_member_id
LIMIT 1;
```

Do not replace `member_id` with an email lookup. If no exact member ID was supplied, stop and obtain the authoritative member selection through the approved administrative process.

### 2. Exact Auth row, boolean state only

```sql
SELECT u.id AS auth_user_id,
       lower(btrim(u.email)) AS normalized_auth_email,
       (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
       (coalesce(u.encrypted_password, '') <> '') AS has_password,
       (u.banned_until IS NOT NULL) AS banned,
       (u.deleted_at IS NOT NULL) AS deleted,
       coalesce(u.is_sso_user, false) AS is_sso_user,
       (coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') AS has_email_provider
FROM auth.users AS u
WHERE u.id = :selected_auth_user_id
LIMIT 1;
```

This query is for a separately supplied exact UUID. Do not print `encrypted_password` or either raw metadata column. A missing row is an Auth-missing outcome, not evidence that a new identity should be created.

### 3. Invitation, marker, and lifecycle fields

```sql
SELECT i.id AS invitation_id,
       i.member_id,
       i.normalized_email,
       i.purpose,
       i.status,
       i.expected_auth_user_id,
       i.auth_user_id AS completed_auth_user_id,
       i.claim_id,
       i.claimed_at,
       i.auth_write_completed_at,
       i.auth_write_user_id AS marker_auth_user_id,
       i.completed_at,
       i.review_required_at,
       i.revoked_at,
       i.expired_at,
       i.used_at
FROM public.member_password_invitations AS i
WHERE i.id = :selected_invitation_id
LIMIT 1;
```

Never select `token_hash`, `note`, or a raw request/token value for evidence. A marker is not accepted merely because its timestamp is non-null: compare its exact UUID to the expected/completed UUID and independently inspect the current Auth row and member binding.

### 4. Safe audit check

```sql
SELECT a.id,
       a.invitation_id,
       a.member_id,
       a.action,
       a.actor_user_id,
       a.created_at
FROM public.member_password_audit AS a
WHERE a.invitation_id = :selected_invitation_id
ORDER BY a.created_at, a.id
LIMIT 100 OFFSET 0;
```

Do not select `a.details`. The action sequence should be consistent with the lifecycle: `issued`, optionally `reserved`, then exactly one terminal `completed`, `review_required`, `revoked`, or `expired` transition. An absent or inconsistent audit sequence is an escalation signal.

### 5. Current Admin authorization check

Use an exact actor UUID from the authenticated server-side request, not an email-derived substitute:

```sql
SELECT u.id AS actor_user_id,
       (u.deleted_at IS NULL) AS auth_not_deleted,
       (u.banned_until IS NULL) AS auth_not_banned,
       a.role,
       (a.role = 'owner'
        OR (a.role = 'admin' AND coalesce(a.permissions ->> 'members', 'false') = 'true')) AS members_management_allowed
FROM auth.users AS u
LEFT JOIN public.admin_accounts AS a ON a.user_id = u.id
WHERE u.id = :selected_auth_user_id
LIMIT 1;
```

If the row is missing, deleted, banned, not an Admin/Owner, or lacks members permission, stop. Do not use an old token or stale UI state as an authorization substitute.

## State and decision matrix

| Observed state | Access disposition | Operator decision |
|---|---|---|
| `pending` with exact active member, no conflict, and no existing password | Not a member session; invitation is not yet reserved | A currently authorized Admin may use the normal issuance path after exact review. This runbook does not issue it. |
| `reserved`, marker missing | Deny; outcome is ambiguous | Do not retry, release, revoke, delete, create, or update. Escalate to separately approved engineering reconciliation. |
| `reserved`, marker verified and exact current Auth row exists | Still deny until completion is independently proven | Do not call completion from a browser or as a generic operator action. Preserve reservation and escalate for reviewed proof/recovery. |
| `reserved`, marker UUID wrong, Auth row missing, wrong email, wrong expected UUID, or stale state | Deny; quarantine | Preserve all IDs and audit records. Escalate. Never overwrite the marker or substitute another Auth identity. |
| `review_required` | Deny, including a previously ready reset member | Quarantine. No retry/release/force-complete. Human recovery requires exact proof and a separate engineering approval. |
| `complete` with exact binding, current active member, confirmed usable Auth user, and password boolean true | Candidate for normal current access checks | Verify the exact UUID/email/member/status/device path. Do not assume a historical completion proves a current session is valid. |
| `complete` with binding drift, Auth missing, disabled member, Admin overlap, or current password/confirmation failure | Deny | Escalate; do not repair by creating a duplicate or deleting the old identity. |
| `revoked` or `expired` | Deny | Terminal record. A new credential requires a fresh authorized review after confirming no active reserved/review attempt. Never reuse its token material. |
| disabled/revoked member | Deny issuance, reservation, reset, access, and device authorization | Reactivation is a separate decision. Do not use a password credential as reactivation. |
| unassociated Auth identity or email-only candidate | Deny normal member flow | Do not adopt based on email. Exact member-to-UUID association requires separate review and evidence. |
| duplicate/ambiguous Auth or binding state | Deny | Stop and escalate; preserve every exact UUID. Do not select the first row or use `LIMIT 1` as a resolution. |
| Admin/Member overlap | Deny member-password operation | This exclusion is intentional. Do not relax it to make an inventory or flow pass. |

## Cross-service recovery procedure

1. Record the case ID, exact `member_id`, exact `invitation_id`, exact expected/marker/completed Auth UUIDs, operation purpose, and UTC observation time. Do not record credentials.
2. Run the inventory with bounded pagination and the safe queries above in a read-only transaction.
3. Confirm the member row, canonical normalized email, active/disabled status, exact binding, and duplicate counts.
4. Confirm the exact Auth row’s existence and boolean state. Never infer Auth ownership from email alone.
5. Confirm invitation status, claim, marker, expected UUID, and current Auth UUID. A timestamp without exact UUID and current-state proof is insufficient.
6. Confirm audit actions/timestamps/actor UUIDs without exposing `details`.
7. Confirm the actor permission only if an Admin issuance/revocation event is being reviewed; do not grant or change permission during reconciliation.
8. Apply the decision matrix. If the state is reserved, review-required, ambiguous, or any cross-service outcome is unknown, preserve it and escalate.
9. If the outcome is complete and exact, perform only the normal verified login/access checks. Do not mutate the account as part of observation.
10. Record blocked actions and missing evidence explicitly. A missing query result is not a pass.

The Auth Admin API call and PostgreSQL completion are not one ACID transaction. A timeout, client disconnect, Edge termination, trigger marker mismatch, or completion failure is an ambiguous outcome. The safe disposition is denial plus preserved reservation/quarantine, not a retry or cleanup deletion.

## Password reset and sessions

Member recovery remains Contact Administrator plus a distinct exact-member-bound `reset` invitation. Reset must target the existing binding and exact Auth UUID; it never creates a user, sends a temporary password, or changes Admin recovery.

The disposable after-guard reset evidence verifies old-password rejection, new-password acceptance, old Member JWT denial by the live `auth.sessions` gate, old refresh denial, fresh Member access, old-JWT denial for device/profile calls, and blocked unreserved Member password update. The independent Admin old JWT retained current-members permission and the Admin refresh survived. GoTrue's supported password update revokes the Member `auth.sessions`/refresh state; the signed access JWT may remain cryptographically valid until expiry, so application session gating is required. Do not call global sign-out: Admin and Member clients have independent storage/session boundaries, and invalidating one must not invalidate the other. The complete local HTTP/Auth-browser/Dashboard results and remaining merge/production gates are summarized at the end of this runbook.

## Escalation packet

Provide the owning engineering/security reviewer with:

- bounded inventory output with secrets and raw metadata absent;
- exact IDs and normalized email comparison result;
- member status and exact binding result;
- Auth existence and boolean password/confirmation/provider/banned/deleted state;
- invitation status/purpose/claim/marker fields;
- safe audit action sequence;
- Admin permission result when relevant;
- the exact failure boundary and whether the Auth response was known, unknown, or contradictory;
- an explicit statement that no retry, release, delete, browser force-complete, or production write was performed.

Engineering must supply exact proof and a reviewed forward-only change before any human recovery write. If exact proof is unavailable, leave the attempt denied and quarantined.

## Populated native dry-run evidence — 2026-11-17

An actual populated dry run was executed on 2026-11-17 against the disposable native stack from `/home/ubuntu/phantoms-password-completion/runtime/native-workdir`, using Supabase CLI 3.1.0 and PostgreSQL 17.11. The final sanitized report is `/home/ubuntu/phantoms-password-completion/operator-dry-run-final-result.md`. The connection used loopback PG environment variables loaded in-process from the local native stack; no database URL was passed as a command-line argument. No production/remote, Git, hosted, stack-restart, or function-restart operation was used.

That earlier run recreated exclusively owned disposable fixtures, executed the authoritative `backend/scripts/member-password-inventory.sql` body with `member_limit=1000`, `auth_limit=1000`, and `invitation_limit=1000`, all offsets `0`, and rolled back the complete fixture transaction. Static inspection found zero DML/DDL in the inventory body. Because fixture writes preceded inventory reads in the same rollback-scoped transaction, PostgreSQL reported `default_transaction_read_only=on` but `transaction_read_only=off`; this was a limitation of that historical fixture setup, not a claim of physical/server-level read-only execution. The later 1002-row pagination integration executes each inventory read in a read-only transaction and verifies exact fixture cleanup, as summarized under current final validation below.

### Sanitized classification counts

| Classification | Count |
|---|---:|
| Members in populated fixture page | 12 |
| Member with exact Auth binding | 7 |
| Member without exact Auth binding | 5 |
| Unconfirmed exact/bound identity | 1 |
| Confirmed passwordless exact/bound identity | 2 |
| Passworded exact/bound identity | 4 |
| Disabled/revoked member | 1 |
| Unassociated Auth identity | 3 |
| Admin/Member overlap excluded | 1 |
| Duplicate/ambiguous member mapping | 1 |
| Duplicate normalized Auth identities | 2 |
| Reserved/review-required operation | 5 |

Categories intentionally overlap: the duplicate case contributes to both passwordless and ambiguous classifications. Matching normalized email remains a comparison/candidate signal only; it never establishes ownership. The Admin/Member overlap remains excluded from member password operations and member access.

### Quarantine/marker decision counts

| Decision condition | Count | Safe disposition |
|---|---:|---|
| Marker missing across reserved/review rows | 2 | Deny and escalate |
| Marker missing on a reserved row | 1 | Preserve reservation; no retry/release |
| Marker verified against current exact Auth row | 2 | Still not browser force-complete; engineering review |
| Marker wrong or Auth missing | 2 | Preserve quarantine |
| Complete with exact binding | 1 | Verify current access separately |
| Review-required quarantine | 1 | Deny; exact-proof escalation |
| Revoked/expired terminal | 0 | Deny; fresh review required |

Reserved and `review_required` rows remain denied. No retry, delete, release, competing invitation, password write, ownership-by-email decision, or browser force-complete action was performed or authorized. Cleanup verification returned zero owned members, Auth rows, bindings, invitations, audit rows, and Admin fixture rows after rollback. Evidence retained only sanitized counts/classifications; passwords, password hashes, plaintext/token hashes, access/refresh/session material, raw Auth metadata/errors, and audit details were excluded.

### Historical validation status for the 2026-11-17 dry run (superseded below)

- At the time of that earlier dry run, the local ledger had 32 migrations: 24 historical migrations plus 8 forward entries; 7 password entries were pending and one older forward entry was already applied. No applied migration bytes were changed.
- At that time, after migration 32, all 11 native PostgreSQL 17 suites passed **435/435** assertions. This historical PG17 result was superseded by the final 12-suite/453-assertion run recorded below; neither result is hosted/production validation.
- The SQL-only concurrency checks associated with that earlier run used fabricated PostgreSQL Auth fixture rows and were not GoTrue proof. The later final SQL-only run passed 3/3 checks on the current local PG17 stack; real GoTrue behavior is verified separately below.
- A separate targeted GoTrue reservation diagnostic passed **5/5** with cleanup. It was not the full acceptance suite; the later complete local HTTP run passed all 10 stages. Any passwordless local SQL fixture manipulation described in the archived diagnostic applied only to exact disposable fixture UUIDs and is never a real-account procedure.
- The partial HTTP evidence from that earlier run had stages 1–7 and 9 passing, while stages 8 and 10 were incomplete at that time. Those gaps were resolved in the later 10/10 real HTTP acceptance; do not use the historical partial artifact as current status.

### Reset/session behavior actually verified after guards

The disposable reset scenario verified old-password rejection and new-password acceptance; old Member access JWT was denied by the live `auth.sessions` gate, old Member refresh was denied, fresh Member access worked, and the old Member JWT was denied for device/profile calls. An unreserved Member password update was blocked. The independent Admin old JWT retained current-members permission and Admin refresh survived. The supported password-update path lets GoTrue revoke the Member `auth.sessions`/refresh state; the signed access JWT can remain cryptographically valid until expiry, so the application session gate is required. This is not a global Admin logout and must not be replaced with one. Admin/Member overlap remains excluded from the Member portal while ordinary Admin Auth operations remain available.

### Remaining merge and production gates

- All local disposable gates are complete: PG17 pgTAP, 1002-row-per-result inventory pagination, SQL-only concurrency, full real-GoTrue HTTP, Auth browser, both Dashboard VAPID modes, and mobile Chromium checks. Exact sanitized evidence is retained with the final task deliverables.
- GitHub Actions on the exact feature-branch Draft PR commit remains a merge gate; verify the required checks are green before any merge.
- No hosted/production migration, Auth setting change, deployment, or merge was performed. All 9 member-password forward migrations remain `not_applied` until separate production approval and a reviewed rollout plan.
- Application limits remain 8 attempts per email/token window, 15 minutes for the enrollment credential window, and 60 administrative attempts; these do not solve rotating-input abuse. Native CI fixture Auth limits are `300/min` on the shared loopback setup, and the existing source configuration is unchanged; do not present that fixture setting as a production recommendation.
- The approved endpoint is only `https://dashboard-phantoms.vercel.app` by default. Any additional origin must be supplied explicitly through the operator environment; there is no automatic Vercel preview fallback.
- Before enabling public enrollment in production, verify an upstream trusted-source-IP rate limit/WAF. The limiter table is capped at 10,000 keys and fails closed when full; unauthenticated unique rotating email/token inputs can exhaust that capacity (availability risk, not an authentication bypass). The gateway must overwrite inbound forwarding headers with the verified connection source and apply independent source limits; never trust client-supplied `X-Forwarded-For`/`Forwarded`.

## Source-IP/WAF residual control

The application must never treat a client-supplied `X-Forwarded-For`, `Forwarded`, or equivalent header as an identity or trusted source-IP signal. At the approved gateway/WAF, overwrite inbound forwarding headers with the connection source address, apply independent rate limits to invitation enrollment, credential attempts, and administrative actions, return a bounded `429`, and preserve the exact production-origin allowlist. If the gateway cannot provide a verified source address, retain the durable invitation, normalized-email, credential, and request limits already in the application; do not weaken invitation protections or substitute an untrusted header. This is a deployment residual and is not proven by the SQL inventory dry run.

## Reset-session evidence status

The final disposable after-guard reset evidence verifies old-password rejection, new-password acceptance, old Member JWT denial by the live `auth.sessions` gate, old refresh denial, fresh Member access, old-JWT denial for device/profile calls, blocked unreserved Member password update, and independent Admin old-JWT/current-members-permission/refresh survival. GoTrue's supported password update revokes Member `auth.sessions`/refresh state; an already signed access JWT may remain cryptographically valid until expiry, so the application gate is required. Do not use global sign-out. The complete local real HTTP evidence is 10/10; GitHub CI and production deployment controls remain separate gates.

## Current final validation status — 2026-11-18

The final evidence below is from disposable local services and Chromium. It is not evidence of hosted/production state.

- **Migrations/pgTAP:** 34 canonical SQL migrations (24 historical plus 10 forward); all 9 member-password forward migrations remain `not_applied`, and the prior Admin/member projection correction is already applied. The final native PostgreSQL 17 run passed 13 database suites and **503/503** assertions.
- **Operator inventory:** each members/Auth/invitations result contained 1002 owned rows over disjoint pages at offsets 0, 500, and 1000; the query body is SELECT-only with bounded output and exact fixture cleanup. Pagination evidence does not establish bounded full-table scan cost: the duplicate-email aggregates scan broader Auth data, so a production query-plan review remains an operational consideration.
- **Real Auth/Edge:** real local GoTrue/Auth/PostgreSQL 17/Edge HTTP acceptance passed **10/10** stages with exact cleanup, including self-service join/pending review, existing-identity preservation, password-only reset, negative authorization, concurrency, and fault quarantine. The separate real Auth browser workflow passed all **12/12** stages with exact cleanup, including link-only join and pending-review denial. These are not mocks; they used disposable local services.
- **Concurrency:** the PG17 SQL-only runner passed **3/3** checks (single reservation winner, single reset writer, and 12 durable limiter increments) with exact cleanup. Its Auth rows were fabricated fixtures; this gate is not GoTrue proof.
- **Push/dashboard/mobile:** missing- and invalid-VAPID Chromium variants both passed with exact cleanup and zero push attempts while deferred. Each mode covered 360/390 px in light/dark themes; at 390 px, the Admin modal also verified link display/copy and join/enroll/reset selection using a non-writing mocked Edge response (no invitation was created). Horizontal overflow stayed absent. The Arabic navigation drawer filled the viewport, the DB-persisted long Arabic member name wrapped in the profile modal, and close/Escape worked. Eight final mobile screenshots were reviewed from 360/390 px light/dark drawer/profile cases.
- **Static CI-parity checks:** 296 Node TAP tests passed with 0 failures across migration/runtime, member/Auth, and security/push/brand groups; TypeScript, Playwright-spec typechecks, Oxlint, production build, build-secret scan, and source-secret scan passed. ESLint is not configured in this checkout; Oxlint is the CI lint gate.
- **Remaining gates:** GitHub Actions must pass on the exact Draft PR commit before merge. No production write, hosted migration, or deployment occurred. Before production public enrollment, confirm the gateway/WAF controls above; local tests do not verify trusted source-IP rate limiting or hosted migration state.
