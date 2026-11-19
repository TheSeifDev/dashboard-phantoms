# PHANTOMS existing-account migration and dry-run plan

## Status and boundary

This is an operator-reviewed, read-only migration plan. It does not inventory, classify, invite, enroll, reset, delete, release, or modify live accounts. The included inventory script is bounded and runs in a `READ ONLY` transaction. No production inventory or external connector is authorized by this document.

The plan preserves existing member IDs, Auth UUIDs, membership relationships, Admin identities, and passwords. It never infers identity ownership from matching email alone. A normalized email is a comparison field and a duplicate detector; it is not an association proof.

The source migration is `20261116234800_member_password_auth.sql`. The current service-owned binding table is the only durable member/Auth association used by member password access. It enforces one member per Auth UUID, one Auth UUID per member, and one normalized binding email. The migration does not populate that table from existing email matches.

## Admin link flows and existing-account boundary

The Admin UI now distinguishes three purposes. For a **new member**, the Admin issues a `join` link without a `member_id` or manual Auth UUID and may optionally leave the email blank. The recipient always enters their own email, profile, and password. For an email-unbound link, the first valid redemption normalizes and binds the recipient's email under the shared registration lock before any Auth write; an existing member/Auth identity or another active invite for that address is rejected without consuming the link. Successful redemption creates an inactive member pending Admin review and does not open the portal. The app does not send an email-verification message, so an Admin must independently verify the member's identity and supplied contact email before activation. A pre-approval login attempt is cleared after the status check and does not leave a persistent app session. A status-only authenticated RPC reports the review state without exposing member/profile identifiers. The Admin must separately review and activate the membership.

For an **existing member**, `enroll` is for setting a first password after the normal exact-identity and password-state checks. `reset` is a distinct password-only link for the currently bound identity; neither the UI nor the server accepts a profile update through reset. The Admin copies/shares links out-of-band; the application does not send SMTP invitation mail. These flows never adopt an Auth identity based on matching email alone. The Admin client and HTTP issue endpoint both reject caller-supplied Auth UUID/evidence fields. If a legacy Auth user exists for the member's email but has no exact `member_auth_bindings` row, normal issuance is denied; do not enter an Auth UUID or infer ownership from the email. A separately reviewed exact-identity association must be established outside the invitation endpoint before normal issuance.

## Ten independent inventory states

The classifications intentionally overlap. A row can be disabled and passworded, or reserved and otherwise ready, while still being denied. “Eligible” is never inferred from a single boolean.

### 1. Existing PHANTOMS member with an exact Auth binding

Preserve the member ID and exact Auth UUID. Compare the binding’s normalized email to both the member’s canonical normalized email and the exact Auth row. Check current member status, Auth confirmation, boolean password readiness, provider, banned/deleted/SSO state, duplicate counts, Admin overlap, and active invitation state.

An exact binding with a current established password uses normal member password login. An exact binding with no established password can be reviewed for a purpose-appropriate enrollment credential only when all other checks pass. If continuity or password history is unknown, stop for review.

### 2. Existing PHANTOMS member without an Auth binding

Preserve the member row and relationships. First check for any Auth identities with the same normalized email, but label those as unassociated email candidates. Do not adopt one. A new Auth identity may be created only through the approved invitation flow for the exact active member after an authorized Admin review confirms there is no conflicting identity or duplicate.

Only the server-side invitation path can accept purpose/member selection and derive role/metadata. It resolves the expected Auth UUID from a pre-existing exact binding; it never accepts a caller-supplied UUID/evidence and never falls back to updating a different user. A collision or uncertain Auth response remains quarantined.

### 3. Unconfirmed existing Auth identity

Unconfirmed status is not proof of passwordlessness or membership. Review the exact Auth UUID, exact member relationship, current password boolean, active member status, provider, disabled/deleted/banned state, duplicate identities, Admin overlap, and audit history.

If separately approved as an exact existing-member association and current password is absent, an `enroll` credential can authorize one first-password operation on that same UUID. The operation must preserve the UUID and explicitly confirm only in the authorized Auth write. An unconfirmed identity with an established password is not initial enrollment.

