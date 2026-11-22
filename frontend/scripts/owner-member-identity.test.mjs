import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const loginPage = read('src/features/auth/LoginPage.tsx');
const accessModule = read('src/features/auth/member-password-access.ts');
const databaseTypes = read('src/types/db.ts');
const migration = read('../backend/supabase/migrations/20261122070000_owner_member_identity.sql');
const manifest = JSON.parse(read('../backend/supabase/forward-migration-manifest.json'));

test('member login provisions the owner identity before reporting a missing membership', () => {
  const ensureIndex = loginPage.indexOf('const ownerIdentity = await ensureOwnerMemberIdentity();');
  const notFoundIndex = loginPage.indexOf("throw new MemberLoginError('MEMBER_NOT_FOUND');");
  assert.ok(ensureIndex > 0, 'the login flow must call the owner identity RPC');
  assert.ok(notFoundIndex > ensureIndex, 'the owner identity must be attempted before MEMBER_NOT_FOUND');
  assert.match(loginPage, /if \(ownerIdentity\) access = await getMemberPasswordAccess\(\);/);
  assert.match(loginPage, /import \{ ensureOwnerMemberIdentity, getMemberPasswordAccess, isMemberPendingReview \}/);
});

test('the owner identity helper validates the RPC payload strictly', () => {
  assert.match(accessModule, /export async function ensureOwnerMemberIdentity\(\)/);
  assert.match(accessModule, /memberSupabase\.rpc\('ensure_owner_member_identity'\)/);
  assert.match(accessModule, /Number\.isSafeInteger\(memberId\)/);
  assert.match(databaseTypes, /ensure_owner_member_identity: \{ Args: never; Returns: \{ member_id: number; email: string; created: boolean \} \| null \};/);
});

test('the access RPC no longer excludes Admin accounts and only requires a real binding', () => {
  const access = migration.slice(migration.indexOf('FUNCTION public.get_member_password_access()'));
  const body = access.slice(0, access.indexOf('$$;'));
  assert.doesNotMatch(body, /is_admin\(\)/);
  assert.match(body, /IF auth\.uid\(\) IS NULL THEN RETURN NULL; END IF;/);
  assert.match(body, /FROM public\.member_auth_bindings AS b/);
  const pending = migration.slice(migration.indexOf('FUNCTION public.get_member_pending_review()'));
  assert.doesNotMatch(pending.slice(0, pending.indexOf('$$;')), /is_admin\(\)/);
});

test('the owner identity RPC is Owner-only, self-scoped, and idempotent', () => {
  const fn = migration.slice(migration.indexOf('FUNCTION public.ensure_owner_member_identity()'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  assert.match(body, /IF NOT public\.is_owner\(\) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;/);
  assert.match(body, /FROM auth\.users AS u\s+WHERE u\.id = v_uid/);
  assert.match(body, /auth\.jwt\(\) ->> 'email'/);
  assert.match(body, /ON CONFLICT \(member_id\) DO UPDATE/);
  assert.match(body, /'created', v_created/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ensure_owner_member_identity\(\) FROM PUBLIC, anon;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ensure_owner_member_identity\(\) TO authenticated;/);
});

test('the migration is registered as applied in the forward ledger', () => {
  const entry = manifest.find((item) => item.version === '20261122070000');
  assert.ok(entry, 'the owner identity migration must be registered');
  assert.equal(entry.name, 'owner_member_identity');
  assert.equal(entry.production_status, 'applied');
  assert.equal(entry.remote_applied_timestamp, '20261122071803');
  assert.equal(entry.canonical_repository_filename, 'backend/supabase/migrations/20261122070000_owner_member_identity.sql');
});
