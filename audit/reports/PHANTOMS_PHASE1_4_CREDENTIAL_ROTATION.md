# PHANTOMS — Phase 1.4: Supabase Secret Rotation Verification Report

**Date:** November 9, 2026  
**Security Lead:** PHANTOMS Platform Security Engineering  
**Project:** PHANTOMS Operations & Team Management Platform  
**Target Identity:** PHANTOMS (`@phantoms/*`, `com.phantoms.app`)  
**Scope:** Supabase Secret Key (`sb_secret_`) Consumer Architecture & Rotation Lifecycle Verification  
**Final Status:** **ROTATION INCOMPLETE — OLD KEY STILL ACTIVE**  

---

## 1. Executive Summary

Phase 1.4 conducts an exhaustive audit of all backend credential consumers and verifies the retirement status of the compromised Supabase Secret Key (`sb_secret_...`) that was identified and removed from Git tracking in Phase 1.3.

### Key Audit Findings
1. **Consumer Architecture Verified:** Audited all 8 backend components (6 Supabase Edge Functions, 2 backend WhatsApp service routes). Confirmed that all consumers initialize via `@supabase/supabase-js` v2 and pass the Secret Key through standard `apikey` and `Authorization: Bearer` headers. All backend implementations natively support the modern `sb_secret_` format.
2. **Zero Direct HTTP Secret Headers:** Verified that zero backend services construct raw HTTP headers with hardcoded secret keys. Database Vault functions (`get_groq_key_from_vault`) enforce `GRANT EXECUTE ... TO service_role;`, which natively recognizes any caller bearing the `service_role` role.
3. **Frontend & Mobile Isolation Confirmed:** Re-verified that `frontend/dist/` and `frontend/android/app/src/main/assets/public/` contain zero private credentials (`npm run audit:build-secrets` exited with code 0).
4. **Live Verification Probe & Status:** A non-destructive authenticated probe was executed against the project endpoint (`https://kwrqbkwubzswgegxafny.supabase.co/rest/v1/`):
   - **Compromised Old Secret Key:** Returned HTTP `200 OK` (Active in Supabase Cloud).
   - **Current Client Publishable Key:** Correctly rejected with HTTP `401 Unauthorized` (`"message":"Secret API key required"`).
   - **Conclusion:** The compromised key has **NOT** yet been revoked or deleted in the Supabase Dashboard by the system administrator. In accordance with strict audit rules, rotation cannot be certified as complete while the old key remains active.

---

## 2. Backend Credential Consumers Inventory