### 4. Confirmed passwordless Auth identity

Confirmation alone does not authorize association. Review the exact existing UUID and exact evidence for member continuity. If the identity is already exactly bound to the active member and has no password, an approved enrollment operation may establish the first password on that UUID. If it is not bound, matching email is only a candidate and requires separately reviewed evidence.

A password that appears before the authorized operation blocks automatic overwrite. Do not create a replacement account.

### 5. Existing identity with an established password

Treat `has_password = true` as a boolean current-state fact; never expose or copy the encrypted hash. Do not issue normal enrollment for an established password. Member recovery uses a distinct `reset` purpose, exact existing binding, exact Auth UUID, expiration, revocation, and single use.

A reset never creates an Auth identity, changes membership, sends a temporary password, or changes Admin recovery. If a reset write outcome is uncertain, preserve the reservation and escalate; never retry the password mutation.

### 6. Disabled or revoked member

A member whose `work_status` is not `active` is denied issuance, reservation, enrollment, reset completion, member access, and device authorization. An already issued invitation is not a reactivation credential. Preserve existing Auth IDs, passwords, member rows, and relationships.

Reactivation is a separate administrative decision. After a separately approved reactivation, perform a fresh exact review. Do not reuse an uncertain reservation.

### 7. Auth identity without a PHANTOMS member association

An Auth identity with no exact `member_auth_bindings` row is unassociated, even if its email equals a member’s email. Deny the normal public member flow. Never adopt the first email match, and never let a browser choose the member ID or Auth UUID.

A privileged reviewer may separately document an exact identity-to-existing-member association with evidence outside the member-password issue endpoint. That attestation is not an automated proof; the normal active, unique, non-Admin, password-state, and invitation checks still apply. The endpoint rejects `expectedAuthUserId` and `associationEvidence` even for an Admin.

### 8. Admin identity that also has a Member association

The current implementation intentionally excludes an Auth identity present in `public.admin_accounts` from member password provisioning and completion, even when a member binding exists. This protects Admin/Member session and privilege isolation. Do not relax this exclusion to clear an inventory row or make an enrollment succeed.

Admin permissions are dynamic: an Owner is allowed by role; an Admin requires `permissions ->> 'members' = 'true'`, and the Auth row must not be deleted or banned. A stale JWT claim or matching email cannot replace the current database check.

### 9. Duplicate or ambiguous identity mapping

Quarantine any duplicate case-insensitive Auth email, duplicate/contradictory binding, binding email mismatch, Auth UUID mismatch, member email conflict, or contradictory marker. Do not resolve ambiguity with `LIMIT 1`, “first row,” email ownership, or a new account.

Preserve every exact UUID and all audit actions. Escalate with a bounded redacted report and require separately approved engineering proof before any repair.

### 10. Reserved or review-required enrollment

`reserved` and `review_required` are denied states, including for a member that previously had a ready password. A reservation has no automatic timeout, release, retry, or competing invitation. The trigger marker must be checked against the exact UUID, current Auth state, member binding, and audit sequence, but a verified marker does not authorize a browser or generic operator completion action.

A missing marker, wrong marker, missing Auth row, timeout, client disconnect, Edge termination, failed completion, or audit failure is an ambiguous cross-service outcome. Preserve the row and escalate.

## Safe dry-run procedure

1. Select the exact member ID or exact Auth UUID through an authorized administrative process. Never start with a broad email adoption rule.
2. Run `backend/scripts/member-password-inventory.sql` with bounded `*_limit` and named `*_offset` values. Keep the transaction read-only.
3. Review the member-centric result, Auth-centric result, and invitation/reconciliation result together. Do not decide from one result set.
4. Compare exact UUIDs and normalized emails. Record mismatches as findings, not as correction instructions.
5. Inspect the safe audit action sequence without selecting `member_password_audit.details`.
6. Apply the decision matrix in the operator runbook. Reserved/review/ambiguous cases remain denied.
7. Save only redacted fields and exact IDs needed for a human review. Never save hashes, tokens, raw metadata, or password material.
8. Obtain a separate approval for any credential issuance or reset. The dry run itself never writes.
9. If any result is unknown, contradictory, or missing, escalate rather than retrying or deleting.

