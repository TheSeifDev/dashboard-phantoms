# PHANTOMS — Deployment Pipeline & Android Release Recovery Report

**Repository:** `TheSeifDev/dashboard-phantoms` (`C:\projects\phantoms\dashboard`)  
**Branch:** `chore/phantoms-full-identity-migration`  
**Date:** 2026-11-10  
**Status:** Pipeline Hardened, Android Config Aligned, Recovery Plan Established  

---

## 1. Executive Summary

This report documents the resolution of two critical production delivery blockers:
1. **GitHub Actions → Vercel Deployment & Security Headers Verification Failure:** Diagnosed and corrected the URL extraction flaw in `.github/workflows/deploy.yml`. The workflow now enforces strict secret validation, separates stdout from stderr, verifies URL regex format, and ensures security header checks only execute on authenticated, validated deployment URLs.
2. **Android Stale Release Recovery:** Inspected the existing public release (`latest-apk`) and downloaded the published APK. Confirmed that the published release was built on 2026-11-07 with the legacy package ID and debug signing. Updated `frontend/android/app/build.gradle` and `.github/workflows/build-apk.yml` with release signing support, version increments (v2 / 1.1.0), and verification gates, while establishing the safe transition plan for device installation.

---

## 2. Phase 1 — Git & Remote State

- **Local Branch:** `chore/phantoms-full-identity-migration`
- **Working Tree:** Clean (all assets synchronized).
- **Remote Integration:** Pull Request #2 (`359886e`) was reviewed and merged into `main` (`d9ef05e`).
- **Sync Status:** Local `chore/phantoms-full-identity-migration` was fast-forwarded to `d9ef05e` to incorporate the latest merged state from `origin/main`.
- **Active Draft PR:** Pull Request #2 is currently closed/merged. A new Draft PR will be opened from `chore/phantoms-full-identity-migration` targeting `main` to deliver the pipeline and Android release recovery commits.

---

## 3. Phase 2 — Vercel Deployment Pipeline Recovery

### A. Root Cause Analysis of Deployment Failure
In run `42865576824`, the Vercel deployment step executed:
```bash
URL=$(npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }} --yes 2>&1 | grep -E 'https://' | tail -1)
```
Because `VERCEL_TOKEN` was unset in GitHub Actions Secrets, the Vercel CLI terminated with an authentication error and emitted a documentation URL:
```
Vercel CLI 39.x ... Error: Missing token ... More info: https://err.sh/vercel/missing-token-value
```
The pipe `2>&1 | grep -E 'https://' | tail -1` indiscriminately extracted `https://err.sh/vercel/missing-token-value` and wrote it as `production_url`. Subsequently, the "Verify security headers on production" step queried:
```bash
curl -sSI "https://err.sh/vercel/missing-token-value/admin/login"
```
The step failed with `Content-Security-Policy header missing on production after deploy` because it was inspecting Vercel's documentation error page rather than a deployed application.

### B. Required Missing GitHub Secrets (Names Only)
The GitHub Actions secret store for `TheSeifDev/dashboard-phantoms` currently contains **0 secrets**. The following secrets must be added in **GitHub Repository Settings → Secrets and variables → Actions**:

| Secret Name | Purpose | Severity |
| :--- | :--- | :--- |
| `VERCEL_TOKEN` | Vercel personal access / deployment token | **BLOCKER** |
| `VERCEL_ORG_ID` | Vercel team / organization identifier | **BLOCKER** |
| `VERCEL_PROJECT_ID` | Vercel project identifier | **BLOCKER** |
| `VITE_SUPABASE_URL` | Supabase project URL for build-time injection | **HIGH** |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key for build-time injection | **HIGH** |
| `VITE_VAPID_PUBLIC_KEY` | Public Web Push key for service worker registration | **HIGH** |

