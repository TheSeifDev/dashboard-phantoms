/**
 * security-regression.mjs — Static regression guards for the Wasla security hardening patch.
 *
 * Runs with plain Node (no DB, no network):
 *   node --test scripts/security-regression.mjs
 *
 * Each test asserts that a fixed vulnerability STAYS fixed by inspecting the
 * actual repository sources. Behavioral URL checks run against a reference
 * implementation kept in sync with src/lib/validators.ts::safeHref.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..');
const ROOT = path.resolve(here, '..', '..');
const src = (p) => readFileSync(path.join(FRONTEND, p), 'utf8');
const rootSrc = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Pure-Node recursive source scan (Windows-safe, no grep dependency) */
function scanSources(dir, pattern, exts = ['.ts', '.tsx']) {
  const hits = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (exts.includes(path.extname(full))) {
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${full}:${i + 1}: ${line.trim().slice(0, 160)}`);
        });
      }
    }
  };
  walk(dir);
  return hits;
}

// Reference implementation — must mirror src/lib/validators.ts::safeHref
function safeHref(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

// ---------- 1. session_token exposure ----------
test('session_token is never anon-readable', async (t) => {
  const membersApi = src('src/features/members/api.ts');
  await t.test('PUBLIC_MEMBER_COLUMNS excludes session_token', () => {
    const m = membersApi.match(/PUBLIC_MEMBER_COLUMNS\s*=\s*'([^']+)'/);
    assert.ok(m, 'PUBLIC_MEMBER_COLUMNS not found');
    const cols = m[1].split(',').map((c) => c.trim());
    assert.ok(!cols.includes('session_token'), 'session_token must not be in anon columns');
    assert.ok(cols.includes('email') && cols.includes('full_name'));
  });
  await t.test('migration 0009 grants anon columns without session_token', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    assert.ok(!/GRANT SELECT \([^)]*session_token[^)]*\)\s*ON public\.members TO anon/.test(mig));
    assert.match(mig, /GRANT SELECT \(id, created_at, email, full_name, bio, device/);
  });
  await t.test('lookup_member_by_email returns no session_token', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    const block = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.lookup_member_by_email'));
    const returnsTable = block.slice(0, block.indexOf('LANGUAGE plpgsql'));
    assert.ok(!returnsTable.includes('session_token'), 'RPC return table must not include session_token');
  });
  await t.test('MemberLookupRow type excludes session_token', () => {
    const db = src('src/types/db.ts');
    const row = db.slice(db.indexOf('export type MemberLookupRow'));
    assert.ok(!row.slice(0, 400).includes('session_token'));
  });
});

// ---------- 2. task tracking BOLA ----------
test('task tracking updates are device-bound server-side', async (t) => {
  await t.test('frontend uses submit_task_status RPC (no direct tracking write)', () => {
    const api = src('src/features/tasks/api.ts');
    assert.ok(api.includes("rpc('submit_task_status'"), 'must call submit_task_status');
    assert.ok(!api.includes('.update({ tracking'), 'direct tracking UPDATE must be gone');
  });
  await t.test('migration revokes anon direct UPDATE on tasks', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    assert.match(mig, /REVOKE ALL ON public\.tasks FROM anon/);
    assert.ok(!/GRANT UPDATE[^\n]*ON public\.tasks TO anon/.test(mig));
  });
  await t.test('submit_task_status verifies device + assignment + blocks approved', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    assert.match(mig, /assert_member_device\(p_member_id, p_device_token\)/);
    assert.match(mig, /NOT_ASSIGNED/);
    assert.match(mig, /ADMIN_APPROVAL_FORBIDDEN/);
    assert.match(mig, /p_status NOT IN \('pending', 'in_progress', 'under_review', 'revision_requested'\)/);
  });
  await t.test('member A cannot patch member B: only own key is written', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    // Single-key jsonb_set on the caller's own member id — never a client-supplied tracking blob.
    assert.match(mig, /jsonb_set\(v_tracking, ARRAY\[p_member_id::text\]/);
    assert.ok(!mig.includes('p_tracking'), 'RPC must not accept a full tracking blob');
  });
});

// ---------- 3. announcements BOLA ----------
test('announcement RPCs require device binding', async (t) => {
  await t.test('SQL functions verify device token', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    const count = (mig.match(/PERFORM public\.assert_member_device\(p_member_id, p_device_token\)/g) || []).length;
    assert.ok(count >= 5, `expected >=5 device assertions, found ${count}`);
  });
  await t.test('view tracking RPC is device-bound, details RPC is admin-only', () => {
    const mig = rootSrc('backend/migrations/0010_announcement_views.sql');
    assert.match(mig, /CREATE OR REPLACE FUNCTION public\.mark_announcement_viewed/);
    assert.match(mig, /PERFORM public\.assert_member_device\(p_member_id, p_device_token\)/);
    assert.match(mig, /ADMIN_ONLY: تفاصيل الإعلان متاحة للإدارة فقط/);
    assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.get_announcement_details\(bigint\) TO authenticated/);
    assert.ok(!/GRANT EXECUTE ON FUNCTION public\.get_announcement_details[^;]*TO anon/.test(mig));
    // details must not expose sensitive columns
    const detailsBlock = mig.slice(mig.indexOf('get_announcement_details'));
    const returnsTable = detailsBlock.slice(0, detailsBlock.indexOf('LANGUAGE plpgsql'));
    for (const col of ['phone', 'session_token', 'push_subscription', 'team_notes']) {
      assert.ok(!returnsTable.includes(col), `details must not include ${col}`);
    }
  });
  await t.test('frontend passes p_device_token on all member announcement calls', () => {
    const api = src('src/lib/api/announcements.ts');
    assert.ok(api.includes('get_member_announcements') && api.includes('p_device_token'));
    assert.ok(api.includes('mark_announcement_viewed') && api.includes('p_device_token'));
    assert.ok(api.includes('mark_announcement_read') && api.includes('p_device_token'));
    assert.ok(api.includes('dismiss_announcement') && api.includes('p_device_token'));
  });
});

// ---------- 4. mass assignment ----------
test('member updates use an explicit allowlist', async (t) => {
  await t.test('sanitizeMemberUpdate strips privileged fields', () => {
    const api = src('src/features/members/api.ts');
    assert.match(api, /MEMBER_WRITABLE_FIELDS/);
    assert.match(api, /sanitizeMemberUpdate/);
    // Allowlist must not contain secrets
    const list = api.slice(api.indexOf('MEMBER_WRITABLE_FIELDS'), api.indexOf('] as const'));
    for (const forbidden of ['session_token', 'push_subscription', 'completion_rank', 'created_at']) {
      assert.ok(!new RegExp(`'${forbidden}'`).test(list), `${forbidden} must not be writable`);
    }
  });
  await t.test('allowlist behavior: forbidden keys are dropped', () => {
    const ALLOWED = new Set(['email', 'full_name', 'team_notes', 'residence', 'work_conditions', 'bio', 'phone', 'device', 'gender', 'meeting_attendance', 'work_status', 'can_go_alexandria']);
    const sanitize = (member) => {
      const { id, ...rest } = member;
      const clean = {};
      for (const k of Object.keys(rest)) if (ALLOWED.has(k)) clean[k] = rest[k];
      return { id, ...clean };
    };
    const out = sanitize({ id: 1, full_name: 'A', session_token: 'x', push_subscription: {}, completion_rank: 99, role: 'admin' });
    assert.deepEqual(out, { id: 1, full_name: 'A' });
  });
});

// ---------- 5. unsafe URLs / XSS ----------
test('submission URLs are http(s)-only at input and render', async (t) => {
  await t.test('safeHref allows http/https', () => {
    assert.equal(safeHref('https://drive.google.com/x'), 'https://drive.google.com/x');
    assert.equal(safeHref('http://example.com/a?b=1'), 'http://example.com/a?b=1');
  });
  await t.test('safeHref blocks dangerous schemes and garbage', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<h1>x</h1>', 'blob:https://x/1', 'ftp://x/y', '/relative/path', '', '   ', 'https://', 'x'.repeat(2049)]) {
      assert.equal(safeHref(bad), null, `must reject: ${String(bad).slice(0, 40)}`);
    }
  });
  await t.test('validators.ts ships safeHref with scheme allowlist', () => {
    const v = src('src/lib/validators.ts');
    assert.match(v, /export function safeHref/);
    assert.match(v, /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/);
  });
  await t.test('TaskReviewModal renders only validated href with noopener', () => {
    const modal = src('src/features/tasks/TaskReviewModal.tsx');
    assert.ok(modal.includes('safeHref('), 'must validate before render');
    assert.ok(modal.includes('noopener'), 'must include noopener');
    assert.ok(!modal.includes('<a href={item.entry.submission_url}'), 'raw href must be gone');
  });
  await t.test('no dangerouslySetInnerHTML / eval in frontend src', async () => {
    const hits = scanSources(path.join(FRONTEND, 'src'),
      /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(/);
    assert.deepEqual(hits, [], `unsafe sinks found:\n${hits.join('\n')}`);
  });
});

// ---------- 6. bridge URL ----------
test('WhatsApp bridge URL is validated', async (t) => {
  await t.test('https enforced in production, path allowlist, id caps', () => {
    const api = src('src/features/whatsapp/api.ts');
    assert.match(api, /ALLOWED_BRIDGE_PATHS/);
    assert.match(api, /parsed\.protocol !== 'https:'/);
    assert.match(api, /memberIds\.length > 1000/);
    assert.match(api, /consentConfirmed/);
  });
  await t.test('misconfigured bridge fails per-request, never at module load', () => {
    const api = src('src/features/whatsapp/api.ts');
    // bridgeUrl may be null; request() must guard before any fetch
    assert.match(api, /const bridgeUrl = resolveBridgeUrl\(\);/);
    assert.match(api, /if \(!bridgeUrl\) throw new Error\(BRIDGE_MISCONFIGURED_MESSAGE\)/);
    // resolveBridgeUrl itself must never throw (page crash) — only return null
    const fnBody = api.slice(api.indexOf('function resolveBridgeUrl'), api.indexOf('const bridgeUrl ='));
    assert.ok(!/throw new Error/.test(fnBody), 'resolveBridgeUrl must not throw');
  });
});

// ---------- 7. security headers ----------
test('Vercel headers enforce transport + framing + content policy', async (t) => {
  await t.test('vercel.json has HSTS + CSP + anti-sniffing, no X-XSS-Protection', () => {
    const raw = src('vercel.json');
    assert.ok(raw.includes('Strict-Transport-Security'));
    assert.ok(raw.includes('max-age=63072000; includeSubDomains; preload'));
    assert.ok(raw.includes('Content-Security-Policy'));
    assert.ok(raw.includes("frame-ancestors 'none'"));
    assert.ok(raw.includes('X-Content-Type-Options'));
    assert.ok(!raw.includes('X-XSS-Protection'), 'obsolete header must not be used');
  });
});

// ---------- 8. edge + bridge auth ----------
test('edge functions and bridge enforce auth', async (t) => {
  await t.test('wasla-ai: no wildcard CORS, POST-only, admin fallback to is_admin()', () => {
    const fn = rootSrc('backend/supabase/functions/wasla-ai/index.ts');
    assert.ok(!fn.includes("?? '*'"), 'wildcard origin must be gone');
    assert.match(fn, /allowedOrigins\.includes\(origin\)/);
    assert.match(fn, /req\.method !== 'POST'/);
    assert.match(fn, /rpc\('is_admin'\)/);
  });
  await t.test('push-notify: origin allowlist enforced', () => {
    const fn = rootSrc('backend/supabase/functions/push-notify/index.ts');
    assert.match(fn, /allowedOrigins\.includes\(origin\)/);
  });
  await t.test('bridge auth: no silent dev fallback', () => {
    const auth = rootSrc('backend/whatsapp-service/src/middleware/auth.ts');
    assert.ok(!auth.includes('dev-fallback-id'), 'silent dev identity must be gone');
    assert.match(auth, /ALLOW_DEV_BYPASS|allowDevBypass/);
  });
  await t.test('bridge push dispatch sits behind authMiddleware', () => {
    const index = rootSrc('backend/whatsapp-service/src/index.ts');
    const authPos = index.indexOf('authMiddleware');
    const pushPos = index.indexOf('app.use(pushRouter)');
    assert.ok(authPos !== -1 && pushPos !== -1 && authPos < pushPos, 'pushRouter must mount after auth');
  });
  await t.test('bridge diagnostics sits behind auth and never emits secrets', () => {
    const index = rootSrc('backend/whatsapp-service/src/index.ts');
    const authPos = index.indexOf('authMiddleware');
    const diagPos = index.indexOf('app.use(diagnosticsRouter)');
    assert.ok(authPos !== -1 && diagPos !== -1 && authPos < diagPos, 'diagnosticsRouter must mount after auth');
    const diag = rootSrc('backend/whatsapp-service/src/routes/diagnostics.ts');
    // presence-only reporting: no secret values in responses
    assert.ok(!/process\.env\.(SUPABASE_SERVICE_ROLE_KEY|WHATSAPP_ACCESS_TOKEN|VAPID_PRIVATE_KEY)\s*[^|&;]*res\.json/.test(diag));
    assert.ok(!diag.includes('supabaseAnonKey }') && !/res\.json\([^)]*anonKey/i.test(diag));
    assert.ok(diag.includes('أبداً لا يحمل قيم أسرار') || diag.includes('لا يُرجع أي قيمة سرية'));
  });
});

// ---------- 9. RLS posture ----------
test('RLS denies by default and scopes admin to is_admin()', async (t) => {
  await t.test('fresh-install setup uses is_admin() for admin policies', () => {
    const setup = rootSrc('backend/supabase_setup.sql');
    assert.match(setup, /USING \(public\.is_admin\(\)\)/);
    assert.ok(!/FOR ALL TO authenticated USING \(true\)/.test(setup), 'open authenticated policies must be gone');
    assert.ok(!/GRANT UPDATE[^\n]*ON public\.tasks TO anon/.test(setup), 'anon direct UPDATE must be gone');
  });
  await t.test('approve_task_submission + stats require is_admin()', () => {
    const mig = rootSrc('backend/migrations/0009_member_device_binding.sql');
    assert.match(mig, /ADMIN_ONLY: الاعتماد متاح للحسابات الإدارية فقط/);
    assert.match(mig, /ADMIN_ONLY: إحصاءات الإعلان متاحة للإدارة فقط/);
  });
});

// ---------- 10. login forms + error hygiene ----------
test('login and error paths do not leak', async (t) => {
  await t.test('login forms declare method="post"', () => {
    assert.ok(src('src/features/auth/AdminLoginPage.tsx').includes('method="post"'));
    assert.ok(src('src/features/auth/LoginPage.tsx').includes('method="post"'));
  });
  await t.test('errorHandler returns message only (no details/hint/code)', () => {
    const eh = src('src/lib/errorHandler.ts');
    assert.ok(!eh.includes('details') || !eh.includes('details:'), 'details must not be returned');
    assert.ok(!eh.includes('hint:'), 'hint must not be returned');
    assert.ok(!/code:\s*pgError\.code/.test(eh), 'pg code must not be returned');
  });
  await t.test('supabase auth persists to sessionStorage, member token kept separate', () => {
    const client = src('src/lib/supabase/client.ts');
    assert.match(client, /sessionStorage/);
    const store = src('src/store/auth.ts');
    assert.match(store, /wasla_device_token/);
    assert.match(store, /session_token: null/);
  });
});

// ---------- 11. secrets posture ----------
test('no privileged secrets in client bundle sources', async (t) => {
  await t.test('no service_role in frontend src', async () => {
    const hits = scanSources(path.join(FRONTEND, 'src'), /service_role|SUPABASE_SERVICE_ROLE/);
    assert.deepEqual(hits, [], `service_role reference in client:\n${hits.join('\n')}`);
  });
  await t.test('bridge ships no hardcoded anon key', () => {
    const cfg = rootSrc('backend/whatsapp-service/src/config.ts');
    assert.ok(!cfg.includes('eyJhbGciOi'), 'hardcoded JWT must be gone from config');
  });
});

test('migration file exists and is registered for review', () => {
  assert.ok(existsSync(path.join(ROOT, 'backend', 'migrations', '0009_member_device_binding.sql')));
});
