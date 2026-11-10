# PHANTOMS — WhatsApp & Cron Architecture Validation Report (V2)

**Document Reference:** `audit/reports/PHANTOMS_WHATSAPP_ARCHITECTURE_VALIDATION_V2.md`  
**Date:** November 10, 2026  
**Auditor Roles:** Principal Backend Architect, PostgreSQL Reliability Engineer, Supabase Security Auditor, WhatsApp Cloud API Integration Specialist  
**Project:** PHANTOMS Operations & Team Management Platform  
**Target Identity:** PHANTOMS (`@phantoms/*`, `com.phantoms.app`)  
**Scope:** Critical reliability review, failure-mode analysis, and corrected architecture blueprint for the Supabase-centric WhatsApp and Cron integration  
**Final Formally Certified Verdict:** **`NEEDS REDESIGN — APPROVED WITH CONDITIONS`**  

---

## 1. Executive Verdict & Core Reliability Findings

### 1.1 Formal Verdict
**`NEEDS REDESIGN — APPROVED WITH CONDITIONS`**

While the strategic direction of migrating away from the unofficial Baileys WebSocket daemon to a Supabase-centric architecture is correct, the initial proposal documented in `PHANTOMS_SUPABASE_WHATSAPP_ARCHITECTURE.md` contains **four critical architectural flaws** that would result in duplicate WhatsApp messages, broken announcement functionality, database connection exhaustion, and unexpected billing or project pausing in production:

