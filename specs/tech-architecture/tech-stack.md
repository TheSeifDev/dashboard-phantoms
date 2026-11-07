# Project Context

## Stack
- **Frontend:** React + TypeScript (Vite)
  - UI: Tailwind (via `@tailwindcss/vite`)
  - Data: Supabase JS (`@supabase/supabase-js` v2)
  - Fetching/caching: TanStack React Query
  - Routing: React Router (`createBrowserRouter`)
  - State: Zustand (auth, theme, toast)
  - PWA: `vite-plugin-pwa` with `injectManifest` + custom service worker (`src/sw.ts`)
- **Backend (data/security layer):** Supabase PostgreSQL + RLS policies + RPC functions
  - Schema/migrations in `backend/migrations/*.sql`
  - Security hardening in `backend/migrations/0001_security_hardening.sql`
  - Operational “single-device” and “admin-only” enforcement via DB functions/policies
- **Backend (Edge Functions):** Supabase Edge Functions (Deno)
  - `backend/supabase/functions/wasla-ai`
  - `backend/supabase/functions/push-notify`
  - `backend/supabase/functions/whatsapp-tasks`
- **Backend (WhatsApp integration):** Node services
  - `backend/whatsapp-service` (Express API for push + WhatsApp status/QR bridging UI support)
  - `backend/whatsapp-bridge` (WhatsApp QR bridge HTTP server using Baileys; encrypted session storage)
- **Infra/Deploy:** Vercel
  - `frontend/vercel.json` defines SPA rewrite and security headers (when applied)
  - CI in `.github/workflows/deploy.yml` builds from `frontend/`

## Architecture

### High-level application layout
- **Admin experience** (authenticated Supabase user):
  - `frontend/src/router/index.tsx` protects `/admin/*` via `ProtectedAdminRoute` using `useAuthStore().user`
  - Admin login: `frontend/src/features/auth/AdminLoginPage.tsx`
    - Supabase Password auth: `supabase.auth.signInWithPassword({ email, password })`
    - On success: Zustand `setSession` + route to `/admin/dashboard`
  - Admin UI pages:
    - Dashboard, Members, Tasks, Notes, Announcements, AI Assistant, WhatsApp
    - Data access is directly via Supabase PostgREST queries (`supabase.from(...).select(...)`) and RPC calls.

- **Member portal experience** (anonymous/“anon” + DB-enforced device gating):
  - Member login: `frontend/src/features/auth/LoginPage.tsx`
    - Uses RPC `lookup_member_by_email` to validate and bind a `deviceToken`.
    - On success: Zustand `setMember` and route to `/portal`.
  - Member portal page: `frontend/src/features/portal/MemberPortalPage.tsx`
    - Logout clears local member state and calls `logout_member_device(memberId)`.
    - Uses member-scoped data from:
      - `useTasks` (`frontend/src/features/tasks/api.ts`)
      - `useUpdateTaskStatus` (updates `tasks.tracking` only)
      - `useUpdateMember` is present but constrained by DB RLS.
      - `MemberAnnouncements` via announcements RPC.

### Data flow patterns
1. **UI → Supabase (PostgREST/RPC):**
   - Most data operations are performed client-side directly from the React app:
     - CRUD via `supabase.from(TABLE).select()/insert()/update()/delete()`
     - Admin-grade actions sometimes via RPC:
       - `approve_task_submission` (atomic approval + rank update)
       - announcement read/dismiss RPCs
       - device-token RPCs

2. **Authorization is intended to be DB-enforced (RLS + SECURITY DEFINER RPCs):**
   - Frontend route guards are present but treated as UX only.
   - DB layer controls what:
     - `anon` can read/write
     - `authenticated` can read/write
     - “single-device” member binding allows RPC lookup only when token matches.

3. **WhatsApp integration side effects:**
   - Admin triggers push/WhatsApp actions via Edge Functions or direct calls to backend services.
   - Edge Functions perform:
     - Admin auth check via `supabase.auth.getUser()` (requires bearer token)
     - Use of Vault-backed secrets (AI key / or service-role for allowed operations)

### Code organization
- **Frontend feature-folders:** `frontend/src/features/<domain>/...`
  - Examples: `auth`, `members`, `tasks`, `notes`, `portal`, `admin/announcements`, `ai-assistant`, `whatsapp`
