#!/usr/bin/env node
/**
 * PHANTOMS initial Owner bootstrap.
 *
 * Safe default: preview only. `--execute` is the sole write path.
 * Requires an explicit project reference and a server-side Supabase key.
 * Never use a frontend publishable/anon key with this procedure.
 */
const EXPECTED_PROJECT_REF = 'cbuiwgrmsmsidyjhzvla';
const OWNER_UUID = process.env.PHANTOMS_INITIAL_OWNER_ID?.trim();
const TARGET_PROJECT = process.env.PHANTOMS_SUPABASE_PROJECT_REF?.trim();
const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
const EXECUTE_MODE = process.argv.includes('--execute');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FULL_PERMISSIONS = {
  dashboard: true, members: true, tasks: true, ranking: true,
  notes: true, announcements: true, whatsapp: true, ai_assistant: true,
};

function fail(message) { console.error(`ERROR: ${message}`); process.exit(1); }
if (!OWNER_UUID || !UUID_REGEX.test(OWNER_UUID)) fail('PHANTOMS_INITIAL_OWNER_ID must be a valid UUID.');
if (!TARGET_PROJECT) fail(`PHANTOMS_SUPABASE_PROJECT_REF is required and must equal ${EXPECTED_PROJECT_REF}.`);
if (TARGET_PROJECT !== EXPECTED_PROJECT_REF) fail('Refusing to run against an unexpected Supabase project.');
if (!SUPABASE_URL) fail('SUPABASE_URL (or VITE_SUPABASE_URL) is required.');
if (!SERVICE_KEY || /^sb_publishable_|^eyJ/.test(SERVICE_KEY)) fail('A server-side Supabase service key is required; publishable/anon keys are refused.');
let parsedUrl;
try { parsedUrl = new URL(SUPABASE_URL); } catch { fail('SUPABASE_URL is not a valid URL.'); }
if (parsedUrl.hostname.split('.')[0] !== EXPECTED_PROJECT_REF) fail('SUPABASE_URL project reference does not match the approved target.');

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* intentionally omit non-JSON response */ }
  return { response, body };
}

console.log(`PHANTOMS Owner bootstrap — project ${EXPECTED_PROJECT_REF}`);
console.log(`Mode: ${EXECUTE_MODE ? 'EXECUTE' : 'PREVIEW'}`);
console.log('Checking target Auth user and database owner invariant...');
const auth = await request(`/auth/v1/admin/users/${OWNER_UUID}`);
if (!auth.response.ok) fail(auth.response.status === 404 ? 'Target Auth user was not found.' : `Auth lookup failed (${auth.response.status}).`);
if (!auth.body?.email_confirmed_at) fail('Target Auth user email is not confirmed.');

const accounts = await request('/rest/v1/admin_accounts?role=eq.owner&select=user_id,role&limit=2');
if (!accounts.response.ok) fail(`Could not read public.admin_accounts (${accounts.response.status}). Run all migrations first.`);
const owners = Array.isArray(accounts.body) ? accounts.body : [];
if (owners.length > 1) fail('More than one Owner exists; refusing to continue.');
if (owners[0] && owners[0].user_id !== OWNER_UUID) fail('A different Owner already exists; refusing to continue.');
if (owners[0]?.user_id === OWNER_UUID) {
  console.log('Owner already exists for the target Auth user. No action needed.');
  process.exit(0);
}

const payload = { user_id: OWNER_UUID, role: 'owner', created_by: null, permissions: FULL_PERMISSIONS };
console.log('Preconditions passed. Target record contains the final eight permission keys.');
if (!EXECUTE_MODE) {
  console.log('PREVIEW COMPLETE — rerun with --execute only after reviewing the target project and migration state.');
  process.exit(0);
}
const inserted = await request('/rest/v1/admin_accounts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify(payload),
});
if (!inserted.response.ok) fail(`Owner insert failed (${inserted.response.status}).`);
console.log('Owner bootstrap completed successfully.');
