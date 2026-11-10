# PHANTOMS — Operations & Team Management Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2.8-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3.6-646cff.svg)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%2015-3ecf8e.svg)](https://supabase.com/)
[![Security Hardened](https://img.shields.io/badge/Security-Hardened-emerald.svg)](#security-architecture)

> **PHANTOMS** is an operations and team management platform built for distributed teams. It provides task assignment, member evaluations, performance ranking, real-time push/WhatsApp notifications, and an AI operations copilot.

---

## Architecture Overview

```
                                      ┌─────────────────────────────────────────┐
                                      │             PHANTOMS Clients            │
                                      │   Web (PWA)  •  Capacitor (Android)     │
                                      └────────────────────┬────────────────────┘
                                                           │
                                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                            Frontend Core                                               │
│   • React 19.2 + TypeScript 5.9 + Vite 8.3                                                             │
│   • State Management: Zustand (Auth, Toasts, Member Deletion Undo)                                     │
│   • Server Cache: TanStack React Query v5                                                              │
│   • Styling: CSS Tokens & Design System + Tailwind CSS v4                                              │
│   • Excel Engine: ExcelJS (Hardened Export with CSV/Formula Injection Guard; Import Gated)             │
│   • AI Operations: PHANTOMS Assistant (Streaming Edge Function + Strict Human Confirmation)            │
└────────────────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                         │ HTTPS / WSS
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Backend Infrastructure                                           │
│   • Supabase PostgreSQL (Schema & Row Level Security)                                                  │
│   • RPC Security Functions (`is_admin`, `bind_member_device_session`, `admin_add_member_rating`)        │
│   • Edge Functions (`phantoms-ai`, `push-notify`, `whatsapp-tasks`)                                    │
│   • WhatsApp Integration Service (Baileys Bridge / Multi-Device Protocol)                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Feature Modules

1. **Dashboard & Operations Analytics**
   - High-level KPIs: Member availability, laptop readiness, active assignments, and review backlog.
   - Interactive metric charts, attendance breakdowns, and rapid dispatch shortcuts.

2. **Member Directory & Profile Management**
   - Comprehensive member profiles: hardware readiness, geographic availability, role tags.
   - Protected one-time self-registration links with expiration and single-use enforcement.
   - Resilient member deletion lifecycle with a 5-second persistent undo barrier.

3. **Task & Assignment Lifecycle**
   - Multi-member task distribution with deadlines, status tracking, and deliverables review.
   - Performance bonus points calculated directly upon task approval.

4. **Member Portal**
   - Clean, focused interface for members to view assigned tasks, submit links, and view evaluations.
   - Device binding authentication via email OTP for verified device sessions.

5. **Evaluations & Performance Ranking**
   - Structured evaluations with grade levels (`excellent`, `very_good`, `good`, `needs_improvement`, `warning`).
   - Dynamic leaderboard calculated from approved task bonus points and administrative evaluations.

6. **PHANTOMS Assistant (AI Copilot)**
   - Conversational operations assistant powered by Edge Function LLM integration.
   - Strict XML context boundary to defend against prompt injection attacks.
   - Explicit confirmation modal required before executing any destructive operations (`delete_member`, `delete_task`, `delete_note`).

7. **Spreadsheet Management (Export Active, Import Feature-Gated)**
   - RTL-formatted Excel workbooks (`phantoms-members-YYYY-MM-DD.xlsx`).
   - Built-in CSV / Excel formula injection mitigation via `safeCell()` (sanitizing `=`, `+`, `-`, `@` triggers).
   - **XLSX Import Feature Gate:** Due to unresolved upstream archive vulnerabilities in ExcelJS (CVE-2026-78206), untrusted file importing in `MemberExcelActions.tsx` is temporarily gated (`XLSX_IMPORT_DISABLED = true`) with a user-facing security notice.

---

## Security Architecture & Authorization Model

- **Verified-Device Session Binding:** Members authenticate through cryptographic device tokens (`phantoms_device_token` with legacy compatibility). For new devices, Supabase Auth email OTP (`signInWithOtp` and `verifyOtp`) is required to verify email ownership before `bind_member_device_session` registers a SHA-256 session hash.
- **Dynamic Multi-Admin & Owner Authorization:** Administrative access is governed by the `admin_access` table and PostgreSQL `is_admin()` RPC checks (migration `0022`), decoupling authorization from hardcoded UUIDs and supporting granular administrative permissions.
- **Destructive Mutation Guards:** AI assistant actions that perform deletions cannot execute autonomously; they require explicit operator confirmation through dedicated UI modals.
- **Spreadsheet Security:** Archive validation safeguards (`safeXlsxGuard.ts`) enforce total decompress size bounds, entry caps, and compression ratio limits. Untrusted file uploads remain feature-gated.
- **Secret Isolation:** Environment secrets (`.env`) are untracked and excluded from version control.

---

## Getting Started

### Prerequisites

- Node.js 20+ (LTS recommended)
- npm 10+
- Supabase Project or Local Supabase CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/TheSeifDev/dashboard-phantoms.git
cd dashboard-phantoms

# Install frontend dependencies
cd frontend
npm install
```

### Environment Configuration

The frontend reads environment variables from `frontend/.env.production` (or optional local override `frontend/.env.local`). Required keys:
- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: Supabase anon public API key.
- `VITE_WHATSAPP_BRIDGE_URL`: WhatsApp Bridge service endpoint.
- `VITE_PUBLIC_WEB_URL`: Base URL for member invite and portal links.

### Development

```bash
# Start frontend development server
npm run dev

# Run TypeScript typecheck
npx tsc --noEmit

# Run Oxlint linter
npm run lint

# Build for production
npm run build
```

### Running Test Suites

```bash
# Execute security regression static checks
npm run test:security

# Execute spreadsheet security guard unit tests
npm run test:xlsx

# Execute runtime behavioral integration tests
npm run test:runtime

# Execute brand transition verification suite
npm run test:brand
```

---

## Repository Structure

```
dashboard-phantoms/
├── frontend/                     # React 19 Frontend Application
│   ├── public/                   # Static assets, PWA manifest, and app icons
│   ├── src/
│   │   ├── components/           # Reusable UI & layout elements (AppSidebar, AuthShell, Modal)
│   │   ├── features/             # Feature slices (auth, dashboard, members, tasks, ai-assistant)
│   │   ├── hooks/                # React hooks (usePWA, useTheme)
│   │   ├── lib/                  # Utilities, Supabase client, notifications, validators
│   │   ├── store/                # Zustand stores (auth, toast, memberDeletion)
│   │   └── types/                # TypeScript schema & entity definitions
│   └── scripts/                  # Security tests, APK builders, audit scripts
├── backend/
│   ├── migrations/               # PostgreSQL schema migrations (0000 - 0023)
│   ├── supabase/functions/       # Supabase Edge Functions (phantoms-ai, push-notify, whatsapp-tasks)
│   ├── whatsapp-service/         # WhatsApp notification API service
│   └── whatsapp-bridge/          # Baileys WhatsApp client gateway
└── audit/reports/                # Independent technical & security audit reports
```

---

## Mobile & Android Identity

- Capacitor Android package namespace: `com.phantoms.app`
- Application Display Name: `PHANTOMS`
- Build script: `npm run apk` (outputs `phantoms-app.apk`)

---

## License

Proprietary — All rights reserved © 2026 PHANTOMS.
