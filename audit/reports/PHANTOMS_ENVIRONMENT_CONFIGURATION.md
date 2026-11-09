# PHANTOMS — Environment Configuration & Secret Management Architecture

**Date:** November 9, 2026  
**Project:** PHANTOMS Operations & Team Management Platform  
**Target Identity:** PHANTOMS (`@phantoms/*`, `com.phantoms.app`)  
**Status:** ENFORCED & STANDARDIZED  

---

## 1. Architectural Strategy: Public vs. Private API Separation

To guarantee airtight credential safety, the platform enforces a strict boundary between public client configuration and private backend credentials:

```
┌────────────────────────────────────────────────────────────────────────┐
│             PHANTOMS ENVIRONMENT ARCHITECTURE SEPARATION              │
├───────────────────────────────────┬────────────────────────────────────┤
│ FRONTEND (Browser & Android APK)  │ BACKEND (Services & Edge Fns)      │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Variables MUST use VITE_ prefix │ • Server-side variables ONLY       │
│ • Strictly PUBLIC configuration   │ • NO VITE_ prefix                  │
│ • Examples:                       │ • Injected via Secrets / Vault     │
│   - VITE_SUPABASE_URL             │ • Examples:                        │
│   - VITE_SUPABASE_ANON_KEY        │   - SUPABASE_SERVICE_ROLE_KEY      │
│   - VITE_VAPID_PUBLIC_KEY         │   - GROQ_API_KEY                   │
│   - VITE_WHATSAPP_BRIDGE_URL      │   - WHATSAPP_ACCESS_TOKEN          │
│   - VITE_PUBLIC_WEB_URL           │   - VAPID_PRIVATE_KEY              │
├───────────────────────────────────┼────────────────────────────────────┤
│ ❌ PROHIBITED IN FRONTEND:        │ ❌ PROHIBITED IN BACKEND:          │
│   - sb_secret_... keys            │   - Committing raw secrets to Git  │
│   - service_role JWTs             │   - Returning secrets in API logs  │
│   - AI provider keys (Groq/Gemini)│   - Exposing secrets in error msgs │
│   - Database passwords / URIs     │   - Storing session keys plain-text│
│   - Web Push private keys         │                                    │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## 2. Workspace Environment Templates

Standardized `.env.example` templates have been established for every workspace in the repository. These files contain variable names and safe placeholders only and are safely tracked in Git.

### 2.1 Frontend Workspace: `frontend/.env.example`
```env
# =========================================================================
# PHANTOMS Frontend Environment Configuration (Public Client Configuration)
# =========================================================================
# SECURITY MANDATE:
# Vite exposes all variables prefixed with `VITE_` to client-side bundles.
# ONLY intentionally public configuration may be placed in this file.
# NEVER place private credentials, service_role keys, Supabase secret keys
# (sb_secret_...), database passwords, or AI provider keys here.
# =========================================================================

# Supabase Public Configuration (Publishable or public anon key only)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key

# Web Push VAPID Public Key (Browser public application server key only)
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key

# WhatsApp Bridge Service Endpoint (Local development or reverse proxy)
VITE_WHATSAPP_BRIDGE_URL=http://localhost:3030

# Public Production Web URL
VITE_PUBLIC_WEB_URL=https://admin-phantoms.vercel.app
```

### 2.2 WhatsApp Service Workspace: `backend/whatsapp-service/.env.example`
```env
PORT=3030
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
WHATSAPP_ADMIN_EMAILS=admin@phantoms.org,admin@example.com
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173

# Web Push VAPID Keys (Generate with `npx web-push generate-vapid-keys`)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

### 2.3 WhatsApp Bridge Workspace: `backend/whatsapp-bridge/.env.example`
```env
PORT=3030
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-publishable-or-anon-key
WHATSAPP_SESSION_ENCRYPTION_KEY=replace-with-32-random-bytes-as-base64
WHATSAPP_SESSION_FILE=./data/session.enc
WHATSAPP_BRIDGE_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
WHATSAPP_BRIDGE_DRY_RUN=true
```

---

## 3. Global `.gitignore` Policy

The root `.gitignore` file enforces a deny-by-default policy across all workspaces and directories.

### Policy Rules
```gitignore
# --- 1. Environment & Secrets (Deny by default across all workspaces) ---
**/.env
**/.env.*
!**/.env.example
!**/.env.template
!**/.env.sample

# Local overrides
*.local
*.local.*

# Secret & credential directories
**/secrets/
**/credentials/
**/*service-account*.json
**/credentials*.json

# Private keys, certificates & keystores
*.pem
*.key
*.p12
*.pfx
*.jks
*.keystore

# Platform temporary / secret cache
**/.vercel/
**/.supabase/.temp/

# WhatsApp Bridge local session storage
backend/whatsapp-bridge/data/
```

### Pattern Verification Evidence
All critical ignore rules were tested and verified using `git check-ignore -v`:

| Test Target Path | Matching Rule in `.gitignore` | Status |
|---|---|---|
| `.env` | `.gitignore:6:**/.env` | **IGNORED** |
| `.env.local` | `.gitignore:13:*.local` | **IGNORED** |
| `.env.development` | `.gitignore:7:**/.env.*` | **IGNORED** |
| `.env.production` | `.gitignore:7:**/.env.*` | **IGNORED** |
| `.env.test` | `.gitignore:7:**/.env.*` | **IGNORED** |
| `frontend/.env.production` | `frontend/.gitignore:18:.env.*` | **IGNORED** |
| `frontend/.env.local` | `frontend/.gitignore:18:.env.*` | **IGNORED** |
| `backend/whatsapp-service/.env` | `.gitignore:6:**/.env` | **IGNORED** |
| `secrets/test.key` | `.gitignore:17:**/secrets/` | **IGNORED** |
| `test.pem` | `.gitignore:23:*.pem` | **IGNORED** |
| `credentials.json` | `.gitignore:20:**/credentials*.json` | **IGNORED** |
| `my-service-account.json` | `.gitignore:19:**/*service-account*.json` | **IGNORED** |
| `frontend/.env.example` | `frontend/.gitignore:19:!.env.example` | **TRACKABLE (PASS)** |
| `backend/whatsapp-service/.env.example`| Root `!.env.example` negation | **TRACKABLE (PASS)** |

---

## 4. Preservation of Local Developer Configuration

In accordance with strict operating boundaries:
- Existing local environment files (`frontend/.env.production`, `frontend/.env`, etc.) were left in place on disk.
- Untracking was performed using Git index operations (`git rm --cached`), ensuring zero local data loss.
- Developers can safely maintain active credentials on their local workstations without risking accidental Git staging.

