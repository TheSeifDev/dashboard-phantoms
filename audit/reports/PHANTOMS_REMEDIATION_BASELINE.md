# PHANTOMS — Remediation Baseline & Finding Validation Report

**Date:** November 7, 2026  
**Auditor:** Principal Software Engineer, Application Security Engineer & QA Lead  
**Target Codebase:** `C:\projects\phantoms\dashboard`  
**Current Application Identity:** PHANTOMS Management System (v2)  
**Future Target Identity:** PHANTOMS  
**Node.js Version:** `v24.19.0`  
**npm Version:** `12.2.1`  
**OS Platform:** Windows (win32 x64)

---

## 1. Executive Summary

This baseline validation establishes the technical truth of the codebase prior to implementing any remediation changes. Every command was executed in the actual workspace with exact working directories, command lines, exit codes, and standard outputs captured.

### Command Execution Summary

| Check / Domain | Working Directory | Command Executed | Exit Code | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend TypeScript** | `frontend` | `npx tsc --noEmit` | **0** | PASSED | 0 type errors detected |
| **Frontend Lint** | `frontend` | `npm run lint` (`oxlint`) | **0** | PASSED | 0 errors, 2 minor spread warnings |
| **Frontend Build** | `frontend` | `npm run build` | **0** | PASSED | Built in 981ms + 34ms (PWA warning) |
| **Security Regression Tests** | `frontend` | `node --test scripts/security-regression.mjs` | **1** | **FAILED** | 38 passed, 7 failed (4 test assertions) |
| **WhatsApp Service Build** | `backend/whatsapp-service` | `npm run build` | **0** | PASSED | Clean TypeScript build |
| **WhatsApp Service Tests** | `backend/whatsapp-service` | `npm test` | **0** | PASSED | 20 passed, 0 failed |
| **WhatsApp Bridge Build** | `backend/whatsapp-bridge` | `npm run build` | **0** | PASSED | Clean TypeScript build |
| **WhatsApp Bridge Tests** | `backend/whatsapp-bridge` | `npm test` | **0** | PASSED | 2 passed, 0 failed |
| **Frontend Dependencies** | `frontend` | `npm audit` | **1** | VULNERABLE | 11 vulnerabilities (3 low, 5 mod, 3 high) |
| **Service Dependencies** | `backend/whatsapp-service` | `npm audit` | **1** | VULNERABLE | 2 vulnerabilities (1 mod, 1 high) |
| **Bridge Dependencies** | `backend/whatsapp-bridge` | `npm audit` | **1** | VULNERABLE | 2 vulnerabilities (1 low, 1 high) |

---

## 2. Command Baselines & Technical Evidence

### 2.1. Frontend TypeScript Compilation
- **Command:** `cmd.exe /c "cd frontend && npx tsc --noEmit"`
- **Exit Code:** `0`
- **Output:**
  ```text
  npm notice run phantoms-v2@0.0.0 npx
  npm notice run tsc --noEmit
  ```
- **Conclusion:** TypeScript compilation completes cleanly. However, static inspection reveals extensive use of `as any` casts to circumvent missing database types in `src/types/db.ts` for custom fields and evaluations.

### 2.2. Frontend Linting (Oxlint)
- **Command:** `cmd.exe /c "cd frontend && npm run lint"`
- **Exit Code:** `0`
- **Output:**
  ```text
  ! unicorn(no-useless-fallback-in-spread): Empty fallbacks in spreads are unnecessary
     ,-[src/features/members/MembersPage.tsx:147:24]
 147 |       custom_fields: { ...(member.custom_fields ?? {}) },
  ! unicorn(no-useless-fallback-in-spread): Empty fallbacks in spreads are unnecessary
     ,-[src/features/members/MemberEditor.tsx:87:23]
  87 |   const nextMap = { ...(value.custom_fields ?? {}) };
  Found 2 warnings and 0 errors.
  Finished in 42ms on 133 files with 96 rules using 12 threads.
  ```

### 2.3. Frontend Production Build
- **Command:** `cmd.exe /c "cd frontend && npm run build"`
- **Exit Code:** `0`
- **Output:**
  ```text
  vite v8.3.1 building client environment for production...
  ✓ 3503 modules transformed.
  ✓ built in 981ms
  PWA v1.3.0
  WARN  inlineDynamicImports option is deprecated, please use codeSplitting: false instead.
  ✓ built in 34ms
  precache 71 entries (1993.15 KiB)
  ```
