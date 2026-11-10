# PHANTOMS — Phase 2.5: Complete Project Identity & Naming Migration Report

**Date:** November 9, 2026  
**Project:** PHANTOMS Operations & Team Management Platform  
**Target Identity:** PHANTOMS  
**Target Package Scope:** `@phantoms/*`  
**Android Application ID:** `com.phantoms.app`  
**Status:** COMPLETE & VERIFIED  

---

## 1. Executive Summary

Phase 2.5 concludes the multi-phase transformation of the platform from its legacy identity into the unified, production-grade **PHANTOMS** brand and architectural standard.

This phase executed a comprehensive, non-destructive migration across all platform surfaces:
1. **Typography System Migration:** Fully unified typography to the approved brand standard:
   - Arabic: **IBM Plex Sans Arabic** (weights 300..700)
   - English / Brand: **Montserrat** (weights 400..900)
   - Technical / Code: **JetBrains Mono** (weights 400..700)
   - Complete removal of legacy Alexandria and Cairo font configurations from active styling.
2. **Package Metadata Migration:** Standardized workspace package names under the `@phantoms` namespace:
   - `frontend/package.json` -> `@phantoms/frontend`
   - `backend/whatsapp-service/package.json` -> `@phantoms/whatsapp-service`
   - `backend/whatsapp-bridge/package.json` -> `@phantoms/whatsapp-bridge`
3. **Operational Script Renaming:** Renamed all legacy operational scripts and updated all callers, npm scripts, and CI workflows:
   - `PHANTOMS-health-check.mjs` -> `phantoms-health-check.mjs`
   - `PHANTOMS-db-audit.mjs` -> `phantoms-db-audit.mjs`
   - `PHANTOMS-deploy.mjs` -> `phantoms-deploy.mjs`
   - `PHANTOMS-generate-vapid.mjs` -> `phantoms-generate-vapid.mjs`
4. **Resilient LocalStorage Session Migration:** Deployed `storageMigration.ts` ensuring transparent, zero-loss, one-time migration of client-side credentials, device tokens, notification preferences, and custom fields to `phantoms_*` keys while preserving uninterrupted fallback access.
5. **Supabase Functions Dual-Invocation:** Created `backend/supabase/functions/phantoms-ai` with updated CORS origin headers (`admin-phantoms.vercel.app`, `PHANTOMS_ALLOWED_ORIGINS`). Updated frontend AI client (`useAskPhantomsAi`) with automatic failover to `phantoms-ai` for backward compatibility.
6. **External Contract Resilience:** Configured dual-template compatibility for Meta WhatsApp Cloud API (`phantoms_task_assignment` with fallback to `phantoms_task_assignment`).
7. **Automated Audit Verification:** Created and executed `frontend/scripts/audit-legacy-identity.mjs`, proving **0 active user-facing branding violations** across the entire codebase.

---

## 2. Typography System Overhaul

The approved typography system from the PHANTOMS Brand Identity System V1.0 was implemented strictly:

### Font Allocation
| Role | Approved Font | Fallback Stack | CSS Custom Property |
|---|---|---|---|
| Arabic Typography | **IBM Plex Sans Arabic** | `system-ui, -apple-system, sans-serif` | `--font-arabic` |
| English & Brand Display | **Montserrat** | `system-ui, -apple-system, sans-serif` | `--font-english` |
| Technical / Monospace | **JetBrains Mono** | `ui-monospace, SFMono-Regular, monospace` | `--font-mono` |

### Key Source Updates
1. `frontend/index.html`:
   - Updated Google Fonts `<link rel="stylesheet">` to load `IBM+Plex+Sans+Arabic:wght@300;400;500;600;700`, `Montserrat:ital,wght@0,400..900`, and `JetBrains+Mono:wght@400;500;700`.
   - Removed legacy `Alexandria` and `Cairo` font imports.
2. `frontend/src/styles/tokens.css`:
   - Set `--font-arabic: "IBM Plex Sans Arabic", system-ui, -apple-system, sans-serif;`.
   - Set `--font-english: "Montserrat", system-ui, -apple-system, sans-serif;`.
   - Set `--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;`.