Every component in the repository that consumes elevated Supabase credentials was inspected:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SUPABASE SECRET KEY CONSUMER MAP                     │
├──────────────────────────┬─────────────────────────────┬───────────────┤
│ Consumer Component       │ Variable Name               │ Protocol      │
├──────────────────────────┼─────────────────────────────┼───────────────┤
│ admin-delete-account     │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ admin-invite             │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ phantoms-ai              │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ wasla-ai                 │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ push-notify              │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ whatsapp-tasks           │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ whatsapp-service/diag    │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
│ whatsapp-service/push    │ SUPABASE_SERVICE_ROLE_KEY   │ supabase-js   │
└──────────────────────────┴─────────────────────────────┴───────────────┘
```

### Detailed Component Specifications

#### 1. `backend/supabase/functions/admin-delete-account/index.ts`
* **Purpose:** Deletes administrator auth records via Supabase Auth Admin API.
* **Variable:** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
* **Transmission:** Passed to `createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })`. Sends `apikey` and `Authorization: Bearer <serviceKey>` to `/auth/v1/admin/users/<userId>`.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code. Requires updated secret in Edge runtime.

#### 2. `backend/supabase/functions/admin-invite/index.ts`
* **Purpose:** Dispatches administrator email invitations via `auth.admin.inviteUserByEmail`.
* **Variable:** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
* **Transmission:** Passed to `createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })`.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code. Requires updated secret in Edge runtime.

#### 3. `backend/supabase/functions/phantoms-ai/index.ts` (and `wasla-ai`)
* **Purpose:** Queries Supabase Vault (`get_groq_key_from_vault` RPC) to retrieve LLM API keys.
* **Variable:** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
* **Transmission:** Passed to `createClient(url, serviceKey)`. Invokes PostgreSQL function via `/rest/v1/rpc/get_groq_key_from_vault`. PostgREST validates `service_role` role.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code.

#### 4. `backend/supabase/functions/push-notify/index.ts`
* **Purpose:** Fetches member Web Push subscriptions across team boundaries bypassing RLS.
* **Variable:** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
* **Transmission:** Passed to `createClient(url, serviceKey)`. Queries `members` table for `push_subscription` JSON.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code.

#### 5. `backend/supabase/functions/whatsapp-tasks/index.ts`
* **Purpose:** Reads and updates bot activation state in `whatsapp_settings` table.
* **Variable:** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
* **Transmission:** Passed to `createClient(url, serviceKey)`. PostgREST REST query/mutation on `whatsapp_settings`.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code.

#### 6. `backend/whatsapp-service/src/routes/diagnostics.ts`
* **Purpose:** Validates database connectivity and reads `whatsapp_settings.enabled` flag.
* **Variable:** `process.env.SUPABASE_SERVICE_ROLE_KEY`
* **Transmission:** Passed to `createClient(config.supabaseUrl, serviceKey, { auth: { persistSession: false } })`.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code. Key is provided via server environment variable.

#### 7. `backend/whatsapp-service/src/routes/push.ts`
* **Purpose:** Queries `members` table to retrieve Web Push endpoints and clears expired subscriptions (HTTP 410).
* **Variable:** `process.env.SUPABASE_SERVICE_ROLE_KEY` (with fallback to `SUPABASE_ANON_KEY`)
* **Transmission:** Passed to `createClient(url, key)`.
* **Client Library:** `@supabase/supabase-js` v2.
* **Format Compatibility:** Fully compatible with `sb_secret_` format.
* **Required Changes:** None in code.

#### 8. `backend/whatsapp-bridge` (Verified Non-Consumer)
* **Inspection:** `backend/whatsapp-bridge/src/config.ts` uses `SUPABASE_ANON_KEY` only.
* **Conclusion:** Does not consume or require elevated service role credentials.

#### 9. Database Webhooks & pg_net
* **Inspection:** Scanned `backend/migrations/*.sql` and `backend/supabase_setup.sql`. Zero triggers or functions invoke `pg_net` or external webhooks with hardcoded credentials. All elevated PostgreSQL functions use `SECURITY DEFINER` with explicit `GRANT EXECUTE ... TO service_role`.

---

## 3. Live Credential Retirement Probe

A non-destructive HTTP probe was conducted directly against the project API gateway (`https://kwrqbkwubzswgegxafny.supabase.co/rest/v1/`):

```
Probe Execution Results:
-------------------------------------------------------------------------
Probe Target 1: Compromised Old sb_secret Key
Request Headers: apikey: [REDACTED_OLD_KEY], Authorization: Bearer [REDACTED_OLD_KEY]
HTTP Status    : 200 OK
Active State   : TRUE (Key accepted by Supabase Gateway)

Probe Target 2: Current Client sb_publishable Key
Request Headers: apikey: [REDACTED_PUB_KEY], Authorization: Bearer [REDACTED_PUB_KEY]
HTTP Status    : 401 Unauthorized
Gateway Body   : {"message":"Secret API key required","hint":"Only secret API keys can be used for this endpoint."}
Active State   : Client-only publishable key (Properly restricted)
-------------------------------------------------------------------------
```

### Analysis
* The compromised `sb_secret_` key is **still active** on the remote Supabase project.
* The system administrator has not yet performed the manual revocation in the Supabase Dashboard.
* As required by security protocol, the incident **cannot be closed** until the compromised key returns `HTTP 401 Unauthorized` / `API key not found`.

---

## 4. Verification Test & Scan Matrix

All local codebase, build artifact, and Git integrity checks pass with exact exit code `0`:

| # | Check / Test Suite | Command | Exit Code | Result |
|---|---|---|---|---|
| 1 | Full Secret Scanner | `npm run test:secrets` | `0` | **PASS (0 tracked, 0 outgoing, 0 build leaks)** |
| 2 | Build Artifact Scanner | `npm run audit:build-secrets` | `0` | **PASS (0 leaks in dist or android assets)** |
| 3 | TypeScript Compilation | `npx tsc --noEmit` | `0` | **PASS (0 compilation errors)** |
| 4 | Oxlint Static Analysis | `npm run lint` | `0` | **PASS (0 warnings, 0 errors, 148 files)** |
| 5 | Security Regression Suite | `npm run test:security` | `0` | **PASS (45/45 tests passed)** |
| 6 | Runtime Security Integration | `npm run test:runtime` | `0` | **PASS (8/8 tests passed)** |
| 7 | Brand Transition Tests | `npm run test:brand` | `0` | **PASS (10/10 tests passed)** |
| 8 | Safe XLSX Archive Guard | `npm run test:xlsx` | `0` | **PASS (10/10 tests passed)** |
| 9 | Storage Migration Suite | `npm run test:storage` | `0` | **PASS (6/6 tests passed)** |
| 10 | WhatsApp Service Tests | `npm test` (service) | `0` | **PASS (20/20 tests passed)** |
| 11 | WhatsApp Bridge Tests | `npm test` (bridge) | `0` | **PASS (2/2 tests passed)** |
| 12 | Git Outgoing Range Scan | `git log origin/main..main -S "sb_secret_"` | `0` | **PASS (0 matching commits)** |
| 13 | Untracked Index Verification | `git ls-files frontend/.env.production` | `0` | **PASS (Empty / Untracked)** |

---

## 5. Administrator Action Guide (Required to Close Incident)

To transition this incident to `ROTATION VERIFIED — INCIDENT CLOSED`, the system administrator must execute the following manual sequence:

```
┌────────────────────────────────────────────────────────────────────────┐
│               ADMINISTRATOR KEY ROTATION RUNBOOK                       │
├────────────────────────────────────────────────────────────────────────┤
│ Step 1: Log in to Supabase Dashboard (https://supabase.com/dashboard) │
│ Step 2: Open Project Settings ──> API Configuration                    │
│ Step 3: Under 'Secret Key' (sb_secret_), click 'Generate new key'     │
│ Step 4: Update Backend Service Secrets via Supabase CLI:               │
│         supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<new_key>       │
│ Step 5: Update any server-side deployment envs (Railway / Container)   │
│ Step 6: Verify Admin functions (admin-invite, AI assistant) with new   │
│ Step 7: DELETE / REVOKE the old compromised sb_secret_ key in Supabase │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Final Status Declaration

* **Local Codebase & Git Status:** 100% CLEAN (Zero private secrets in Git, working tree, or production build assets).
* **Remote Supabase Key Status:** Compromised key remains active on `kwrqbkwubzswgegxafny.supabase.co`.
* **Final Formally Certified Status:** **`ROTATION INCOMPLETE — OLD KEY STILL ACTIVE`**