## Executed populated dry-run migration report — 2026-11-17

The bounded local dry run succeeded. It supersedes the earlier unexecuted planning skeleton and is recorded in `/home/ubuntu/phantoms-password-completion/operator-dry-run-final-result.md`. The run used `/home/ubuntu/phantoms-password-completion/runtime/native-workdir`, Supabase CLI 3.1.0, PostgreSQL 17.11, loopback-only native credentials loaded through environment variables, and no database URL argument. No production/remote inventory, Git operation, stack restart, function restart, or Auth-owned table creation occurred.

The run recreated the ten account-state categories plus marker/quarantine fixtures under an exclusively owned temporary tag, ran the authoritative inventory body with member/Auth/invitation page limits of 1000 and offsets of 0, and rolled back all fixture writes. The inventory body had zero DML/DDL statements by static scan and emitted bounded projections/classifications only. Since fixture DML preceded inventory reads in the same rollback-scoped transaction, observed settings were `default_transaction_read_only=on` and `transaction_read_only=off`; this caveat is explicit and is not a claim of a standalone physical read-only transaction.

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

Categories overlap intentionally. The duplicate case contributes to both passwordless and ambiguous classifications. The exact binding table remains the only ownership proof; matching email is never enough.

### Marker/quarantine result

| Reconciliation condition | Count | Safe disposition |
|---|---:|---|
| Marker missing across reserved/review rows | 2 | Deny and escalate |
| Marker missing on a reserved row | 1 | Preserve reservation; no retry/release |
| Marker verified against current exact Auth row | 2 | Still not browser force-complete; engineering review |
| Marker wrong or Auth missing | 2 | Preserve quarantine |
| Complete with exact binding | 1 | Verify current access separately |
| Review-required quarantine | 1 | Deny; exact-proof escalation |
| Revoked/expired terminal | 0 | Deny; fresh review required |

Reserved and `review_required` operations remain denied. No automatic retry, delete, release, competing invitation, password write, ownership-by-email decision, or browser force-complete action was performed. Cleanup verification returned zero owned members, Auth rows, bindings, invitations, audit rows, and Admin fixture rows. Retained evidence excludes emails, UUIDs, passwords/password hashes, invitation tokens/hashes, access/refresh/session material, keys, raw Auth metadata/errors, request bodies, and audit details.

### Current migration and validation ledger

The Supabase production migration history was verified read-only on 2026-11-19 through version `20261118200500` (remote timestamp `20261118213525`): 24 initialized migrations, the applied Admin/member projection correction, and ten member-password migrations. The local canonical set contains 36 SQL migrations and 12 forward entries; the manifest records the exact remote timestamps. The new `20261119005000_member_password_owner_join_review.sql` is the sole pending Owner-review migration. It and its corresponding Edge/UI changes are local-only and have not been applied or deployed. Applied migration bytes were not changed.

Migration 31 proved GoTrue-compatible only for the exact reserved new-enrollment `INSERT` interim state where GoTrue has not yet exposed confirmation. Fresh completion independently requires a confirmed real password, exact marker UUID, exact member/Auth identity, and no automatic login. Migration 32 restores the bound non-Admin exact-reservation requirement and leaves an Admin/Member overlap as an ordinary Admin Auth operation; it does not relax Member portal exclusion. A reservation remains durable and quarantined when the outcome is uncertain.

