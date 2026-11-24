import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const read = (path) => readFile(join(repo, path), 'utf8');

test('admin capabilities: owner-only decisions and timed grants in SQL', async () => {
  const sql = await read('backend/supabase/migrations/20261124090000_admin_capabilities.sql');

  for (const key of ['full_owner', 'admin_accounts', 'admin_password_reset', 'strikes', 'app_usage']) {
    assert.ok(sql.includes(`'${key}'`), `capability ${key} is declared`);
  }
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.admin_capability_requests/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.admin_capability_grants/);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/, 'grants always carry an expiry');
  assert.match(sql, /g\.expires_at > pg_catalog\.now\(\)/, 'expired grants stop counting');

  // الموافقة للمالك الحقيقي بس — مش لأي حد عنده منحة مؤقتة.
  const decide = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_decide_capability_request'));
  assert.match(decide.slice(0, 900), /NOT public\.is_owner_role\(v_uid\)/,
    'decisions require the real owner role, not a temporary grant');
  assert.match(decide.slice(0, 2500), /GREATEST\(15, LEAST\(COALESCE\(p_minutes, 1440\), 43200\)\)/,
    'approval durations are clamped between 15 minutes and 30 days');

  // is_owner() بتفتح بمنحة full_owner سارية، والقدرات الأخرى بمنحها.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_owner\(\)[\s\S]{0,300}'full_owner'/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.has_capability\(p_capability TEXT\)/);

  // تصفير كلمة مرور مشرف بقى مسموح للمالك/صاحب القدرة بدل ما يرمي IDENTITY_CONFLICT.
  assert.match(sql, /v_target_is_admin/);
  assert.match(sql, /user_has_capability\(p_actor_user_id, 'admin_password_reset'\)/);
  assert.doesNotMatch(sql, /OR EXISTS \(SELECT 1 FROM public\.admin_accounts AS a WHERE a\.user_id = v_identity\.id\) THEN\s*\n\s*RAISE EXCEPTION 'IDENTITY_CONFLICT'/);
});

test('admin capabilities: requests, inbox, decisions and revoke are wired in the client', async () => {
  const api = await read('frontend/src/features/admin/access/api.ts');
  for (const rpc of [
    'admin_capability_state',
    'admin_request_capability',
    'admin_cancel_capability_request',
    'admin_capability_inbox',
    'admin_decide_capability_request',
    'admin_revoke_capability_grant',
  ]) {
    assert.ok(api.includes(`'${rpc}'`), `${rpc} is called from the client`);
  }

  const gate = await read('frontend/src/features/admin/access/CapabilityGate.tsx');
  assert.match(gate, /اطلب الصلاحية من المالك/, 'the locked screen offers an owner request');
  assert.match(gate, /formatRemaining/, 'temporary access shows its remaining time');

  const page = await read('frontend/src/features/admin/access/AdminAccountsPage.tsx');
  assert.match(page, /CapabilityGate capability="admin_accounts"/, 'the admins page is gated by the capability');
  assert.match(page, /OwnerCapabilityPanel/, 'the owner sees the approval inbox');
  assert.match(page, /AdminPasswordResetModal/, 'administrators can reset another administrator password');
  assert.doesNotMatch(page, /if \(!access\.data\?\.is_owner\) \{/, 'the page no longer hard-blocks non-owner admins');
});

test('admin capabilities: sidebar keeps locked owner pages visible to administrators', async () => {
  const sidebar = await read('frontend/src/components/layout/AppSidebar.tsx');
  assert.match(sidebar, /\(!item\.ownerOnly \|\| isOwner \|\| isAdmin\)/, 'owner-only pages stay visible to admins');
  assert.match(sidebar, /app-sidebar-item-lock/, 'locked pages render a lock affordance');
  const layout = await read('frontend/src/components/layout/MainLayout.tsx');
  assert.match(layout, /isAdmin=\{adminAccess\.data\?\.is_admin === true\}/);
});

test('admin capabilities: edge functions accept a granted administrator', async () => {
  for (const path of ['backend/supabase/functions/admin-invite/index.ts', 'backend/supabase/functions/admin-delete-account/index.ts']) {
    const source = await read(path);
    assert.match(source, /has_capability', \{ p_capability: 'admin_accounts' \}/, `${path} checks the capability`);
    assert.doesNotMatch(source, /!access\?\.is_owner\)/, `${path} no longer requires the owner role directly`);
  }
  const erasure = await read('backend/supabase/functions/owner-member-erasure/index.ts');
  assert.match(erasure, /owner_authority_until/, 'permanent erasure accepts a live full-owner window');
});
