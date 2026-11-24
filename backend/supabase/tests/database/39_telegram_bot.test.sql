-- 39 — Telegram team bot: settings, linking, outbox, event triggers and the
-- owner decisions the bot performs on behalf of a chat.
BEGIN;
\ir _helpers.psql
SELECT plan(42);

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['tg_owner', 'tg_admin', 'tg_member', 'tg_other']) AS n;
  PERFORM phantoms_test.grant_admin('tg_owner', 'owner');
  PERFORM phantoms_test.grant_admin('tg_admin', 'admin');
END $$;

INSERT INTO public.members (email, full_name, academic_number)
VALUES ('tg-member@phantoms-test.example', 'Telegram Member', 'TG-001')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
SELECT m.id, phantoms_test.uid('tg_member'), m.email, true
FROM public.members AS m WHERE m.email = 'tg-member@phantoms-test.example'
ON CONFLICT DO NOTHING;

-- 1) الجداول والصلاحيات -------------------------------------------------------
SELECT has_table('public', 'telegram_settings', 'telegram_settings exists');
SELECT has_table('public', 'telegram_links', 'telegram_links exists');
SELECT has_table('public', 'telegram_link_codes', 'telegram_link_codes exists');
SELECT has_table('public', 'telegram_outbox', 'telegram_outbox exists');
SELECT has_table('public', 'telegram_updates', 'telegram_updates exists');
SELECT has_table('public', 'telegram_command_audit', 'telegram_command_audit exists');
SELECT is((SELECT count(*)::int FROM public.telegram_settings), 1, 'settings stay a single row');

SELECT phantoms_test.login_as('tg_member');
SELECT throws_ok($$SELECT count(*) FROM public.telegram_links$$, '42501', NULL,
  'authenticated cannot read telegram_links directly');
SELECT throws_ok($$SELECT count(*) FROM public.telegram_outbox$$, '42501', NULL,
  'authenticated cannot read telegram_outbox directly');
SELECT throws_ok($$SELECT bot_token FROM public.telegram_settings$$, '42501', NULL,
  'the bot token is never readable through the Data API');

-- 2) حراسة RPCs الإدارة -------------------------------------------------------
SELECT throws_ok($$SELECT public.telegram_admin_state()$$, 'P0001', NULL,
  'a plain member cannot read the bot state');
SELECT throws_ok($$SELECT public.telegram_save_settings('{}'::jsonb)$$, 'P0001', NULL,
  'a plain member cannot save bot settings');
SELECT throws_ok($$SELECT public.telegram_broadcast('hi')$$, 'P0001', NULL,
  'a plain member cannot broadcast');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('tg_admin');
SELECT lives_ok($$SELECT public.telegram_admin_state()$$,
  'an admin with the messaging permission reads the bot state');
SELECT lives_ok($$SELECT public.telegram_save_settings('{"enabled": true, "bot_token": "123:TEST", "bot_username": "phantoms_test_bot"}'::jsonb)$$,
  'the admin enables the bot and stores a token');
SELECT is((public.telegram_admin_state() ->> 'configured')::boolean, true,
  'the state reports a stored token');
SELECT is((public.telegram_admin_state() ->> 'has_token')::boolean, true,
  'the state never leaks the token but reports its presence');

-- 3) ربط الشات ---------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
INSERT INTO public.telegram_link_codes (code, user_id, expires_at)
VALUES ('TESTCODE', phantoms_test.uid('tg_member'), now() + INTERVAL '20 minutes');
SELECT is((public.telegram_link_chat('TESTCODE', 555001, 'tg_member_handle', 'Telegram') ->> 'ok')::boolean, true,
  'a valid code links the chat');
SELECT is((SELECT count(*)::int FROM public.telegram_links WHERE chat_id = 555001 AND revoked_at IS NULL), 1,
  'the link is stored once');
SELECT is((public.telegram_link_chat('TESTCODE', 555002, NULL, NULL) ->> 'error'), 'INVALID_CODE',
  'a used code cannot be replayed');
SELECT is((public.telegram_bot_context(555001) ->> 'linked')::boolean, true,
  'the bot resolves a linked chat');
SELECT is((public.telegram_bot_context(555001) ->> 'member_id')::bigint,
  (SELECT member_id FROM public.telegram_links WHERE chat_id = 555001),
  'the bot context carries the member id');
SELECT is((public.telegram_bot_context(999) ->> 'linked')::boolean, false,
  'an unknown chat is reported as unlinked');

-- 4) الصادر والإشعارات -------------------------------------------------------
SELECT is((public.telegram_enqueue(phantoms_test.uid('tg_member'), 'test', 'hello', '{}'::jsonb, 'tg:test:1')) IS NOT NULL,
  true, 'an enabled bot queues a message for a linked chat');
SELECT is((public.telegram_enqueue(phantoms_test.uid('tg_member'), 'test', 'hello', '{}'::jsonb, 'tg:test:1')) IS NULL,
  true, 'the dedupe key stops a duplicate');
