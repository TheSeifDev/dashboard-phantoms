import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const sql = await readFile(new URL('../supabase/migrations/20261120074723_internal_team_access_hardening.sql', import.meta.url), 'utf8');
const pgTap = await readFile(new URL('../supabase/tests/database/19_internal_team_access_hardening.test.sql', import.meta.url), 'utf8');

test('seat trigger protects both direct assignment and atomic replacement', () => {
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.team_admin_assignments/);
  assert.match(sql, /SELECT 1 FROM public\.admin_accounts WHERE user_id = NEW\.user_id/);
  assert.match(sql, /TEAM_ADMIN_REQUIRES_NON_GLOBAL_ACCOUNT/);
  assert.doesNotMatch(sql, /INSERT INTO public\.admin_accounts|DELETE FROM auth\.users/i);
});

test('membership review rejects NULL and rechecks active team and authenticated actor', () => {
  assert.match(sql, /p_decision IS NULL OR p_decision NOT IN/);
  assert.match(sql, /auth\.uid\(\) IS NULL/);
  assert.match(sql, /WHERE id = p_team_id AND is_active FOR SHARE/);
  assert.match(sql, /SELF_REVIEW_FORBIDDEN/);
  assert.doesNotMatch(sql, /UPDATE public\.members|UPDATE auth\.users/i);
});

test('12 database assertions test non-vacuous cross-account and state rejection', () => {
  assert.match(pgTap, /SELECT plan\(12\)/);
  assert.equal([...pgTap.matchAll(/^SELECT (ok|is|throws_ok|lives_ok)\(/gm)].length, 12);
  assert.match(pgTap, /direct assignment rejects a global Admin/);
  assert.match(pgTap, /NULL decision fails closed/);
  assert.match(pgTap, /other team membership remains active and untouched/);
});