After the optional-email migration sync, all 13 native PostgreSQL 17 database pgTAP suites passed **523/523** assertions. The owned inventory integration observed 1002 rows for each of members, Auth identities, and invitations through disjoint pages at offsets 0, 500, and 1000, then verified exact cleanup. The SQL-only concurrency runner passed **5/5** checks on local PG17, including two unbound links racing for the same email and an unbound reservation racing an Admin member insert; its fabricated Auth rows are not GoTrue proof. Separately, real local GoTrue/Auth/API/Edge HTTP acceptance passed **10/10** stages with cleanup, including email-free issuance, member-supplied email, conflict without consumption, pending review, and one-use redemption. The Auth browser workflow passed **12/12** stages with exact cleanup. The dashboard browser suite passed both missing- and invalid-VAPID modes; its 390 px Admin modal test issued `email: null`, checked one-time/24-hour-or-3-day expiry copy and personal/generic WhatsApp message copy, and verified the name was not sent in the issue payload. Both modes retained deferred zero push requests and exact cleanup. The prior full static baseline was **296/296** TAP tests; this follow-up passed 51/51 controller/projection tests, 72/72 Auth/real-HTTP/migration/workflow safety tests, one mounted component test, and 45/45 security-regression tests; frontend runtime, Push/Auth, member-password tests, Oxlint, production build/typecheck, and secret scan passed. An independent security review's email-only fixture cleanup concern was corrected: both Auth and real-HTTP runners now discover and delete only exact actor/note invitation IDs and marker-derived member/Auth UUIDs. These are disposable local results, not hosted or production validation.

The local Owner-review follow-up was exercised on the disposable native PG17 stack: all 13 database suites passed, and the Dashboard Chromium suite passed both missing- and invalid-VAPID modes with the review-card/explicit-confirmation flow. Evidence validators confirmed exact cleanup and the CI JSON allowlist. These results validate only the local implementation; production does not yet have migration 36 or the Owner review UI/actions.

## Session handling after reset — current disposable proof

The after-guard disposable reset evidence verifies old-password rejection, new-password acceptance, old Member JWT denial, old refresh denial, fresh Member access, old-JWT denial for device/profile calls, and blocked unreserved Member password update. The independent Admin old JWT retained current-members permission and the Admin refresh survived. The supported GoTrue password update revokes Member `auth.sessions`/refresh state; an already signed access JWT can remain cryptographically valid until expiry, which is why the application session gate checks the live session row. This is not a blind global logout and must preserve independent Admin storage/session isolation.

## Recovery and session policy

The Auth Admin API and PostgreSQL completion are not one transaction. A timeout or lost response is ambiguous. Do not automatically retry an Auth password mutation, delete an Auth account to hide a partial result, release a reservation, issue a competing invitation, or let a browser force completion.

Member reset remains Contact Administrator plus an exact `reset` invitation. The disposable after-guard proof records old-password rejection, new-password acceptance, old Member JWT/refresh denial, fresh Member access, old-JWT device/profile denial, blocked unreserved writes, and independent Admin old-JWT/current-members-permission/refresh survival. GoTrue's supported password update revokes Member `auth.sessions`/refresh state; the application gate denies the still-cryptographically-valid old JWT until expiry. Do not call global sign-out blindly: Admin and Member sessions are intentionally isolated.

If a future forward migration adds narrowly scoped reset-session invalidation, it must be reviewed separately and must preserve Admin session isolation. This document does not authorize such a migration.

## Required escalation evidence

A recovery reviewer needs the exact member ID, invitation ID, expected/marker/completed Auth UUIDs, purpose, member status, exact binding result, boolean Auth state, marker comparison, safe audit action sequence, failure boundary, and whether the Auth result was known or ambiguous. The packet must state that no production inventory, Auth mutation, password write, retry, release, delete, or browser force-complete action occurred.

## Current session-policy status

The final disposable after-guard reset evidence verifies old-password rejection, new-password acceptance, old Member JWT denial by the live `auth.sessions` gate, old refresh denial, fresh Member access, old-JWT denial for device/profile calls, blocked unreserved Member password update, and independent Admin old-JWT/current-members-permission/refresh survival. GoTrue's supported password update revokes Member `auth.sessions`/refresh state; an already signed access JWT may remain cryptographically valid until expiry, so the application gate is required. Do not use global sign-out. A future narrowly scoped session change would require separate review and must preserve Admin isolation.

## Gates after local validation