- **Observation:** Build succeeds, but Rollup emits a deprecation warning regarding `inlineDynamicImports` in `frontend/vite.config.ts`.

### 2.4. Security Regression Tests (`scripts/security-regression.mjs`)
- **Command:** `cmd.exe /c "cd frontend && node --test scripts/security-regression.mjs"`
- **Exit Code:** `1`
- **Results:** 45 tests executed, 38 passed, 7 failed (3 parent test suites + 4 leaf assertion failures):
  1. `session_token is never anon-readable > migration 0009 grants anon columns without session_token`
     - *Cause:* Regex `/GRANT SELECT \(id, created_at, email, full_name, bio, device/` failed because `0009_member_device_binding.sql` executed `REVOKE ALL ON public.members FROM PUBLIC, anon;` (completely removing direct SELECT, which is stricter than column grants).
  2. `task tracking updates are device-bound server-side > migration revokes anon direct UPDATE on tasks`
     - *Cause:* Regex `/REVOKE ALL ON public\.tasks FROM anon/` failed because the SQL specifies `REVOKE ALL ON public.tasks FROM PUBLIC, anon;`.
  3. `edge functions and bridge enforce auth > phantoms-ai: no wildcard CORS, POST-only, admin fallback to is_admin()`
     - *Cause:* Regex expects `allowedOrigins.includes(origin)` and `rpc('is_admin')`, but `phantoms-ai/index.ts` uses `allowedOrigins.has(origin)` (Set) and `rpc('has_admin_permission', { p_permission: 'ai_assistant' })`.
  4. `edge functions and bridge enforce auth > push-notify: origin allowlist enforced`
     - *Cause:* Regex expects `allowedOrigins.includes(origin)`, but `push-notify/index.ts` uses `allowedOrigins.has(origin)`.

### 2.5. Backend WhatsApp Services
- **whatsapp-service:**
  - Build: Exited 0
  - Tests: Exited 0 (`20 passed, 0 failed`)
- **whatsapp-bridge:**
  - Build: Exited 0
  - Tests: Exited 0 (`2 passed, 0 failed`)

### 2.6. Dependency Vulnerability Audit (`npm audit`)
- **`frontend` (11 vulnerabilities):**
  - `xlsx` (*): High severity (Prototype Pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9) — no upstream fix.
  - `vite` (8.3.0 - 8.3.2): High severity (GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw).
  - `source-map-js` (1.0.0 - 1.2.1): High severity event loop DoS (GHSA-68fv-2mgg-jv7q).
  - `deepmerge`, `glob`, `minimatch`, `fast-uri`, `serialize-javascript`: Moderate/low severity transitive dependencies.
- **`backend/whatsapp-service` (2 vulnerabilities):**
  - `body-parser` (<1.20.9): High severity DoS via trailing compressed bytes (GHSA-27r3-jxmh-p828).
  - `qs` (6.7.0 - 6.16.0): Moderate severity uncaught TypeError DoS (GHSA-6pq8-jhm2-2vcw).
- **`backend/whatsapp-bridge` (2 vulnerabilities):**
  - `xlsx` (*): High severity (Prototype Pollution & ReDoS).
  - `esbuild` (0.27.3 - 0.28.0): Low severity dev server arbitrary file read on Windows.

---

## 3. Independent Finding Validation Matrix

