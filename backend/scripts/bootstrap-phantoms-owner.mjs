#!/usr/bin/env node
/**
 * =========================================================================
 * PHANTOMS — Initial Owner Bootstrap Procedure
 * =========================================================================
 * Safely provisions the initial Owner in `public.admin_accounts` using an
 * explicit environment variable: `PHANTOMS_INITIAL_OWNER_ID`.
 *
 * Requirements:
 *   - PHANTOMS_INITIAL_OWNER_ID must be supplied in environment.
 *   - Default mode is PREVIEW (dry-run). Pass `--execute` to apply changes.
 *   - Validates existence and email confirmation in auth.users.
 *   - Verifies `public.admin_accounts` table existence.
 *   - Enforces single-owner invariant (stops if another owner exists).
 *   - Idempotent if the same account is already Owner.
 *   - Zero credential printing.
 * =========================================================================
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OWNER_UUID = process.env.PHANTOMS_INITIAL_OWNER_ID?.trim();
const EXECUTE_MODE = process.argv.includes('--execute');

const FULL_PERMISSIONS = {
  dashboard: true,
  members: true,
  tasks: true,
  ranking: true,
  notes: true,
  announcements: true,
  whatsapp: true,
  ai_assistant: true,
};

console.log('\n===============================================================');
console.log('       PHANTOMS — SECURE OWNER BOOTSTRAP PROCEDURE');
console.log('===============================================================\n');

if (!OWNER_UUID) {
  console.error('❌ ERROR: Missing required environment variable: PHANTOMS_INITIAL_OWNER_ID');
  console.error('   Please run with:');
  console.error('     $env:PHANTOMS_INITIAL_OWNER_ID="<your-auth-uuid>"; node backend/scripts/bootstrap-phantoms-owner.mjs\n');
  process.exit(1);
}

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID_REGEX.test(OWNER_UUID)) {
  console.error('❌ ERROR: PHANTOMS_INITIAL_OWNER_ID is not a valid UUID format.');
  process.exit(1);
}

// Load Supabase credentials from local environment files
function getEnvCredentials() {
  const candidatePaths = [
    resolve(__dirname, '..', 'whatsapp-service', '.env'),
    resolve(__dirname, '..', '..', 'frontend', '.env.local'),
    resolve(__dirname, '..', '..', 'frontend', '.env.production'),
    resolve(__dirname, '..', '..', 'frontend', '.env'),
  ];

  let supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  let serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) {
          const key = m[1].trim();
          const val = m[2].trim().replace(/^["']|["']$/g, '');
          if (!supabaseUrl && (key === 'VITE_SUPABASE_URL' || key === 'SUPABASE_URL')) {
            supabaseUrl = val;
          }
          if (!serviceKey && (key === 'SUPABASE_SECRET_KEY' || key === 'SUPABASE_SERVICE_ROLE_KEY')) {
            serviceKey = val;
          }
        }
      }
    }
  }

  return { supabaseUrl, serviceKey };
}

const { supabaseUrl, serviceKey } = getEnvCredentials();

if (!supabaseUrl || !serviceKey) {
  console.error('❌ ERROR: Could not locate Supabase URL or Service Key in environment.');
  console.error('   Ensure SUPABASE_SECRET_KEY and SUPABASE_URL are set.');
  process.exit(1);
}

async function runBootstrap() {
  console.log(`Target Supabase URL: ${supabaseUrl}`);
  console.log(`Target Owner UUID  : ${OWNER_UUID}`);
  console.log(`Execution Mode     : ${EXECUTE_MODE ? '🔴 LIVE EXECUTION' : '🟡 PREVIEW (DRY-RUN)'}\n`);

  // 1. Verify user exists in Auth
  console.log('1. Checking user existence in Supabase Auth...');
  const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${OWNER_UUID}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!userRes.ok) {
    if (userRes.status === 404) {
      console.error(`❌ ERROR: User UUID ${OWNER_UUID} not found in Supabase Auth.`);
    } else {
      console.error(`❌ ERROR: Auth API returned status ${userRes.status}.`);
    }
    process.exit(1);
  }

  const authUser = await userRes.json();
  const maskedEmail = authUser.email ? authUser.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '[no email]';
  console.log(`   ✔ User found in Auth: ${maskedEmail}`);

  // 2. Verify email is confirmed
  console.log('2. Verifying email confirmation status...');
  if (!authUser.email_confirmed_at) {
    console.error(`❌ ERROR: User email (${maskedEmail}) is unconfirmed. Please confirm the user in Supabase Auth first.`);
    process.exit(1);
  }
  console.log(`   ✔ Email confirmed at: ${authUser.email_confirmed_at}`);

  // 3. Verify public.admin_accounts exists
  console.log('3. Checking public.admin_accounts table...');
  const tableCheckRes = await fetch(`${supabaseUrl}/rest/v1/admin_accounts?select=user_id,role&limit=5`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!tableCheckRes.ok) {
    if (tableCheckRes.status === 404) {
      console.error('❌ ERROR: Table public.admin_accounts does not exist.');
      console.error('   Please run all database migrations first before bootstrapping the owner.');
    } else {
      console.error(`❌ ERROR: Database check failed with status ${tableCheckRes.status}.`);
    }
    process.exit(1);
  }

  const existingAccounts = await tableCheckRes.json();
  console.log(`   ✔ Table public.admin_accounts exists (${existingAccounts.length} existing account(s))`);

  // 4. Check for conflicting existing owner
  console.log('4. Enforcing single-owner invariant...');
  const existingOwner = existingAccounts.find((a) => a.role === 'owner');

  if (existingOwner) {
    if (existingOwner.user_id === OWNER_UUID) {
      console.log(`   ✔ IDEMPOTENT: Account ${OWNER_UUID} is ALREADY registered as the system Owner.`);
      console.log('\n===============================================================');
      console.log('VERDICT: No action needed. Owner configuration is already active.');
      console.log('===============================================================\n');
      process.exit(0);
    } else {
      console.error(`❌ ERROR: A conflicting Owner already exists (UUID: ${existingOwner.user_id}).`);
      console.error('   Aborting to preserve the single-owner security constraint.');
      process.exit(1);
    }
  }
  console.log('   ✔ Zero existing Owners found. Ready to bootstrap initial Owner.');

  // 5. Preview or Execute
  console.log('\n5. Target Owner Record to Provision:');
  const payload = {
    user_id: OWNER_UUID,
    role: 'owner',
    created_by: null,
    permissions: FULL_PERMISSIONS,
  };
  console.log(JSON.stringify(payload, null, 2));

  if (!EXECUTE_MODE) {
    console.log('\n===============================================================');
    console.log('🟡 PREVIEW COMPLETE: All pre-conditions passed.');
    console.log('   To apply this bootstrap record, run:');
    console.log('     $env:PHANTOMS_INITIAL_OWNER_ID="' + OWNER_UUID + '"; node backend/scripts/bootstrap-phantoms-owner.mjs --execute');
    console.log('===============================================================\n');
    return;
  }

  // 6. Execute Insert
  console.log('\nApplying Owner bootstrap record...');
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/admin_accounts`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.error(`❌ ERROR: Failed to insert Owner record (${insertRes.status}): ${errText}`);
    process.exit(1);
  }

  console.log('✔ Initial Owner account successfully bootstrapped in public.admin_accounts!');
  console.log('\n===============================================================');
  console.log('✅ BOOTSTRAP COMPLETE: System Owner successfully configured.');
  console.log('===============================================================\n');
}

runBootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err.message);
  process.exit(1);
});
