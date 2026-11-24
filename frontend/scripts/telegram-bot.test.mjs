import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const read = (relative) => readFileSync(resolve(repoRoot, relative), 'utf8');

const page = read('frontend/src/features/telegram/TelegramPage.tsx');
const api = read('frontend/src/features/telegram/api.ts');
const card = read('frontend/src/features/telegram/MemberTelegramCard.tsx');
const router = read('frontend/src/router/index.tsx');
const sidebar = read('frontend/src/components/layout/AppSidebar.tsx');
const bot = read('backend/supabase/functions/telegram-bot/index.ts');
const migration = read('backend/supabase/migrations/20261124120000_telegram_bot.sql');
const runtime = read('backend/supabase/migrations/20261124120100_telegram_bot_runtime.sql');

test('the Telegram bot page replaces the WhatsApp route', () => {
  assert.match(router, /features\/telegram\/TelegramPage/);
  assert.match(router, /path: 'telegram'[\s\S]*?permission="whatsapp"/);
  assert.match(router, /path: 'whatsapp'[\s\S]*?Navigate to="\/admin\/telegram"/);
  assert.doesNotMatch(router, /WhatsAppTasksPage/);
  assert.match(sidebar, /to: '\/admin\/telegram'/);
  assert.doesNotMatch(sidebar, /\/admin\/whatsapp/);
});

test('the admin page covers setup, linking, events, broadcast and delivery log', () => {
  for (const marker of ['telegram_save_settings', 'telegram_send_test', 'telegram_broadcast', 'telegram_outbox_list']) {
    assert.ok(api.includes(marker), `missing RPC hook ${marker}`);
  }
  assert.match(page, /تفعيل الويبهوك/);
  assert.match(page, /TELEGRAM_EVENT_LABELS/);
  assert.match(page, /سجل الإرسال/);
  assert.match(api, /sync-auth/);
  assert.match(bot, /action === 'sync-auth'/);
});

test('members can link themselves from the portal settings', () => {
  assert.match(card, /useCreateTelegramLinkCode/);
  assert.match(card, /\/start \{code\.code\}/);
  assert.match(read('frontend/src/features/members/MemberSettingsPage.tsx'), /MemberTelegramCard/);
});

test('the bot answers every dashboard surface', () => {
  for (const command of [
    '/me', '/tasks', '/points', '/ranking', '/announcements', '/meetings',
    '/ledger', '/refs', '/evals', '/strikes', '/team', '/projects', '/requests',
    '/stats', '/broadcast', '/mute', '/unmute', '/unlink',
  ]) {
    assert.ok(bot.includes(`case '${command}'`) || bot.includes(`case '${command}':`), `missing ${command}`);
  }
  assert.match(bot, /x-telegram-bot-api-secret-token/);
  assert.match(bot, /telegram_claim_outbox/);
  assert.match(bot, /callback_query/);
});

test('every event feeds a durable outbox before delivery', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.telegram_outbox/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.telegram_links/);
  assert.match(migration, /REVOKE ALL ON public\.telegram_settings FROM PUBLIC, anon, authenticated/);
  for (const kind of ['task', 'announcement', 'evaluation', 'strike', 'meeting', 'ledger', 'reference', 'project', 'capability', 'account', 'bonus', 'note']) {
    assert.ok(runtime.includes(`'${kind}'`), `no trigger enqueues ${kind}`);
  }
  assert.match(runtime, /CREATE TRIGGER telegram_task_created/);
  assert.match(runtime, /CREATE TRIGGER telegram_ledger_event/);
  assert.match(runtime, /cron\.schedule\('phantoms-telegram-drain'/);
  assert.match(runtime, /net\.http_post/);
});

test('owner decisions happen through the bot without weakening the guards', () => {
  assert.match(runtime, /CREATE OR REPLACE FUNCTION public\.telegram_decide_request/);
  assert.match(runtime, /OWNER_ONLY/);
  assert.match(runtime, /is_owner_role\(p_actor\)/);
  assert.match(runtime, /LEAST\(GREATEST\(COALESCE\(p_minutes, 60\), 15\), 43200\)/);
});