| Finding ID | Title | Previous Severity | Code Inspection Evidence | Baseline Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-CRIT-01** | Hardcoded Owner UUID (`8ce17aae-...`) | **CRITICAL** | Found in `0014`, `0015`, `0019` migrations, `admin-delete-account`, `router/index.tsx`, `AdminLoginPage.tsx` | **CONFIRMED** |
| **SEC-CRIT-02** | Passwordless Member Account Spoofing | **CRITICAL** | `lookup_member_by_email` in `0013_member_device_sessions.sql` and `LoginPage.tsx` allows anonymous arbitrary email lookup & device binding | **CONFIRMED** |
| **SEC-HIGH-01** | Incomplete `.gitignore` (Secret Leak Risk) | **HIGH** | `.gitignore` only ignores `backend/whatsapp-service/.env.local`, missing root `.env`, `frontend/.env`, etc. | **CONFIRMED** |
| **SEC-HIGH-02** | Vulnerable `xlsx` (SheetJS) Dependency | **HIGH** | `xlsx@^0.18.5` in frontend & bridge contains unpatched Prototype Pollution & ReDoS | **CONFIRMED** |
| **SEC-HIGH-03** | AI Prompt Injection via Raw Context | **HIGH** | `backend/supabase/functions/phantoms-ai/index.ts` interpolates context without XML delimiters or untrusted data boundaries | **CONFIRMED** |
| **BUG-01** | AI Conversation History Dropped | **HIGH** | `useAiConversation.ts` omits history parameter; Gemini branch in `phantoms-ai/index.ts` ignores history | **CONFIRMED** |
| **BUG-02** | AI Action Name Matching Collision / IDOR | **HIGH** | `useAiConversation.ts` uses `.includes(name)` and first-name matching, creating risk of modifying/deleting unintended members | **CONFIRMED** |
| **BUG-03** | Member Deletion Timer Canceled on Unmount | **MEDIUM** | In `MembersPage.tsx`, state changes or unmounts cancel pending deletions silently | **CONFIRMED** |
| **BUG-CI-01** | Security Regression Failure in CI/CD | **HIGH** | `deploy.yml` fails at step `npm run test:security` due to brittle regexes on SQL and Set methods | **CONFIRMED** |
| **DEBT-01** | Member Evaluations Stored in Fake Tasks | **MEDIUM** | Uses carrier prefix `[[PHANTOMS_EVAL]]` inside `tasks` table before migration 0021 was created | **CONFIRMED** |
| **DEBT-02** | Custom Fields Stored in `team_notes` | **MEDIUM** | Carrier prefix `[[PHANTOMS_CF]]` used in `team_notes` before migration 0020 introduced `custom_fields` column | **CONFIRMED** |
| **DEBT-03** | Obsolete `backend/patch.sql` | **HIGH** | Running `patch.sql` reverts `lookup_member_by_email` to obsolete single-device schema, breaking migration 0013 | **CONFIRMED** |
| **DEBT-04** | `run-migrations.mjs` Missing Migrations | **MEDIUM** | Script only lists up to `0020_member_custom_fields.sql`, omitting `0021_member_evaluations.sql` | **CONFIRMED** |
| **BUILD-01** | Vite PWA `inlineDynamicImports` Deprecation | **LOW** | Emits rollup warning in production build | **CONFIRMED** |
| **APK-01** | `build-apk.yml` Deploys Debug APK as Release | **MEDIUM** | Workflow runs `./gradlew assembleDebug` and uploads debug APK to GitHub Releases | **CONFIRMED** |

---

## 4. Remediation Plan & Execution Sequence

1. **Phase 1: Critical Security Remediation**
   - Author forward-only migration `0022_dynamic_system_ownership.sql` to decouple system ownership from static UUIDs and query `public.admin_accounts` dynamically.
   - Refactor `admin-delete-account/index.ts` edge function and frontend `router/index.tsx` / `AdminLoginPage.tsx`.
   - Implement hardened, verified member session authentication and restrict anonymous token binding.
2. **Phase 2: Dependency & Secret Hardening**
   - Update `.gitignore` with comprehensive `.env*` coverage.
   - Perform repository secret scan and generate `PHANTOMS_SECRET_REVIEW.md`.
   - Replace vulnerable `xlsx` with `exceljs`, preserving Arabic column parsing, `safeCell` formula injection defense, and duplicate prevention.
   - Update vulnerable server dependencies (`body-parser`, `qs`).
3. **Phase 3: CI/CD & Regression Test Stabilization**
   - Update `frontend/scripts/security-regression.mjs` to test true security invariants without brittle string regexes.
   - Verify 100% pass rate in local test runner.
4. **Phase 4: AI Security & Action Safety**
   - Enforce XML context boundaries and prompt injection defenses in `phantoms-ai/index.ts`.
   - Restore multi-turn conversation history for both Groq and Gemini.
   - Require exact member ID matching for destructive AI actions in `useAiConversation.ts`.
5. **Phase 5: Technical Debt & Database Maintenance**
   - Quarantine `backend/patch.sql`.
   - Update `run-migrations.mjs` to include `0021` and `0022`.
   - Enhance `src/types/db.ts` to provide full type coverage for dynamic custom fields and evaluations.
6. **Phase 6: Frontend Bugs & Build Quality**
   - Fix deletion timer lifecycle in `MembersPage.tsx`.
   - Update `vite.config.ts` to eliminate PWA Rollup deprecation warning.
7. **Phase 7: Android CI/CD Build Hardening**
   - Correct `build-apk.yml` to clearly distinguish debug APK artifacts from signed release distribution.