3. `frontend/src/features/dashboard/DashboardPage.tsx` & `frontend/src/components/brand/BrandWordmark.tsx`:
   - Removed all hardcoded inline references to `Alexandria` and `Cairo`.
   - Bound typography directly to standard CSS variable tokens.

---

## 3. Package & Script Identity Migration

### Package Scopes
All package definitions were refactored to `@phantoms/*`:
- `@phantoms/frontend` (v0.0.0, private)
- `@phantoms/whatsapp-service` (v1.0.0, private)
- `@phantoms/whatsapp-bridge` (v1.0.0, private)

All `package-lock.json` dependency roots and lockfile descriptors were synchronized cleanly without dependency disruptions.

### Operational CLI Scripts
Using `git mv`, all operational utility scripts were renamed:
- `frontend/scripts/phantoms-health-check.mjs`:
  - Updated health check banners to `PHANTOMS Health Check`.
  - Updated branding integrity tests to verify `branding/phantoms-mark.png` and `branding/phantoms-mark-192.png`.
  - Validates edge function slug availability (`phantoms-ai`).
- `frontend/scripts/phantoms-db-audit.mjs`:
  - Updated console titles to `فانتومز (PHANTOMS) — مراجعة قاعدة البيانات`.
  - Updated RPC lookup tests to use `@phantoms.org` domain.
- `frontend/scripts/phantoms-deploy.mjs`:
  - Updated deploy orchestration banners and invocations of `phantoms-health-check.mjs`.
- `frontend/scripts/phantoms-generate-vapid.mjs`:
  - Updated instructional headers and environment variable examples.
- Updated npm run scripts in `frontend/package.json`:
  - `npm run health` -> `node scripts/phantoms-health-check.mjs`
  - `npm run db:audit` -> `node scripts/phantoms-db-audit.mjs`
  - `npm run deploy` -> `node scripts/phantoms-deploy.mjs`
  - `npm run vapid:gen` -> `node scripts/phantoms-generate-vapid.mjs`
  - `npm run audit:identity` -> `node scripts/audit-legacy-identity.mjs`

### CI/CD Workflow Alignment
- `.github/workflows/deploy.yml`: Updated workflow name to `PHANTOMS Production Deployment`, invokes `npm run health` (`phantoms-health-check.mjs`), and checks official brand assets.
- `.github/workflows/build-apk.yml`: Updated workflow job name to `Build PHANTOMS Android APK`.

---

## 4. LocalStorage & Session Migration Architecture

To avoid invalidating existing sessions, active logins, or device push tokens for existing members or administrators, a resilient client-side migration engine was implemented in `frontend/src/lib/storageMigration.ts`.

### Migration Logic
1. **Automated On-Startup Run:** Invoked in `frontend/src/main.tsx` prior to application bootstrap.
2. **Safe Copy-Before-Delete:** Reads the legacy key, writes the value to the new `phantoms_*` key, verifies that reading the new key matches the written value, and only then deletes the legacy key.
3. **Storage Quota Protection:** Wrapped in `try/catch`. If `localStorage.setItem` throws (e.g. quota exceeded or storage disabled), the legacy key is left intact.
4. **Dynamic Key Discovery:** Dynamically detects and migrates member-prefixed keys matching:
   - `phantoms_notifications_v2_<id>` -> `phantoms_notifications_v2_<id>`
   - `phantoms_notif_snapshot_v2_<id>` -> `phantoms_notif_snapshot_v2_<id>`
   - `phantoms_apk_notif_enabled_<id>` -> `phantoms_apk_notif_enabled_<id>`
   - `phantoms_apk_perm_prompted_<id>` -> `phantoms_apk_perm_prompted_<id>`
5. **On-the-Fly Accessor Fallback:** `getMigratedStorageItem(newKey, legacyKey)` checks the new key first; if absent, reads the legacy key, migrates it, and returns the value.