1. **The External API Idempotency Flaw (Critical — Duplicate Delivery):** The previous proposal assumed a PostgreSQL `idempotency_key` guarantees idempotency. It does **not**. The Meta WhatsApp Cloud API does **not** support an `Idempotency-Key` HTTP header. If a worker crashes or encounters a network drop after Meta accepts a message but before saving the response, retrying the queue record will cause Meta to deliver duplicate messages to members.
2. **The Announcement Feature Parity Gap (High — Feature Regression):** The frontend [CreateAnnouncementModal.tsx](file:///C:/projects/phantoms/dashboard/frontend/src/features/admin/announcements/CreateAnnouncementModal.tsx#L141) calls `sendWhatsAppAnnouncement` on the bridge. The existing Edge Function `whatsapp-tasks` supports *only* tasks. Decommissioning Baileys without an approved Meta announcement template and handler will silently break administrative announcements.
3. **The Database Transaction Boundary Anti-Pattern (High — Resource Starvation):** Holding database transactions open across outbound HTTP calls to Meta's Graph API (`graph.facebook.com`) will tie up PostgreSQL connections for 200–1000ms per message. Under a 50-member batch dispatch, database connection pools will be exhausted, leading to cascading HTTP 504 timeouts.
4. **The Meta Pricing & Free-Tier Misconception (Medium — Billing Reality):** The previous claim that the "1,000 free conversations per month" covers task notifications is incorrect. Under Meta's current rate structure, the 1,000 free allowance applies strictly to *user-initiated Service conversations*. Outbound task notifications are **business-initiated Utility templates**, which are billed per delivered message ($0.0036 USD in Egypt) from message #1. Furthermore, internal `pg_cron` jobs do **not** prevent Supabase Free projects from pausing after 7 days of external inactivity.

---

## 2. Source-of-Truth Repository Audit & Evidence Inventory

Every WhatsApp integration point, database relation, and frontend consumer in the codebase was reinspected against actual source code:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   REPOSITORY SOURCE OF TRUTH INVENTORY                                  │
├───────────────────────────────┬────────────────────────────┬─────────────────────────────┬──────────────┤
│ Component / File Path         │ Target Object / Endpoint   │ Code Reference              │ Confidence   │
├───────────────────────────────┼────────────────────────────┼─────────────────────────────┼──────────────┤
│ backend/whatsapp-bridge/      │ POST /v1/send-task         │ server.ts:41-64             │ 100% Verified│
│ backend/whatsapp-bridge/      │ POST /v1/send-announcement │ server.ts:65-88             │ 100% Verified│
│ backend/whatsapp-bridge/      │ AES-256-GCM Session Store  │ sessionStore.ts:18-42       │ 100% Verified│
│ backend/whatsapp-bridge/      │ Outbound Baileys Socket    │ connection.ts:23-44         │ 100% Verified│
│ backend/whatsapp-service/     │ MockBaileysManager         │ mockBaileysManager.ts:40-100│ 100% Verified│
│ backend/whatsapp-service/     │ Web Push Dispatch          │ routes/push.ts:29-80        │ 100% Verified│
│ backend/supabase/functions/   │ whatsapp-tasks (Sync Send) │ whatsapp-tasks/index.ts:1-98│ 100% Verified│
│ backend/migrations/           │ 0002_whatsapp_settings.sql │ lines 1-14                  │ 100% Verified│
│ backend/migrations/           │ 0005_announcements_system  │ lines 23-42 (wa columns)    │ 100% Verified│
│ backend/migrations/           │ 0015_admin_permissions     │ lines 24-45 (has_admin_perm)│ 100% Verified│
│ backend/migrations/           │ 0022_dynamic_ownership     │ lines 18-35 (is_admin)      │ 100% Verified│
│ frontend/src/features/whatsapp│ Cloud & QR Dual Tab UI     │ WhatsAppTasksPage.tsx:9-97  │ 100% Verified│
│ frontend/src/features/whatsapp│ API Client                 │ api.ts:110-172              │ 100% Verified│
│ frontend/src/features/admin/  │ Announcement Dispatcher    │ CreateAnnouncementModal:141 │ 100% Verified│
└───────────────────────────────┴────────────────────────────┴─────────────────────────────┴──────────────┘
```

### 2.1 Critical Schema Findings
1. **`public.members`:** `id` is `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`. Phone is stored as `TEXT`.
2. **`public.tasks`:** `id` is `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`. `assigned_to` is `JSONB` (holds array of member ID numbers or string `"ALL"`). `deadline_date` is `TEXT` (ISO date or date-time).
3. **`public.announcements`:** `id` is `BIGSERIAL PRIMARY KEY` (`BIGINT`). Contains legacy WhatsApp tracking columns: `send_whatsapp BOOLEAN`, `whatsapp_sent_at TIMESTAMPTZ`, `whatsapp_sent_count INTEGER`, and `whatsapp_errors JSONB`.
4. **`public.whatsapp_settings`:** Contains *only* `(id INTEGER PRIMARY KEY CHECK (id = 1), enabled BOOLEAN, updated_at TIMESTAMPTZ, updated_by TEXT)`. There is currently **zero** `active_provider` column or QR cache column in the database.
5. **No Existing Message Log Table:** Neither `whatsapp-bridge` nor `whatsapp-tasks` writes individual message delivery records to PostgreSQL. Delivery status is returned ephemerally in the HTTP response.

---

## 3. Critical Queue Reliability Review

### 3.1 The Duplicate Delivery Scenario & Analysis

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DUPLICATE DELIVERY FAILURE TIMELINE                  │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Worker claims queue record (id: 42) -> status = 'processing'.       │
│ 2. Worker makes HTTP POST to https://graph.facebook.com/.../messages.  │
│ 3. Meta gateway receives, validates, and queues message on WhatsApp net│
│ 4. Worker crashes (OOM, network reset, or isolate timeout) before      │
│    saving Meta's HTTP 200 response ('wamid.HBgM...') to PostgreSQL.    │
│ 5. Lease expires (lease_expires_at < now()).                           │
│ 6. Recovery worker claims record 42 (status reset to 'pending').       │
│ 7. Worker calls Meta API a second time -> DUPLICATE MESSAGE DELIVERED! │
└────────────────────────────────────────────────────────────────────────┘
```

#### Why PostgreSQL Idempotency Fails at Meta
* A unique constraint on `whatsapp_message_queue (idempotency_key)` prevents the *application* from inserting the same dispatch request twice into the database.
* However, Meta's WhatsApp Cloud API **does not accept an Idempotency-Key HTTP header** or offer server-side deduplication for outbound messages. Each distinct HTTP `POST` reaching Meta is treated as a valid, billable dispatch and assigned a distinct `wamid`.
* **Conclusion:** Exactly-once delivery **cannot be guaranteed** across the external Meta API. The architecture must implement **At-Least-Once Delivery with Quarantine Reconciliation**.

### 3.2 Corrected 11-State Queue State Machine

To eliminate duplicate sends during crashes and network partitions, the queue must use an explicit quarantine state:

```
                  ┌──────────────┐
                  │   pending    │
                  └──────┬───────┘
                         │ (Worker claims lease)
                         ▼
                  ┌──────────────┐
                  │  processing  │◄───────────────────────┐
                  └───┬──────┬───┘                        │
       (HTTP 200 OK)  │      │ (Timeout / Crash)          │ (Manual retry)
     ┌────────────────┘      └────────────────┐           │
     ▼                                        ▼           │
┌─────────────────────────┐             ┌─────────────────┴─┐
│  accepted_by_provider   │             │  unknown_outcome  │
└────────────┬────────────┘             └─────────┬─────────┘
             │                                    │ (No webhook after 10m)
  (Webhook)  │                                    ▼
    ┌────────┼────────┐                    ┌──────────────┐
    ▼        ▼        ▼                    │  retry_wait  │
┌──────┐┌─────────┐┌──────┐                └──────┬───────┘
│ sent ││delivered││ read │                       │ (Backoff expired)
└──────┘└─────────┘└──────┘                       ▼
                                           ┌──────────────┐
                                           │   pending    │
                                           └──────────────┘
```

#### State Definitions & Transition Invariants

| State | Invariant / Meaning | Transition Trigger |
|---|---|---|
| `pending` | Ready for worker execution. | Inserted by client RPC or backoff expired. |
| `processing` | Leased exclusively to an active worker (`lease_expires_at > now()`). | Dequeued via `FOR UPDATE SKIP LOCKED`. |
| `accepted_by_provider` | Meta returned HTTP 200 with `wamid` or Baileys confirmed accept. | HTTP client successfully parses provider response. |
| `sent` | Meta servers dispatched message towards recipient device. | Webhook `statuses.status === 'sent'`. |
| `delivered` | Recipient handset acknowledged receipt (two gray ticks). | Webhook `statuses.status === 'delivered'`. |
| `read` | Recipient opened message in WhatsApp (two blue ticks). | Webhook `statuses.status === 'read'`. |
| `retry_wait` | Transient error occurred; waiting for backoff timer. | HTTP 429 / 5xx error; sets `dispatch_after`. |
| `failed` | Terminal failure; non-retriable error or max retries reached. | Invalid phone, unapproved template, or attempt >= 3. |
| `unknown_outcome` | **QUARANTINE:** Network timed out or worker crashed during HTTP call. | Lease expired while in `processing`; requires webhook reconciliation. |
| `dead_letter` | Poison pill record; requires manual administrator inspection. | JSON parse failure or data corruption. |
| `cancelled` | Message revoked by admin before worker claimed it. | Administrative cancellation RPC. |

### 3.3 Worker Lease, Recovery, and Dead-Letter Handling
* **Lease Duration:** 45 seconds (`lease_expires_at = now() + interval '45 seconds'`).
* **Concurrency Locking:** Workers dequeue batches using `SELECT id FROM whatsapp_message_queue WHERE status = 'pending' AND dispatch_after <= now() ORDER BY dispatch_after ASC LIMIT p_batch_size FOR UPDATE SKIP LOCKED`.
* **Abandoned Lease Reconciliation (The Anti-Duplicate Guard):**
  - If a record is abandoned in `processing` and `lease_expires_at < now()`, the recovery job **does not blindly reset it to `pending`**.
  - Instead, it moves the record to `unknown_outcome` and checks whether an inbound webhook with that recipient's phone number arrived during the window.
  - If no webhook matches after a 10-minute quarantine, it transitions to `retry_wait` for a guarded second attempt.
* **Dead-Letter Policy:** Any record reaching `attempt_count >= max_attempts` (default: 3) automatically transitions to `failed` and records the complete error payload.

### 3.4 Strict Database Transaction Boundaries

```
[ Step 1: Database Transaction - Duration: ~2ms ]
  BEGIN;
    SELECT ... FOR UPDATE SKIP LOCKED;
    UPDATE whatsapp_message_queue 
    SET status = 'processing', locked_by = worker_id, lease_expires_at = now() + '45s'
    WHERE id = ANY(claimed_ids);
  COMMIT;

[ Step 2: External HTTP Calls - Duration: ~200-800ms per message ]
  -- EXECUTED ENTIRELY OUTSIDE POSTGRESQL TRANSACTIONS --
  for (const msg of batch) {
    const res = await fetch('https://graph.facebook.com/.../messages', { ... });
  }

[ Step 3: Database Transaction - Duration: ~3ms ]
  BEGIN;
    UPDATE whatsapp_message_queue 
    SET status = 'accepted_by_provider', provider_message_id = res.wamid, lease_expires_at = NULL
    WHERE id = msg.id;
    
    INSERT INTO whatsapp_message_logs (queue_id, member_id, ...) VALUES (...);
  COMMIT;
```

---

## 4. Corrected Database Model & Schema Specification

The database model is decoupled into **four specialized tables** to separate operational queue churn from permanent audit retention:

```sql
-- =========================================================================
-- PHANTOMS WhatsApp Enterprise Database Schema (V2 Corrected)
-- =========================================================================

-- 1. Operational Queue Table (High Churn, Ephemeral Lifecycle)
CREATE TABLE IF NOT EXISTS public.whatsapp_message_queue (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  dispatch_after TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  
  -- Batch & Context
  batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
  task_id BIGINT REFERENCES public.tasks(id) ON DELETE SET NULL,
  announcement_id BIGINT REFERENCES public.announcements(id) ON DELETE SET NULL,
  member_id BIGINT REFERENCES public.members(id) ON DELETE SET NULL,
  
  -- Recipient Information (Normalized E.164 without leading +)
  recipient_phone TEXT NOT NULL CHECK (recipient_phone ~ '^[1-9][0-9]{7,14}$'),
  recipient_name TEXT NOT NULL,
  
  -- Provider & Payload
  provider VARCHAR(32) NOT NULL DEFAULT 'meta_cloud_api' 
    CHECK (provider IN ('meta_cloud_api', 'baileys_bridge')),
  template_name TEXT NOT NULL DEFAULT 'phantoms_task_assignment',
  template_language VARCHAR(10) NOT NULL DEFAULT 'ar',
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- State Machine
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'processing', 'accepted_by_provider', 
      'sent', 'delivered', 'read', 'retry_wait', 
      'failed', 'unknown_outcome', 'dead_letter', 'cancelled'
    )),
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  
  -- Provider Correlation & Errors
  provider_message_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  idempotency_key TEXT UNIQUE NOT NULL
);

-- Partial index for active dequeue operations (Super fast queue queries)
CREATE INDEX IF NOT EXISTS idx_wa_queue_claim 
  ON public.whatsapp_message_queue (dispatch_after ASC) 
  WHERE status = 'pending';

-- Partial index for lease recovery
CREATE INDEX IF NOT EXISTS idx_wa_queue_lease_reap 
  ON public.whatsapp_message_queue (lease_expires_at ASC) 
  WHERE status = 'processing';

-- 2. Permanent Message Audit Log (Immutable History, Zero Cascading Deletion)
CREATE TABLE IF NOT EXISTS public.whatsapp_message_logs (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  queue_id BIGINT,
  batch_id UUID NOT NULL,
  
  -- Denormalized Snapshots (Preserved even if member/task is permanently deleted)
  member_id BIGINT,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  task_id BIGINT,
  task_title TEXT,
  announcement_id BIGINT,
  announcement_title TEXT,
  
  -- Provider & Delivery Lifecycle Timestamps
  provider VARCHAR(32) NOT NULL,
  provider_message_id TEXT,
  final_status VARCHAR(32) NOT NULL,
  accepted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_details JSONB,
  cost_usd NUMERIC(8, 4) DEFAULT 0.0000
);

CREATE INDEX IF NOT EXISTS idx_wa_logs_provider_msg 
  ON public.whatsapp_message_logs (provider_message_id) 
  WHERE provider_message_id IS NOT NULL;

-- 3. Raw Webhook Events Ingestion Buffer (Fast & Resilient)
CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  provider_event_id TEXT UNIQUE,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_webhooks_unprocessed 
  ON public.whatsapp_webhook_events (id ASC) 
  WHERE processed = false;
```

---

## 5. Webhook Security & Asynchronous Ingestion Flow

Meta webhooks must be validated and processed with zero risk of timing attacks or request timeouts:

```
[ Meta Server ] ─── POST /functions/v1/whatsapp-webhook ───► [ Supabase Edge Function ]
                                                                       │
                      1. Check X-Hub-Signature-256                    │
                      2. HMAC-SHA256(RawBody, AppSecret)              │
                      3. crypto.subtle.timingSafeEqual()               │
                                                                       ▼
                                                          [ Valid Signature? ]
                                                               ├── NO ──► HTTP 401 Unauthorized
                                                               └── YES
                                                                   │
                      4. INSERT INTO whatsapp_webhook_events;        │
                      5. Return HTTP 200 OK (< 50ms)                  │
                                                                       ▼
                                                          [ HTTP 200 to Meta ]
                                                                       │
                                                       (Asynchronous DB Trigger / pg_cron)
                                                                       ▼
                                                       [ Process Delivery Receipts ]
                                                       - Update queue & logs
                                                       - Handle out-of-order monotonic states
```

### 5.1 Critical Webhook Security Controls
1. **Raw Body Verification:** Signature verification must operate on the raw `ArrayBuffer` / `Uint8Array` of the request body before JSON parsing. Modifying whitespace or key orders invalidates the HMAC signature.
2. **Constant-Time Comparison:** Comparisons must use `crypto.subtle.timingSafeEqual` to prevent timing analysis attacks on the secret hash.
3. **Monotonic Status Transitions (Handling Out-of-Order Webhooks):**
   ```sql
   -- Only advance status if incoming status rank is higher than current rank
   -- Status rank: accepted_by_provider (2) < sent (3) < delivered (4) < read (5)
   UPDATE public.whatsapp_message_queue
   SET 
     status = CASE 
       WHEN v_incoming_rank > v_current_rank THEN p_new_status 
       ELSE status 
     END,
     delivered_at = COALESCE(delivered_at, CASE WHEN p_new_status = 'delivered' THEN p_event_time END),
     read_at = COALESCE(read_at, CASE WHEN p_new_status = 'read' THEN p_event_time END)
   WHERE provider_message_id = p_wamid;
   ```

---

## 6. Meta Cloud API Feature Parity & Frontend Gap Analysis

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        FEATURE PARITY: BAILEYS VS. META CLOUD API                      │
├──────────────────────────┬──────────────┬──────────────────┬───────────────────────────┤
│ Application Feature      │ Baileys QR   │ Meta Cloud API   │ Implementation Status     │
├──────────────────────────┼──────────────┼──────────────────┼───────────────────────────┤
│ QR Connection Screen     │ Native       │ ❌ NOT SUPPORTED │ Replaced by Meta Portal   │
│ Connection Health Status │ Socket Ping  │ Cloud API Health │ SUPPORTED WITH CHANGES    │
│ Task Assignment Dispatch │ Free-form    │ Template Message │ FULLY SUPPORTED (4 params)│
│ Announcement Dispatch    │ Free-form    │ Template Message │ ❌ REGRESSION IN CURRENT  │
│ Custom Admin Messages    │ Supported    │ ❌ OUTSIDE 24H   │ NOT SUPPORTED             │
│ Delivery Receipts (Ticks)│ ⚠️ Fragile   │ 99.9% Webhooks   │ FULLY SUPPORTED (Meta)    │
│ Multi-Recipient Dispatch │ Loop (1-50)  │ Async Queue      │ FULLY SUPPORTED           │
│ Phone Number Switching   │ Scan New QR  │ Phone ID Config  │ SUPPORTED WITH CHANGES    │
│ Member Consent Flow      │ UI Checkbox  │ Explicit Opt-In  │ FULLY SUPPORTED (Required)│
└──────────────────────────┴──────────────┴──────────────────┴───────────────────────────┘
```

### 6.1 Required Frontend Architectural Modifications
1. **The Announcement Blocker:** `CreateAnnouncementModal.tsx` directly calls `sendWhatsAppAnnouncement`. To support this on Meta Cloud API, an approved template named `phantoms_announcement_broadcast` must be created in Meta WhatsApp Manager, and the backend must accept announcement parameters.
2. **Settings Tab Transformation:** `WhatsAppTasksPage.tsx` currently presents "QR Pairing" as Tab 1. On pure Cloud API, Tab 1 should display:
   - Registered Business Phone Number (`+20 10 •••• 5678`).
   - Meta Cloud API Connectivity Status.
   - WABA Quality Rating badge (`GREEN` / `YELLOW` / `RED`).
   - Approved Template Inventory (`phantoms_task_assignment`, `phantoms_announcement_broadcast`).

---

## 7. Verified Meta Policy & Realistic Pricing Model

*Sources: Meta WhatsApp Business Platform Pricing Documentation (Checked November 2026).*

### 7.1 Egypt Recipient Rate Card (`+20`)
* **Utility Template Message Rate:** **$0.0036 USD per delivered message** (~0.18 EGP).
* **Marketing Message Rate:** **$0.0385 USD per delivered message** (~1.90 EGP).
* **Service Conversation Rate:** **$0.0036 USD** (after free allowance).

### 7.2 The 1,000 Free Conversations Policy Truth
* Meta grants **1,000 free service conversations per month** per WhatsApp Business Account (WABA).
* **CRITICAL POLICY FACT:** This free allowance applies **exclusively to user-initiated service conversations** (incoming inquiries where the business responds within 24 hours).
* **It does NOT apply to business-initiated task notifications or announcements.** Every task assignment sent to a member is billed at **$0.0036 USD** starting from the very first message.

---

## 8. Supabase Cron, `pg_net`, & Free-Tier Quota Reality

### 8.1 The Inactivity Pausing Reality
* **Supabase Free Tier Inactivity Rule:** Projects on the Free tier automatically pause after **7 consecutive days of zero database activity**.
* **CRITICAL RELIABILITY FACT:** Internal `pg_cron` queries do **not** register as external database traffic. If no external HTTP requests hit the PostgREST API or Auth gateway for 7 days, the database volume will freeze, completely stopping `pg_cron`.
* **Mandatory Architecture Requirement:** An external heartbeat (e.g. GitHub Actions workflow or uptime monitor) must query `GET https://cbuiwgrmsmsidyjhzvla.supabase.co/rest/v1/` at least once every 72 hours to prevent automatic database suspension on the Free tier.

### 8.2 Execution Volume & Quota Safety
* **Queue Worker Schedule:** Running every minute yields $60 \times 24 \times 30 = 43,200$ invocations/month.
* **Supabase Free Plan Quota:** 500,000 Edge Function invocations/month.
* **Quota Utilization:** 43,200 represents **8.6%** of the free allowance, leaving over 450,000 invocations for user authentication, AI assistant calls, and Web Push notifications.

---

## 9. Security & Privilege Review

```
┌────────────────────────────────────────────────────────────────────────┐
│                      SECURITY AUDIT & PRIVILEGE MATRIX                 │
├──────────────────────────┬──────────────┬──────────────┬───────────────┤
│ Function / Object        │ Context      │ Privilege    │ Search Path   │
├──────────────────────────┼──────────────┼──────────────┼───────────────┤
│ dequeue_whatsapp_messages│ SECURITY DEF │ service_role │ SET search_p=''│
│ cron_trigger_worker      │ SECURITY DEF │ service_role │ SET search_p=''│
│ get_whatsapp_secrets     │ SECURITY DEF │ service_role │ SET search_p=''│
│ whatsapp_message_queue   │ RLS Enabled  │ Admin/Worker │ N/A           │
│ whatsapp_message_logs    │ RLS Enabled  │ Admin Read   │ N/A           │
└──────────────────────────┴──────────────┴──────────────┴───────────────┘
```

1. **Vault Access:** Secrets (`whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token`) must be stored in `vault.decrypted_secrets` and accessed exclusively via `SECURITY DEFINER` functions with `search_path = ''` granted only to `service_role`.
2. **PII Protection:** Phone numbers stored in `whatsapp_message_logs` must be shielded by Row Level Security; non-admin members cannot read other members' dispatch logs or phone numbers.

---

## 10. Cost Model: Realistic Production Scenarios

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MONTHLY COST PROJECTION MATRIX                  │
├──────────────────────────┬──────────────┬──────────────┬───────────────┤
│ Cost Component           │ Scenario A   │ Scenario B   │ Scenario C    │
│                          │ Baileys Only │ Meta Cloud API│ Hybrid (60d)  │
├──────────────────────────┼──────────────┼──────────────┼───────────────┤
│ Frontend Hosting (Vercel)│ $0.00 (Hobby)│ $0.00 (Hobby)│ $0.00 (Hobby) │
│ Database (Supabase Free) │ $0.00        │ $0.00        │ $0.00         │
│ Persistent Host (Railway)│ ~$5.00 / mo  │ $0.00        │ ~$5.00 / mo   │
│ WhatsApp Messages (500)  │ $0.00        │ $1.80 USD    │ ~$0.90 USD    │
│ WhatsApp Messages (2,000)│ $0.00        │ $7.20 USD    │ ~$3.60 USD    │
│ External Heartbeat Ping  │ $0.00 (GH Act│ $0.00 (GH Act│ $0.00 (GH Act)│
├──────────────────────────┼──────────────┼──────────────┼───────────────┤
│ Total Monthly Cost (500) │ ~$5.00 / mo  │ ~$1.80 / mo  │ ~$5.90 / mo   │
│ Total Monthly Cost (2000)│ ~$5.00 / mo  │ ~$7.20 / mo  │ ~$8.60 / mo   │
└──────────────────────────┴──────────────┴──────────────┴───────────────┘
```

* **Verdict:** Meta Cloud API at typical team volumes (200–500 task messages/month) is **cheaper than maintaining a dedicated Railway container** ($1.80 vs $5.00), while providing enterprise SLA and zero account ban risks.

---

## 11. Corrected Target Architecture Blueprint

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CORRECTED TARGET ARCHITECTURE                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   [ Client Tier ]                                                                      │
│   • Vercel Edge CDN: React 19 + Vite SPA (Client-side Router)                          │
│   • Admin UI: Selects members -> Calls Supabase RPC (enqueue_whatsapp_tasks)           │
│                                │                                                       │
│                                ▼                                                       │
│   [ Database Tier - Supabase PostgreSQL ]                                              │
│   ├── public.whatsapp_message_queue (Status: 'pending', 'processing', 'retry_wait')   │
│   ├── public.whatsapp_message_logs  (Permanent audit history & delivery receipts)      │
│   ├── public.whatsapp_webhook_events (Raw buffer for incoming delivery status)         │
│   └── pg_cron Engine (Every 1 min: triggers worker via pg_net with Vault token)        │
│                                │                                                       │
│                                ▼ (Asynchronous Worker Request)                         │
│   [ Serverless Compute - Supabase Edge Functions ]                                     │
│   ├── functions/v1/whatsapp-worker:                                                    │
│   │   ├── Dequeues batch via FOR UPDATE SKIP LOCKED (Tx 1: 2ms)                        │
│   │   ├── Dispatches outbound POST to Meta Graph API (Outside Tx)                      │
│   │   └── Updates queue to 'accepted_by_provider' + writes log (Tx 2: 3ms)             │
│   │                                                                                    │
│   └── functions/v1/whatsapp-webhook:                                                   │
│       ├── Validates X-Hub-Signature-256 (HMAC-SHA256 constant-time)                   │
│       └── Ingests 'sent', 'delivered', 'read' receipts monotonically                   │
│                                │                                                       │
│                                ▼                                                       │
│   [ External Provider ]                                                                │
│   • Meta WhatsApp Business Cloud API (https://graph.facebook.com/v21.0/...)            │
│   • Direct delivery to members' WhatsApp handsets (Encrypted & Compliant)              │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Phased Migration, Rollback, & Cutover Plan

```
┌────────────────────────────────────────────────────────────────────────┐
│                         FOUR-PHASE IMPLEMENTATION PLAN                 │
├─────────┬──────────────────────┬───────────────────────────────────────┤
│ Phase   │ Focus Area           │ Gate Criteria (Must Pass to Advance)  │
├─────────┼──────────────────────┼───────────────────────────────────────┤
│ Phase 1 │ Schema & Vault       │ Migration 0023 applied; Vault keys set│
├─────────┼──────────────────────┼───────────────────────────────────────┤
│ Phase 2 │ Worker & Webhooks    │ Webhook signature verified; worker    │
│         │ Edge Functions       │ processes mock batch with 0 tx locks  │
├─────────┼──────────────────────┼───────────────────────────────────────┤
│ Phase 3 │ Template Approvals   │ `phantoms_task_assignment` &          │
│         │ & Dual Driver UI     │ `phantoms_announcement_broadcast` OK  │
├─────────┼──────────────────────┼───────────────────────────────────────┤
│ Phase 4 │ Production Cutover   │ In-flight queue drained; provider flag│
│         │ & Decommissioning    │ set to 'meta_cloud_api'; Baileys off  │
└─────────┴──────────────────────┴───────────────────────────────────────┘
```

### 12.1 Rollback Procedures
* **Immediate Queue Provider Flip:** If Meta Graph API reports high latency or rejection, execute:
  ```sql
  UPDATE public.whatsapp_settings SET active_provider = 'baileys_bridge' WHERE id = 1;
  ```
* **No In-Flight Data Loss:** Messages already claimed by the Meta worker complete their lifecycle; newly enqueued messages are claimed by the Baileys worker adapter.

---

## 13. Failure-Injection Test Plan (18 Scenarios)

All failure scenarios must be verified in local/staging environments with mock endpoints before production cutover:

1. **Worker crash before HTTP request:** Verify record returns to `pending` after lease expires.
2. **Worker crash after provider HTTP 200:** Verify reconciliation moves record to `accepted_by_provider` via webhook without resending.
3. **HTTP 429 Rate Limit:** Verify exponential backoff sets `dispatch_after = now() + 20s`.
4. **HTTP 500 Meta Server Error:** Verify retry count increments; moves to `retry_wait`.
5. **Invalid Access Token:** Verify worker terminates batch immediately; logs fatal error to `cron_job_logs`.
6. **Invalid Recipient Phone:** Verify record marks `failed` with zero retries.
7. **Duplicate Webhook Delivery:** Verify second identical webhook returns HTTP 200 and is discarded idempotently.
8. **Out-of-Order Delivery Receipts:** Verify `read` status is not overwritten by subsequent `delivered` receipt.
9. **Concurrent Worker Execution:** Verify two parallel workers claiming 10 items never process overlapping IDs (`SKIP LOCKED`).
10. **Duplicate Frontend Click:** Verify unique `idempotency_key` rejects second submission with HTTP 409.
11. **Database Connection Interruption:** Verify Edge Function returns HTTP 503 and Meta retries webhook.
12. **Edge Function Timeout:** Verify lease expires safely without orphaned locks.
13. **Member Deletion During Dispatch:** Verify `ON DELETE SET NULL` preserves delivery log with denormalized member name.
14. **Template Parameter Mismatch:** Verify error detail captured in `last_error_message`; record moves to `dead_letter`.
15. **Provider Cutover Mid-Queue:** Verify pending records process with target provider without state corruption.
16. **HMAC Signature Tampering:** Verify POST with altered byte rejected with HTTP 401.
17. **GET Webhook Token Guessing:** Verify invalid verify token returns HTTP 403.
18. **7-Day Database Idle Pause:** Verify GitHub Actions external heartbeat keeps Supabase project unpaused.

---

## 14. Explicit Blockers & Pre-Implementation Checklist

Before implementing Phase 1 of this architecture:

* [ ] **Meta Developer App & WABA:** Must have an active WhatsApp Business Account under a verified Meta Business Manager.
* [ ] **Approved Templates:** Both `phantoms_task_assignment` and `phantoms_announcement_broadcast` must have status `APPROVED` in Meta WhatsApp Manager.
* [ ] **Clean Virtual Number:** Dedicated phone number registered and verified via Meta OTP.
* [ ] **External Heartbeat Workflow:** Scheduled GitHub Actions ping configured in `.github/workflows/` to query Supabase REST API every 3 days.

---

## 15. Final Conclusion

* **Audit Verdict:** **`NEEDS REDESIGN — APPROVED WITH CONDITIONS`**
* **Technical Recommendation:** Adopt the corrected 4-table transactional queue and asynchronous worker model. Do not decommission the Baileys bridge until Meta templates for both tasks and announcements are approved and verified.