### C. Pipeline Corrections Implemented
In `.github/workflows/deploy.yml`:
1. **Secret Pre-Validation:** Added strict validation ensuring `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` are present before invoking the Vercel CLI. If any secret is missing, the job terminates immediately with a descriptive GitHub Actions error (e.g., `::error::Missing secret: VERCEL_TOKEN...`).
2. **Stdout / Stderr Separation:** Redirected CLI stdout to `$URL_FILE` and stderr to `$ERROR_FILE`. Error messages are never parsed for deployment URLs.
3. **Exit Code Enforcement:** Verifies the actual exit code of `npx vercel deploy`. If the CLI fails, stderr is logged and the workflow halts.
4. **URL Regex Validation:** Validates that the captured URL strictly matches `^https://[A-Za-z0-9.-]+$`.
5. **Applied to Both Preview & Production:** Identical safety checks protect both `deploy-preview` and `deploy-production`.
6. **Robust Header Verification:** The security headers verification step now guards against empty or invalid URLs and executes real HTTP requests (`curl -sSI -L --max-time 15 "$URL/admin/login"`) with retries, inspecting final response headers without falsely attributing deployment authentication failures to missing CSP headers.

---

## 4. Phase 3 & 4 — Android Audit & Old APK Investigation

### A. Investigation of Published APK Asset
The current published asset (`wasla-app.apk`) in GitHub Release `latest-apk` (published 2026-11-07) was downloaded and inspected using Android SDK tools (`aapt dump badging` and binary certificate parsing):

- **File Name:** `wasla-app.apk` (Size: 5,409,416 bytes)
- **Application ID:** `com.wasla.app`
- **Application Label:** `وصلة تك` (across all locales)
- **Version Code:** `1`
- **Version Name:** `1.0`
- **Signing Scheme:** APK Signature Scheme v2
- **Certificate Subject / Issuer:** `CN=Android Debug, O=Android, C=US`
- **Certificate Validity:** Nov 7, 2026 – Oct 30, 2056
- **Certificate SHA-256 Fingerprint:** `F9:F2:73:E1:44:5C:AD:56:F0:12:F3:70:E6:CF:9E:52:F5:F9:E3:0F:00:B9:E1:23:52:DD:6C:1A:D1:E2:4F:3B`
- **Build Type:** `application-debuggable` (Unsigned debug build)

### B. Comparison with PHANTOMS Build Configuration

| Property | Old Published Release | New PHANTOMS Configuration | Status |
| :--- | :--- | :--- | :--- |
| **Application ID** | `com.wasla.app` | `com.phantoms.app` | **Changed (Independent App)** |
| **App Display Label** | `وصلة تك` | `PHANTOMS` | **Updated** |
| **Version Code** | `1` | `2` | **Incremented** |
| **Version Name** | `1.0` | `1.1.0` | **Incremented** |
| **Target SDK** | `36` | `36` | Valid |
| **Min SDK** | `24` | `24` | Valid |
| **Release Artifact Name** | `wasla-app.apk` | `phantoms-app.apk` | **Standardized** |
| **Signing Setup** | Debug Keystore | Configured via `signingConfigs.release` | **Hardened** |

### C. OS Package Separation & Migration Impact
Android OS enforces package identity exclusively by Application ID (`package`). Because the ID changed from `com.wasla.app` to `com.phantoms.app`:
- Android treats the new APK as a **completely separate application**.
- Installing `phantoms-app.apk` will **NOT** overwrite, replace, or upgrade `com.wasla.app` in place.
- Both applications can coexist side-by-side on user devices.
- User sessions in the old app's private sandbox will not be deleted, nor will they automatically transfer.
- **Recommended Onboarding Procedure:** Instruct users to install `PHANTOMS`, sign in to verify their connection, and subsequently uninstall the obsolete `وصلة تك` application manually.

---

## 5. Phase 5 — Android Release Signing Setup

### A. Gradle Release Signing Configuration
`frontend/android/app/build.gradle` was updated to incorporate secure release signing without hardcoding credentials:
```groovy
    signingConfigs {
        release {
            def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH") ?: project.findProperty("ANDROID_KEYSTORE_PATH")
            if (keystorePath && file(keystorePath).exists()) {
                storeFile file(keystorePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: project.findProperty("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: project.findProperty("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: project.findProperty("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH") ?: project.findProperty("ANDROID_KEYSTORE_PATH")
            if (keystorePath && file(keystorePath).exists()) {
                signingConfig signingConfigs.release
            }
        }
    }
```

### B. Required Android Secrets (Names Only)
To produce an official, signed Release APK, the following secrets must be added to GitHub Secrets:
1. `ANDROID_KEYSTORE_BASE64` (Base64-encoded `.jks` or `.keystore` file)
2. `ANDROID_KEYSTORE_PASSWORD`
3. `ANDROID_KEY_ALIAS`
4. `ANDROID_KEY_PASSWORD`