### Key Mapping Matrix
| Legacy Storage Key | Migrated PHANTOMS Key | Surface / Store |
|---|---|---|
| `phantoms_member_session` | `phantoms_member_session` | `frontend/src/store/auth.ts` |
| `phantoms_device_token` | `phantoms_device_token` | `frontend/src/store/auth.ts` |
| `PHANTOMS_ADMIN_remember` | `phantoms_admin_remember` | `frontend/src/lib/supabase/client.ts` |
| `phantoms_member_remember` | `phantoms_member_remember` | `frontend/src/store/auth.ts` |
| `phantoms_notif_sound_enabled` | `phantoms_notif_sound_enabled` | `frontend/src/lib/notifications.ts` |
| `phantoms_push_key_fp` | `phantoms_push_key_fp` | `frontend/src/hooks/usePWA.ts` |
| `phantoms_member_custom_fields_v1` | `phantoms_member_custom_fields_v1` | `frontend/src/features/members/customFieldsApi.ts` |
| `phantoms_notifications_v2_<id>` | `phantoms_notifications_v2_<id>` | `frontend/src/lib/notifications.ts` |
| `phantoms_notif_snapshot_v2_<id>` | `phantoms_notif_snapshot_v2_<id>` | `frontend/src/features/portal/WhatsAppNotificationCenter.tsx` |
| `phantoms_apk_notif_enabled_<id>` | `phantoms_apk_notif_enabled_<id>` | `frontend/src/hooks/usePWA.ts` |
| `phantoms_apk_perm_prompted_<id>` | `phantoms_apk_perm_prompted_<id>` | `frontend/src/hooks/usePWA.ts` |

---

## 5. Supabase Edge Functions & API Dual-Slug Invocation

### Function Provisioning
1. Created `backend/supabase/functions/phantoms-ai/index.ts`:
   - Configured with `PHANTOMS_ALLOWED_ORIGINS` (with `PHANTOMS_ALLOWED_ORIGINS` fallback).
   - Configured with `PHANTOMS_APP_URL` default `https://admin-phantoms.vercel.app`.
   - Dual-engine fallback support (Groq with Gemini failover).
2. Retained `backend/supabase/functions/phantoms-ai/index.ts` for legacy backend endpoints and offline/cached clients.
3. Updated shared Edge Functions (`push-notify`, `admin-delete-account`, `admin-invite`, `whatsapp-tasks`):
   - Added `PHANTOMS_ALLOWED_ORIGINS` support.
   - Added `https://admin-phantoms.vercel.app` to permitted default origin list.

### Frontend Client Resilience
In `frontend/src/features/ai-assistant/api.ts`:
- Primary invocation target is `phantoms-ai`.
- In case of a 404 or network routing failure to `phantoms-ai` (e.g. during edge propagation), the client automatically re-attempts with `phantoms-ai`.
- Exported primary hook: `useAskPhantomsAi` (with `useAskPHANTOMSAi` alias maintained for complete backwards compatibility).

---

## 6. Android Application Identity Verification

Inspected all mobile native assets and configurations:
- `android/app/build.gradle`:
  - `namespace "com.phantoms.app"`
  - `applicationId "com.phantoms.app"`
- `android/app/src/main/res/values/strings.xml`:
  - `app_name: "PHANTOMS"`
  - `title_activity_main: "PHANTOMS"`
  - `package_name: "com.phantoms.app"`
- `capacitor.config.json`:
  - `appId: "com.phantoms.app"`
  - `appName: "PHANTOMS"`
- Package structure: `android/app/src/main/java/com/phantoms/app/MainActivity.java`.
- Active `com.phantoms.app` references in Android native source: **0**.

---

## 7. Delivery Checklist

- [x] Official typography implemented (`IBM Plex Sans Arabic`, `Montserrat`, `JetBrains Mono`).
- [x] Package definitions migrated to `@phantoms/*`.
- [x] CLI scripts renamed to `phantoms-*` and integrated into npm scripts.
- [x] LocalStorage migration implemented with 6/6 unit tests passing.
- [x] Service Worker push events broadcast dual `PHANTOMS_*` and `PHANTOMS_*` events.
- [x] Edge function `phantoms-ai` deployed with dual-slug frontend caller.
- [x] Meta WhatsApp template configured for `phantoms_task_assignment` with fallback.
- [x] Automated identity audit script authored and reporting 0 user-facing branding violations.
- [x] All test suites passing (tsc, lint, ux:guard, brand, security, xlsx, runtime, storage, build).
- [x] Three audit reports generated in `audit/reports/`.