The local database, real-GoTrue HTTP, Auth browser, Dashboard/mobile, inventory, and SQL-only concurrency gates completed with sanitized evidence. The optional-email change was pushed to `main` as `1e2db4d`; on that exact SHA the frontend safeguards/build and Android APK workflows passed. The fresh PG17 runtime workflow passed migration history, pgTAP, inventory, browser/Auth/HTTP steps and exact cleanup, but failed at the first Python concurrency evidence validator, which still expected schema `v1` and three checks while the producer emits `v2` and five. A follow-up corrects that validator and adds a static regression; its exact-SHA Actions result must be checked separately. GitHub had no deployment record for `1e2db4d` when checked; Vercel was not accessed, so automatic publication is unconfirmed. No hosted/production migration or Auth mutation occurred; all 10 member-password forward migrations remain `not_applied` in production until separate approval and a reviewed rollout plan. Before enabling public enrollment, independently verify member identity and supplied email before activation, and verify an upstream trusted-source-IP rate limit/WAF: the limiter table is capped at 10,000 keys and deliberately fails closed when full, so unauthenticated unique rotating email/token inputs can exhaust its capacity (availability risk, not an authentication bypass). The gateway must overwrite inbound forwarding headers with the verified connection source; never trust client-supplied `X-Forwarded-For`/`Forwarded`. The default approved endpoint is only `https://dashboard-phantoms.vercel.app`; any additional origin must be explicit operator configuration, with no automatic preview fallback. Application limits remain 8 email/token attempts, a 15-minute credential window, and 60 Admin attempts; the native CI fixture's `300/min` shared-loopback Auth limit is not a production recommendation.

## WAF/gateway residual guidance

Do not trust client-supplied `X-Forwarded-For`, `Forwarded`, or equivalent headers. The approved WAF/gateway must overwrite inbound forwarding headers with the verified connection source, apply independent per-source limits to enrollment, credential attempts, and administrative actions, return bounded `429` responses, and keep the exact production-origin allowlist. If verified source IP is unavailable, retain the existing durable invitation, normalized-email, credential, and request limits; never weaken invitation checks or use an untrusted header as an identity signal. This deployment control remains a residual and is outside the SQL inventory dry run.


### Owner-review hardening verification — 2026-11-19

Migration `20261119005000_member_password_owner_join_review.sql` was hardened after review and applied to production. Queue/approval require the current normalized Auth email to continue matching the invitation, exact binding, and member. Email mismatches remain visible as blocked review items, with approval disabled in the UI rather than silently dropping them. The queue uses keyset pagination in pages of 100 so older requests remain reachable. Approval locks the Auth and binding rows and rechecks identity after any concurrent Auth email update. The generic member-status guard blocks any transition away from `inactive` for a completed join without an `admin_approved` audit row, including a nullable/intermediate state; only the guarded service-role approval RPC can activate that registration.

After this final hardening, suite 13 passed **97/97** pgTAP assertions on local PG17. The latest migration DDL and suite ran inside one transaction that was rolled back, so no migration-history or fixture changes persisted. The SQL-only concurrency evidence contract v3 passed **6/6** checks, including the Auth-email-update/approval race; its disposable fixtures were exactly cleaned, and the pre-existing local approval function definition was restored and verified afterward. The static migration/workflow suite passed **38/38**, controller/projection tests **56/56**, and Dashboard Chromium E2E passed **1/1** in both missing- and invalid-VAPID variants, including the visible blocked mismatch path. TypeScript, Oxlint, production build, and build-secret audit passed.

A new native runtime could not be created because the Docker host lacks the iptables `raw` table; no global Docker settings were changed. The existing owned local PG17 stack was restarted without resetting its data. The latest database tests are local evidence only and do not replace a clean fresh-stack CI run. Production migration history now records source migration 36 (`member_password_owner_join_review`) as remote version `20261119054418`. The matching Edge function is active (deployment version 2, `verify_jwt=false`, preserving its prior configuration); a production CORS preflight returned 204 with the exact dashboard origin, and a privileged list action without Authorization returned 401 `UNAUTHORIZED`. The dashboard queue source is included in the `main` release; automatic hosted UI publication was not independently verified and Vercel was not accessed.
