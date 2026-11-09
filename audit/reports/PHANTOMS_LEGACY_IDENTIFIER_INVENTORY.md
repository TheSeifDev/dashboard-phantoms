# PHANTOMS — Legacy Identifier Inventory & Classification

**Audit Date:** November 9, 2026  
**Auditor:** PHANTOMS Platform Migration & Security Engineering  
**Scope:** Repository-wide scan (`C:\projects\phantoms\dashboard`)  
**Target Identity:** PHANTOMS (`com.phantoms.app`, `@phantoms/*`)  
**Status:** FULLY CLASSIFIED & VERIFIED  

---

## 1. Classification Architecture

To ensure transparent accounting of all code and configuration elements during the identity migration, every legacy term (`wasla`, `Wasla`, `WASLA`, `وصلة`, `وصلة تك`, `com.wasla.app`) detected across the repository has been categorized into one of five distinct architectural tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│               PHANTOMS LEGACY IDENTIFIER TAXONOMY                      │
├────────────────────────────────┬───────────────────────────────────────┤
│ Tier 1: Active User-Facing     │ UI Text, Page Headings, Form Labels    │
│        (Target: ZERO)          │ Status: 0 Occurrences (PASSED)        │
├────────────────────────────────┼───────────────────────────────────────┤
│ Tier 2: Active Project-Owned   │ LocalStorage fallbacks, RPC aliases,  │
│        Identifiers             │ Internal metadata tags                │
├────────────────────────────────┼───────────────────────────────────────┤
│ Tier 3: External Contracts     │ Meta WhatsApp Templates, Vercel CORS  │
│                                │ Railway domain allowlists             │
├────────────────────────────────┼───────────────────────────────────────┤
│ Tier 4: Historical Records     │ SQL Migrations (0001-0022), Audit MD  │
│                                │ Legacy CSS backups, Agent traces      │
├────────────────────────────────┼───────────────────────────────────────┤
│ Tier 5: 3rd-Party Dependencies │ External library metadata             │
└────────────────────────────────┴───────────────────────────────────────┘
```

---

## 2. Summary Audit Counts

Automated audit run using `frontend/scripts/audit-legacy-identity.mjs`:

| Category | Count | Status | Notes |
|---|---|---|---|
| **1. Active User-Facing Branding** | **0** | **CLEAN** | All UI copy, titles, banners, and buttons display PHANTOMS |
| **2. Active Project-Owned Fallbacks** | 20 | CONTROLLED | LocalStorage migration fallbacks and function aliases |
| **3. External Provider Contracts** | 12 | PRESERVED | Meta WhatsApp Cloud API templates & Vercel deployment URLs |
| **4. Historical Migrations & Archives** | 358 | IMMUTABLE | Historical SQL migration records & audit documentation |
| **5. Third-Party Dependencies** | 0 | UNTOUCHED | Standard packages only |

---

## 3. Detailed Inventory by Category

### Category 1: Active User-Facing Branding Violations
- **Total Found:** 0
- **Verification Result:** PASS (Zero occurrences detected).
- **Enforcement:** Enforced in CI via `npm run audit:identity`.

---

### Category 2: Active Project-Owned Identifiers & Compatibility Fallbacks
These entries represent programmatic fallbacks designed to maintain seamless backward compatibility for existing logged-in sessions, mobile notifications, and cached browser instances.

| File Path | Identifier | Architectural Purpose | Strategy |
|---|---|---|---|
| `frontend/src/store/auth.ts` | `wasla_member_session` | Legacy member session key | Checked on fallback; migrated to `phantoms_member_session` |
| `frontend/src/store/auth.ts` | `wasla_device_token` | Legacy device token key | Checked on fallback; migrated to `phantoms_device_token` |
| `frontend/src/store/auth.ts` | `wasla_member_remember` | Member remember preference | Checked on fallback; migrated to `phantoms_member_remember` |
| `frontend/src/lib/supabase/client.ts` | `wasla_admin_remember` | Admin remember preference | Checked on fallback; migrated to `phantoms_admin_remember` |
| `frontend/src/lib/notifications.ts` | `wasla_notif_sound_enabled` | Notification audio preference | Checked on fallback; migrated to `phantoms_notif_sound_enabled` |
| `frontend/src/lib/notifications.ts` | `wasla_notifications_v2_<id>` | Cached notification list | Read with fallback to populate notifications |
| `frontend/src/lib/notifications.ts` | `wasla_whatsapp_alerts_v2` | Android notification channel | Retained as comment reference |
| `frontend/src/hooks/usePWA.ts` | `wasla_push_key_fp` | Push VAPID key fingerprint | Fallback read; removed on fresh subscription |
| `frontend/src/hooks/usePWA.ts` | `wasla_apk_notif_enabled_<id>` | APK notification state | Cleaned up on permission toggle |
| `frontend/src/hooks/usePWA.ts` | `wasla_apk_perm_prompted_<id>` | Android 13+ permission flag | Prevents re-prompting previously prompted devices |
| `frontend/src/features/members/customFieldsApi.ts` | `wasla_member_custom_fields_v1` | Custom fields localStorage cache | Read on startup; migrated to `phantoms_*` |
| `frontend/src/features/portal/WhatsAppNotificationCenter.tsx` | `wasla_notif_snapshot_v2_<id>` | Unread notifications badge snapshot | Read on initial render; migrated to `phantoms_*` |
| `frontend/src/sw.ts` | `WASLA_PUSH_RECEIVED` | Service worker push broadcast event | Dual broadcast with `PHANTOMS_PUSH_RECEIVED` |
| `frontend/src/sw.ts` | `WASLA_NOTIFICATION_CLICKED` | Notification click broadcast event | Dual broadcast with `PHANTOMS_NOTIFICATION_CLICKED` |
| `frontend/src/features/ai-assistant/api.ts` | `wasla-ai` | Edge function slug | Fallback invocation target if `phantoms-ai` returns 404 |
| `frontend/src/features/ai-assistant/api.ts` | `useAskWaslaAi` | React hook alias | Alias export pointing directly to `useAskPhantomsAi` |
| `frontend/src/features/evaluations/api.ts` | `__wasla_eval` | Internal task evaluation marker | Preserved for parsing historical task metadata |
| `frontend/src/features/members/memberInviteApi.ts` | `@invite.wasla.local` | Internal invite pseudo-email domain | Handled by backend invite resolution trigger |
| `backend/whatsapp-bridge/src/index.ts` | `WASLA_ALLOWED_ORIGINS` | Environment variable fallback | Dual-read with `PHANTOMS_ALLOWED_ORIGINS` |
| `backend/whatsapp-bridge/src/auth.ts` | `admin-wasla.vercel.app` | Default allowed CORS origin | Dual-permitted with `admin-phantoms.vercel.app` |

---

### Category 3: External Provider Contracts
These identifiers represent external system dependencies managed outside this repository (Meta Developer Dashboard, Vercel deployments, Railway environments).

| File Path | Identifier | External Provider | Action / Requirement |
|---|---|---|---|
| `backend/supabase/functions/whatsapp-tasks/index.ts` | `wasla_task_assignment` | Meta WhatsApp Cloud API | Utility template name approved in Meta Business Suite. System uses `phantoms_task_assignment` with fallback. |
| `backend/WHATSAPP_SETUP.md` | `wasla_task_assignment` | Meta Developer Documentation | Documented template creation and fallback instructions. |
| `frontend/vercel.json` | `admin-wasla-production.up.railway.app` | Railway Infrastructure | CSP `connect-src` allowlist entry for deployed bridge service. |
| `backend/supabase/functions/push-notify/index.ts` | `admin-wasla.vercel.app` | Vercel Platform | Permitted origin for backward compatibility during DNS migration. |
| `backend/supabase/functions/admin-delete-account/index.ts` | `admin-wasla.vercel.app` | Vercel Platform | Permitted origin for admin delete account API. |
| `backend/supabase/functions/admin-invite/index.ts` | `admin-wasla.vercel.app` | Vercel Platform | Permitted origin for admin invite API. |
| `backend/supabase/functions/phantoms-ai/index.ts` | `admin-wasla.vercel.app` | Vercel Platform | Permitted origin fallback for AI edge function. |
| `backend/supabase/functions/wasla-ai/index.ts` | `admin-wasla.vercel.app` | Vercel Platform | Permitted origin fallback for legacy AI edge function. |

---

### Category 4: Historical Migrations & Audit Evidence
These records are permanently immutable. Changing filenames or contents of past SQL migrations or historical audit certificates would violate data integrity and break schema migration engines.

| Asset / Directory Path | Total Occurrences | Purpose & Retention Policy |
|---|---|---|
| `backend/migrations/` (Files 0001 - 0022) | 185 | Immutable PostgreSQL database schema history. Never edit past migration files. |
| `backend/supabase_setup.sql` | 42 | Original database schema baseline snapshot. Kept for historical reference. |
| `backend/whatsapp-bridge/import.sql` | 18 | Historical member data migration script from initial deployment. |
| `legacy/` (`style.css`, `sw.js`, `index.html`) | 78 | Quarantined archive of the legacy codebase for reference only. |
| `audit/reports/*.md` | 35 | Verifiable historical audit trails (Phases 1.0, 1.1, 1.2, 2.0, 2.1, 2.2, 2.3, 2.4). |

---

## 4. Verification and Enforcement

The integrity of this classification is enforced programmatically:
```bash
# Automated audit command
npm run audit:identity
```
Any accidental reintroduction of legacy branding into active UI components, page titles, or user-facing strings will fail the audit script and reject the deployment pipeline.

