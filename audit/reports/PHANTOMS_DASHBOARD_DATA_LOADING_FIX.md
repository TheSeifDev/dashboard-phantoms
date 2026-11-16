# PHANTOMS — full dashboard data loading correction

This extends draft PR #8 on `fix/phantoms-member-projections-wxwo`; it does not create a duplicate fix branch or change merged PR #7. The user permits repository correction and disposable CI only. Production remains at `ca129a2cf231b964f44a2b1b945490906a8a968e`. No production migration, data change, Owner change, merge or Vercel deployment is authorized.

## Read-only live diagnosis

A real UI retry was instrumented through the actual deployed Supabase SDK transport, without recording request headers, tokens or successful record contents. Owner authorization remains valid: `get_admin_access` returns 200 with Owner/admin access. The dashboard's actual requests are:

| Endpoint | Operation/columns | Status/code | Cause |
| --- | --- | --- | --- |
| `/rest/v1/members` | GET `select=*`, `order=full_name.asc` | 403 / 42501 | Wildcard includes protected fields and seven ordinary columns not in the authenticated read allowlist |
| `/rest/v1/tasks` | GET `select=*`, `order=created_at.desc` | 200 | No observed permission failure |
| `/rest/v1/notes` | GET `select=*`, `order=created_at.desc` | 200 | No observed permission failure |
| `/rest/v1/member_custom_fields` | Members-screen GET `select=*`, `order=sort_order.asc,id.asc` | 200 | No observed failure |
| `/rest/v1/member_registration_invites` | Members-screen GET `id,note,expires_at,used_at,is_revoked,created_at` | 200 | No observed failure |
| `/rest/v1/rpc/get_admin_access` | Read-only authorization RPC | 200 | Owner access valid |

The Members and Ranking screens reproduce the same member wildcard failure. Ranking reuses member/note data; member detail receives the member/notes from its parent and additionally reads custom-field definitions. It does not have an extra member-detail joined query or read RPC. Dashboard overview/count/readiness metrics, task status/completion/delay, ranking/performance, device/activity/timeline widgets are local calculations over the three required table results—not separate remote endpoints.

Bounded actual-SDK probes show `members.id` succeeds, while the full 17-field safe projection still fails until the forward grant is approved/applied. Both `session_token` and `push_subscription` independently return 403/42501 and no data. Catalog metadata confirms authenticated reads of exactly ten ordinary member columns, no member table-wide SELECT, and RLS enabled on members/tasks/notes/custom-field/invitation tables.

## Root causes and correction

The previously prepared correction remains unchanged: explicit 17-column administrator member result projections, explicit 16-column compatibility fallbacks, and the one separately registered forward seven-column SELECT grant. All 24 initialization SQL files and their manifest remain byte-identical to main. There is no second forward migration and no additional/broad permission grant.

A second frontend defect explains the screenshots' misleading zero cards: `DashboardPage` previously computed metrics from `query.data ?? []` and rendered widgets even when a required query failed. The correction uses a pure query-state resolver and renders analytics only when all three query results are successful arrays. Any query error, including stale data, remains a retryable blocking alert. Pending data has a distinct loading state, and missing/malformed successful data is an error. Only genuinely successful empty arrays produce empty/zero analytics. Layout, theme tokens and widget design are unchanged.

## Tests and screenshot provenance

Six dashboard-state regressions cover each required dependency failure, pending data, genuine empty arrays, missing/non-array responses, and non-mutating real metric calculations. The existing seven projection regressions and all prior pgTAP/security tests remain included.

The new browser runner uses only a fresh Docker-local Supabase API at `127.0.0.1:54321` and database at `127.0.0.1:54322`. It refuses remote links, an existing frontend `.env.local`, non-loopback configuration and production credential environment names before writes. It reads local CLI status privately and keeps the local service key runner-only. Reserved-domain Auth/member/task/note/custom-field/invitation fixtures are created only in the disposable database, then cleaned up. Browser clients use the local public key and authenticate normally.

Real Chromium tests verify authorized dashboard requests, nonzero member/readiness/task/bonus/activity data, member list/detail and related task/note/ranking views, safe projection create/update/upsert and fresh read persistence/cleanup, secret-column denials, anonymous denial and outsider RLS filtering. Deliberate local 403 interception is used only for failure-state regression of each of members/tasks/notes, followed by recovery against the real local API. Successful data/screenshots are not mocked. Genuine empty-state rendering is verified after scoped local fixture deletion.

Four corrected dashboard screenshots are captured in dark/light themes at desktop 1440×1000 and mobile 390×844, with horizontal-overflow checks. Only synthetic screenshots and sanitized request metadata are uploaded; no storage-state file, session headers, video or trace artifact is delivered. CI logs/results and screenshots will be reported from the exact final commit after completion, not inferred from static checks.

Because production modification is explicitly prohibited, these are **disposable-stack corrected screenshots**, not evidence that the unchanged live production alert has disappeared. Native branch deployment guards and the disabled legacy deployment workflow remain intact.

## Remaining production gate

Do not merge PR #8, deploy it, apply the prepared grant, replay old SQL or create production test records as part of this task. Separate explicit production approval and subsequent real authenticated application persistence verification remain necessary before declaring PHANTOMS operationally ready. WhatsApp, AI and Push remain deferred.

## CI infrastructure correction

The first extended PR run stopped before migrations because the default local database port was occupied. The parallel push run successfully initialized all25 files and passed pgTAP, but then stopped before browser fixtures because the locked Supabase SDK requires Node22+ native WebSocket while the database job used Node20. Neither failure involved production.

The disposable database job now uses Node22 and a per-run `phantoms-disposable-<GitHub run ID>` container namespace. A CI-only configurator checks four available loopback ports and updates only the ephemeral checkout's local API/database/shadow configuration; committed Supabase configuration and migration SQL are unchanged. Runner and browser verify the actual local status against those exact selected ports. The earlier fixed54321/54322/4173 references describe defaults, not the isolated run ports. Three temporary-directory regressions verify valid configuration, non-CI/credential rejection, and remote-link rejection before writes. Fresh exact-commit CI remains authoritative for final browser results.
