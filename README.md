# PHANTOMS — Operations & Team Management Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%2015-3ecf8e.svg)](https://supabase.com/)
[![Security Hardened](https://img.shields.io/badge/Security-Hardened-emerald.svg)](#security-architecture)

> **PHANTOMS** is a high-performance, security-hardened operations and team management platform built for modern distributed teams. It provides end-to-end task assignment, member evaluations, performance ranking, real-time push/WhatsApp notifications, and an AI operations copilot.

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
│   • React 19 + TypeScript + Vite 6                                                                     │
│   • State Management: Zustand (Auth, Toasts, Member Deletion Undo)                                     │
│   • Server Cache: TanStack React Query v5                                                              │
│   • Styling: CSS Tokens & Design System + Tailwind CSS v4                                              │
│   • Excel Engine: ExcelJS (Hardened Export with CSV/Formula Injection Guard)                           │
│   • AI Operations: PHANTOMS Assistant (Streaming Edge Function + Strict Human Confirmation)            │
└────────────────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                         │ HTTPS / WSS
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Backend Infrastructure                                           │
│   • Supabase PostgreSQL (Schema & Row Level Security)                                                  │
│   • RPC Security Functions (`is_admin`, `bind_member_device_session`, `admin_add_member_rating`)        │
│   • Edge Functions (`wasla-ai`, `push-notify`)                                                         │
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
   - Device binding authentication via email OTP for frictionless, secure access.

5. **Evaluations & Performance Ranking**
   - Structured evaluations with grade levels (`excellent`, `very_good`, `good`, `needs_improvement`, `warning`).
   - Dynamic leaderboard calculated from approved task bonus points and administrative evaluations.

6. **PHANTOMS Assistant (AI Copilot)**
   - Conversational operations assistant powered by Edge Function LLM integration.
   - Strict XML context boundary to defend against prompt injection attacks.
   - Explicit confirmation modal required before executing any destructive operations (`delete_member`, `delete_task`, `delete_note`).

7. **Data Export & Reporting**
   - RTL-formatted Excel workbooks (`phantoms-members-YYYY-MM-DD.xlsx`).
   - Built-in CSV / Excel formula injection mitigation (sanitizing `=`, `+`, `-`, `@` triggers).
   - XLSX Import Feature Gate active to protect against untrusted archive decompression vulnerabilities (CVE-2026-78206).

---

## Security Architecture

- **Verified-Device Session Binding:** Members authenticate through cryptographic device tokens registered via email OTP. Anonymous session hijacking is systematically blocked.
- **Dynamic Owner & Admin Authorization:** Administrative access is governed by the `admin_access` table and secure PostgreSQL `is_admin()` checks, completely decoupling authorization from hardcoded UUIDs.
- **Destructive Mutation Guards:** AI assistant actions that perform deletions cannot execute autonomously; they require explicit operator confirmation through dedicated UI modals.
- **Spreadsheet Security:** Archive validation safeguards (`safeXlsxGuard.ts`) enforce total decompress size bounds, entry caps, and compression ratio limits. Untrusted file uploads remain feature-gated.
- **Secret Isolation:** Environment secrets (`.env`) are strictly untracked and excluded from version control.

---

## Getting Started

### Prerequisites

- Node.js 20+ (LTS recommended)
- npm 10+
- Supabase Project or Local Supabase CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/organization/phantoms.git
cd phantoms

# Install frontend dependencies
cd frontend
npm install

# Configure environment
cp .env.example .env.local
```

### Development

```bash
# Start frontend development server
npm run dev

# Run TypeScript typecheck
npx tsc --noEmit

# Run Oxlint / ESLint linter
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
```

---

## Repository Structure

```
phantoms/
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
│   ├── migrations/               # PostgreSQL schema migrations (0001 - 0022)
│   ├── supabase/functions/       # Supabase Edge Functions (wasla-ai, push-notify)
│   ├── whatsapp-service/         # WhatsApp notification API service
│   └── whatsapp-bridge/          # Baileys WhatsApp client gateway
└── audit/reports/                # Independent technical & security audit reports
```

---

## License

Proprietary — All rights reserved © 2026 PHANTOMS.
