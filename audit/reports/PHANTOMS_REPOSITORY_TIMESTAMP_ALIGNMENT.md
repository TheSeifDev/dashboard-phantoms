# PHANTOMS — repository-only migration timestamp alignment

## Resolution

The 24 SQL files under `backend/supabase/migrations` now use the production-applied timestamps recorded in the committed initialization manifest. Only their timestamp prefixes changed. Their descriptive filename suffixes and SQL bytes are unchanged.

This resolves the earlier local/remote identifier mismatch without rewriting production history. Original timestamps `20261112000000` through `20261112000023` remain historical provenance, not active migration filenames. Canonical repository timestamps are the 24 recorded generated versions, starting at `20261114163426` and ending at `20261114164006`. Descriptive names in production history still contain the original source stem; they are deliberately not rewritten.

No production SQL, migration repair, db push, database reset, frontend deployment, or automatic main merge is part of this change.

## Manifest and immutable content

Each entry now explicitly distinguishes `original_source_timestamp`, `original_source_filename`, `canonical_repository_filename`, and `remote_applied_timestamp`. The existing `source_file`, `source_version`, `mcp_name`, `remote_version`, `sha256`, and `success` fields are retained unchanged as historical provenance.

`backend/scripts/fixtures/production-initialization-baseline.json` is the exact original manifest from commit `85a36fc`. Regression tests compare all original provenance fields against that baseline and SHA-256-hash every current canonical SQL file. Before renaming, every source SQL file was also compared byte-for-byte with its Git blob at `85a36fc`; after renaming, all 24 canonical files were compared with those same blobs again.

The local-only manifest validator rejects missing/extra files, duplicate or out-of-order timestamps, local/remote timestamp mismatch, descriptive-suffix changes, content or hash changes, stale original filenames, inconsistent legacy fields, and invalid paths. Active inventory, health-check hints and security-test SQL reads resolve canonical paths from the manifest rather than obsolete hard-coded timestamps.

## Local validation

The 14 manifest tests, existing bootstrap/CLI/security/runtime/brand Node suites, three deployment-boundary tests, and the 16 TypeScript spreadsheet/storage tests pass. TypeScript compilation, lint, production build and build-credential scan pass. The build uses local-only public configuration; it is not deployed. Existing bundle-size and service-worker deprecation warnings remain non-blocking.

## Disposable database and CI evidence

`.github/workflows/database-runtime-validation.yml` runs the same manifest checks and immutable-hash regression tests before starting a fresh Docker-local Supabase database. Official CLI version **3.1.0** is pinned. Its inspected help states that database tests and migration listing target local databases by default; the workflow supplies no remote flag, connection URL, production token or password.

The workflow refuses a pre-existing project-link cache or database connection credentials. It initializes the fresh local stack from all 24 renamed files, prints local migration history, runs every existing pgTAP suite, rechecks SQL hashes, and stops the disposable stack. A separate job runs Node/TypeScript regressions, lint and production build with loopback-only Supabase configuration and no deployment command.

The sandbox has no Docker runtime, so disposable initialization and pgTAP execution are run on the repository's authorized GitHub Actions runner, not substituted with static checks. Exact run URLs, head commit, conclusions and pgTAP output are attached to the PR after those runs complete; historical pre-rename CI is not claimed as validation of this change.

## No deployment or production mutation

Vercel Git auto-deployment is disabled only for branch `fix/phantoms-production-init-wxwo` in both root and frontend configuration files. Unspecified branches retain their default behavior. The existing deployment workflow excludes this PR branch from its production-connected quality/health path and preview deployment; disposable validation replaces those checks for this branch.

Production verification uses only the Supabase MCP read-only migration-inventory tool. It does not execute production SQL. The before/after inventory must retain the same 24 generated version/name pairs. No Auth identities, data, policies, functions, schemas or remote migration rows are modified.

This commit is intended for PR review on `fix/phantoms-production-init-wxwo`; it must not be merged automatically.

## References

[1]: https://vercel.com/docs/project-configuration/git-configuration "Vercel per-branch Git deployment configuration"