- **Shared libs:**
  - Supabase client: `frontend/src/lib/supabase/client.ts`
  - Error mapping: `frontend/src/lib/supabase/errors.ts` and `frontend/src/lib/errorHandler.ts`
  - Validators: `frontend/src/lib/validators.ts`
- **UI components:** `frontend/src/components/...`

### “Gray areas” observed in architecture (how things are done)
- **Security boundary placement:**
  - DB RLS exists and is heavily relied upon.
  - Still, the client does some auth separation (admin vs member) and stores session/member state locally.

- **Error handling style differs by layer:**
  - Frontend uses two separate mapping utilities:
    - `lib/supabase/errors.ts` → `toAppError()` for Supabase/PostgREST errors
    - `lib/errorHandler.ts` → `handleSupabaseError()` for UI-friendly messages
  - Edge functions return JSON `{ error: string }` with inconsistent status codes between functions (still uses `application/json`).

- **API shape conventions:**
  - Supabase table columns are snake_case (e.g., `created_at`, `completion_rank`, `assigned_to`).
  - Frontend uses TypeScript types mirroring DB names in `frontend/src/types/db.ts`.
  - Edge functions accept JSON bodies with camelCase in request payloads, but map to DB fields server-side.

- **Type safety:**
  - Strong-ish typed client via `frontend/src/types/db.ts`.
  - Some places cast `any` (e.g., Supabase function invocation generic typing and toast store usage).
  - Supabase client typed as `createClient<Database>`.

- **Observability:**
  - Frontend uses console logging in some error paths; main observability is via UX toasts.
  - Edge functions use `console.error` for errors.
  - There are explicit CI/ops scripts (see below).

- **Testing strategy:**
  - WhatsApp service has Node test runner tests under `backend/whatsapp-service/src/tests` (mocked Baileys).
  - Frontend has Playwright as a dependency, but tests were not inspected deeply during cold analysis.

## Conventions (Observed)

### Error handling pattern
- Supabase client errors are normalized into user-safe Arabic messages:
  - `toAppError(raw, fallback)` looks for common PostgREST/RLS patterns (`42501`, `row-level security`, `401`, etc.).
- Edge functions generally:
  - Validate input (basic checks for required fields and arrays)
  - Validate auth (`supabase.auth.getUser()`)
  - Return JSON `{ error }` on failures.

### API design
- **Primary DB access style:** Supabase PostgREST from the client.
- **Primary “sensitive write” style:** DB triggers/RPC functions (e.g., atomic approval via `approve_task_submission`).
- **RPC naming:** `lookup_member_by_email`, `approve_task_submission`, announcement RPCs.

### Type system conventions
- DB types are declared in a single file:
  - `frontend/src/types/db.ts`
- Types include RPC argument/return typing in `Database.public.Functions`.

## Signals / Active Considerations
- **Authorization must be DB-enforced (not only client-guarded):**
  - `/admin/*` is protected by a React route guard, but correctness ultimately depends on Supabase RLS.
- **Consistency gap:**
  - Member portal uses RPC for login but table access elsewhere (RLS + column grants).
- **Potential hotspot areas for future refactors:**
  - Client-side “direct PostgREST from browser” means any RLS or policy regression becomes a security incident.
  - Error handling is split between multiple mappers (`toAppError` vs `handleSupabaseError`).
- **Integration points:**
  - Push/WhatsApp flows depend on Edge Functions and (optionally) the Node WhatsApp bridge.
  - There is an encryption/session store layer in `whatsapp-bridge/src/sessionStore.ts`.

## Repository entry points
- Frontend: `frontend/src/main.tsx` + `frontend/src/router/index.tsx`
- Admin login: `frontend/src/features/auth/AdminLoginPage.tsx`
- Member login: `frontend/src/features/auth/LoginPage.tsx`
- Edge functions:
  - `backend/supabase/functions/wasla-ai/index.ts`
  - `backend/supabase/functions/push-notify/index.ts`
  - `backend/supabase/functions/whatsapp-tasks/index.ts`
- WhatsApp bridge:
  - `backend/whatsapp-bridge/src/server.ts` (HTTP API)
  - `backend/whatsapp-bridge/src/connection.ts` (Baileys socket)
  - `backend/whatsapp-bridge/src/sessionStore.ts` (encrypted session persistence)
- WhatsApp service:
  - `backend/whatsapp-service/src/index.ts` (Express app)

