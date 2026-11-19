# PHANTOMS — Operations & Team Management Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2.8-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3.6-646cff.svg)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%2015-3ecf8e.svg)](https://supabase.com/)
[![Security Hardened](https://img.shields.io/badge/Security-Hardened-emerald.svg)](#security-architecture)

> **PHANTOMS** is an operations and team management platform built for distributed teams. It provides task assignment, member evaluations, performance ranking, real-time push/WhatsApp notifications, and an AI operations copilot.

## Redesign and task contribution streak

The 2026-11-19 redesign adds a cool light/navy dashboard, persisted Arabic/English RTL/LTR, split-screen sign-in, scoped GSAP motion with reduced-motion support, and a yearly task-approval contribution heatmap. Counts come from the real task/member queries and the protected daily contribution RPC; unknown historical periods are explicitly distinguished from zero activity. The approval/reversal ledger is captured by a trigger inside the existing administrative RPC transaction, preserving the RPC signatures and authorization.

`20261119183000_task_contribution_ledger.sql` (migration 37) is applied to PHANTOMS production as remote version `20261119193932`. The tested frontend redesign is being committed and pushed to `main` under explicit release approval; that push may trigger automatic UI deployment. The already released Owner-review migration 36 and Edge function are unchanged. Streaks are observed within the selected calendar year; current streak is shown only for the current year. See [the approved plan](plan.md). Migration checksums and production status are recorded in the forward manifest.

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
│   • Edge Functions: `phantoms-ai`, `push-notify`, `whatsapp-tasks`                                     │
│     `member-password-enrollment` (invitation-only member auth)                                         │
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
   - Administrator-issued, manually shared expiring one-time links: for a new member the Admin may leave email blank, and the recipient enters their own email, profile and password before waiting inactive for Admin review; existing members receive a first-password setup or password-only reset link.
   - Resilient member deletion lifecycle with a 5-second persistent undo barrier.

3. **Task & Assignment Lifecycle**
   - Multi-member task distribution with deadlines, status tracking, and deliverables review.
   - Performance bonus points calculated directly upon task approval.

4. **Member Portal**
   - Clean, focused interface for members to view assigned tasks, submit links, and view evaluations.
   - Isolated member email/password authentication, exact Auth-to-member authorization and verified device sessions.

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

- **Invitation-Only Member Password Auth:** An Admin issues an expiring one-time link and shares it out-of-band; no manual Auth UUID or Admin-entered member password is required. For a new-member join, Admin may optionally pre-bind an email; otherwise the recipient must enter their own email on the link, where it is atomically bound at first use. The member also enters their profile and password, then remains inactive pending Admin review without portal access. The app does not send an email-verification message, so the Admin must independently verify identity and the submitted contact email before activation. Existing-member first-password setup and reset are distinct exact-member operations; reset accepts a new password only and cannot edit profile data. Enrollment redirects to Login without a session. Public signup remains disabled; global email confirmation stays enabled. Normal login and reset do not require OTP, SMTP or application-sent invitation email.
- **Verified-Device Session Binding:** The isolated member client signs in with a password. `get_member_password_access` must verify the exact Auth UUID, normalized email, active membership and completed password enrollment before device binding and portal access. Cryptographic device tokens remain a second authorization requirement, not authentication by themselves. Old unbound invitation/device credentials are not password-enrollment authority.
- **Dynamic Multi-Admin & Owner Authorization:** Administrative access is governed by the `admin_access` table and PostgreSQL `is_admin()` RPC checks (migration `0022`), decoupling authorization from hardcoded UUIDs and supporting granular administrative permissions.
- **Destructive Mutation Guards:** AI assistant actions that perform deletions cannot execute autonomously; they require explicit operator confirmation through dedicated UI modals.
- **Spreadsheet Security:** Archive validation safeguards (`safeXlsxGuard.ts`) enforce total decompress size bounds, entry caps, and compression ratio limits. Untrusted file uploads remain feature-gated.
- **Secret Isolation:** Environment secrets (`.env`) are untracked and excluded from version control.

The production Supabase migration history was verified after release through remote migration version `20261119054418`, which records source migration `20261119005000_member_password_owner_join_review`; its matching Edge function is deployed. The dashboard queue source is included in the `main` release; automatic hosted UI publication was not independently verified, and Vercel was not accessed. An issued or opened invitation alone does not create a member, and do not activate registrations by direct SQL. Approval requires a completed join and a current exact email match across Auth, invitation, binding, and member records; mismatches remain visible as blocked items rather than disappearing. The queue uses a cursor to retrieve older pages beyond its first 100 items. Generic status changes away from `inactive`—including a `NULL` intermediate state—are blocked until the audited Owner/Admin approval path runs. Existing identities are never silently mapped, Owner/Admin credentials are not changed, production signup/SMTP is not configured, and uncertain Auth writes remain quarantined without automatic retry or release.

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
│   ├── scripts/                  # Migration manifest, runtime validation, and operator inventory
│   ├── supabase/
│   │   ├── migrations/           # Canonical SQL (24 historical + 12 forward; see forward manifest)
│   │   ├── functions/            # Edge Functions, including member-password-enrollment
│   │   └── tests/database/       # Database security and pgTAP suites
│   ├── whatsapp-service/         # WhatsApp notification API service
│   └── whatsapp-bridge/          # Baileys WhatsApp client gateway
├── docs/
│   └── member-password/          # Operator runbook and existing-account migration guide
└── audit/reports/                # Independent technical & security audit reports
```

Member-password operations: [operator runbook](docs/member-password/operator-runbook.md) · [existing-account migration guide](docs/member-password/existing-account-migration.md).

---

## Mobile & Android Identity

- Capacitor Android package namespace: `com.phantoms.app`
- Application Display Name: `PHANTOMS`
- Build script: `npm run apk` (outputs `phantoms-app.apk`)

---

## License

Proprietary — All rights reserved © 2026 PHANTOMS.