SELECT is((public.telegram_enqueue(phantoms_test.uid('tg_other'), 'test', 'nobody', '{}'::jsonb, NULL)) IS NULL,
  true, 'an unlinked user gets nothing queued');

INSERT INTO public.tasks (title, assigned_to, tracking, has_deadline)
VALUES ('Telegram task', to_jsonb('ALL'::text), '{}'::jsonb, false);
SELECT ok((SELECT count(*) FROM public.telegram_outbox WHERE kind = 'task') >= 1,
  'a new task reaches the outbox through the trigger');

INSERT INTO public.announcements (title, content, target_audience, is_active)
VALUES ('Telegram announcement', 'Body', '{"type":"all"}'::jsonb, true);
SELECT ok((SELECT count(*) FROM public.telegram_outbox WHERE kind = 'announcement') >= 1,
  'a published announcement reaches the outbox');

INSERT INTO public.member_evaluations (member_id, title, grade, points, feedback, created_by)
SELECT m.id, 'Telegram evaluation', 'excellent', 5, 'تمام', phantoms_test.uid('tg_owner')
FROM public.members AS m WHERE m.email = 'tg-member@phantoms-test.example';
SELECT ok((SELECT count(*) FROM public.telegram_outbox WHERE kind = 'evaluation') >= 1,
  'a new evaluation reaches the outbox');

INSERT INTO public.reference_links (title, url, created_by)
VALUES ('Telegram reference', 'https://example.com', phantoms_test.uid('tg_owner'));
SELECT ok((SELECT count(*) FROM public.telegram_outbox WHERE kind = 'reference') >= 1,
  'a new reference reaches the outbox');

INSERT INTO public.member_infinite_bonus_events (member_id, member_name, member_email, enabled, actor_user_id)
SELECT m.id, m.full_name, m.email, true, phantoms_test.uid('tg_owner')
FROM public.members AS m WHERE m.email = 'tg-member@phantoms-test.example';
SELECT ok((SELECT count(*) FROM public.telegram_outbox WHERE kind = 'bonus') >= 1,
  'a bonus change reaches the outbox');

-- 5) دورة حياة الإرسال -------------------------------------------------------
SELECT ok((SELECT count(*) FROM public.telegram_claim_outbox(100)) >= 1,
  'claiming returns the pending batch');
SELECT is((SELECT count(*)::int FROM public.telegram_outbox WHERE status = 'pending'), 0,
  'every pending row was claimed');
SELECT public.telegram_complete_outbox((SELECT id FROM public.telegram_outbox ORDER BY id LIMIT 1), true, NULL, 42);
SELECT is((SELECT status FROM public.telegram_outbox ORDER BY id LIMIT 1), 'sent',
  'a completed row is marked sent');
SELECT public.telegram_enqueue(phantoms_test.uid('tg_member'), 'test', 'retry me', '{}'::jsonb, 'tg:retry:1');
SELECT public.telegram_complete_outbox((SELECT id FROM public.telegram_outbox WHERE dedupe_key = 'tg:retry:1'), false, 'boom', NULL);
SELECT is((SELECT status FROM public.telegram_outbox WHERE last_error = 'boom' LIMIT 1), 'pending',
  'a failure below the retry cap returns to the queue');

-- 6) قرار المالك من الشات -----------------------------------------------------
INSERT INTO public.admin_capability_requests (user_id, capability, note)
VALUES (phantoms_test.uid('tg_admin'), 'admin_accounts', 'من الشات');
SELECT throws_ok(
  $$SELECT public.telegram_decide_request(phantoms_test.uid('tg_admin'),
      (SELECT id FROM public.admin_capability_requests ORDER BY id DESC LIMIT 1), true, 60, NULL)$$,
  'P0001', NULL,
  'an admin cannot decide their own request from the bot');
SELECT is((public.telegram_decide_request(phantoms_test.uid('tg_owner'),
    (SELECT id FROM public.admin_capability_requests WHERE status = 'pending' ORDER BY id DESC LIMIT 1),
    true, 45, 'تمام') ->> 'status'), 'approved',
  'the owner approves from the bot');
SELECT is((SELECT count(*)::int FROM public.admin_capability_grants
           WHERE user_id = phantoms_test.uid('tg_admin') AND capability = 'admin_accounts'), 1,
  'the approval creates a live grant');

-- 7) كتم وفصل ---------------------------------------------------------------
SELECT is((public.telegram_set_muted_for_chat(555001, true))::boolean, true, 'a chat can be muted');
SELECT is((public.telegram_enqueue(phantoms_test.uid('tg_member'), 'test', 'muted', '{}'::jsonb, 'tg:muted:1')) IS NULL,
  true, 'a muted chat receives nothing new');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('tg_member');
SELECT is((public.telegram_member_link_state() ->> 'linked')::boolean, true,
  'the member sees their own link');
SELECT is((public.telegram_unlink_self())::boolean, true, 'the member can unlink their own chat');

SELECT * FROM finish();
ROLLBACK;