> [!WARNING]
> Because no signing keystore secrets are currently configured in GitHub Secrets, the CI workflow builds an **unsigned Debug APK for QA/Testing only** (`phantoms-app-debug.apk`) and deliberately halts release publishing to prevent distributing unsigned production APKs.

---

## 6. Phase 6 — Android CI/CD Workflow Hardening

`.github/workflows/build-apk.yml` was overhauled with the following safeguards:
1. **Branch Testing on PRs:** Added `pull_request` trigger for `frontend/**` and `.github/workflows/build-apk.yml`. QA builds can now be validated on pull requests without touching GitHub Releases.
2. **Conditional Signing & Verification:**
   - When all 4 keystore secrets exist: Decodes keystore to `$RUNNER_TEMP/release.keystore`, runs `./gradlew assembleRelease`, validates signature with `apksigner verify`, and verifies manifest badging (`package: name='com.phantoms.app'`, `application-label:'PHANTOMS'`).
   - When keystore secrets are absent: Emits `::warning::`, builds `./gradlew assembleDebug`, verifies badging, and uploads `phantoms-app-debug-apk`.
3. **Protected Release Publishing:** Publishing to GitHub Releases requires **both** `github.ref == 'refs/heads/main'` **and** `steps.check-secrets.outputs.has_keystore == 'true'`.
4. **Canonical Artifact Naming:** The release asset is strictly named `phantoms-app.apk`.

---

## 7. Phase 7 & 8 — Verification Matrix & Delivery Status

### A. Local Verification Suite Results
All local suites passed with 100% compliance:

```
✔ audit:identity     : 0 matching names, 0 matching files, 0 matching lines (PASS)
✔ test:brand         : 10/10 suites passed (Document titles, manifest, Android IDs, UI)
✔ test:storage       : 6/6 suites passed (Key management, quota safety, idempotency)
✔ test:security      : 45/45 suites passed (RLS, token secrecy, CORS, CSP)
✔ test:secrets       : 0 secrets found across codebase and outgoing commits (PASS)
✔ build              : TypeScript type-check passed; Vite bundle generated cleanly
✔ apk:sync           : Production assets compiled and synchronized to Android Capacitor
```

### B. Workflow Files Changed
- `.github/workflows/deploy.yml` (Vercel credentials validation, stdout/stderr separation, URL verification)
- `.github/workflows/build-apk.yml` (Keystore decoding, signature verification, PR testing, safe release gates)
- `frontend/android/app/build.gradle` (Version bump to v2 / 1.1.0, release signing config)

### C. Pull Request & CI Verification Runs
- **Active Pull Request:** [GitHub PR #3](https://github.com/TheSeifDev/dashboard-phantoms/pull/3)
- **CI Run 42869914096 (Vercel Pipeline):**
  - Quality Check: `success`
  - Build: `success`
  - Deploy Preview: `failure` (Caught missing `VERCEL_TOKEN` early and cleanly, completely preventing invalid URL extraction)
  - Deploy Production: `skipped` (Guarded by branch rules)
- **CI Run 42869914504 (Android APK Pipeline):**
  - Web Bundle & Capacitor Sync: `success`
  - Keystore Check: `success` (Evaluated `has_keystore=false` safely)
  - Release Build & Keystore Decode: `skipped` (Protected against unsigned release builds)
  - Debug QA Build: `success` (Generated valid `phantoms-app-debug.apk`)
  - Artifact Upload: `success` (`phantoms-app-debug-apk`, 8.27 MB uploaded to workflow run)
  - Release Publish: `skipped` (No public release overwritten)

### D. Remaining User Actions
1. **Configure Vercel Secrets:** Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` in GitHub Repository Settings -> Secrets and variables -> Actions.
2. **Configure Android Keystore Secrets:** Generate or provide your trusted release keystore and add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` in GitHub Actions Secrets.
3. **Review & Merge Draft PR:** Review and merge [PR #3](https://github.com/TheSeifDev/dashboard-phantoms/pull/3) to `main`. On merge to `main`, GitHub Actions will automatically deploy to production and publish the signed official release tagged `latest-apk`.

