-- 42 — ربط تلجرام أوتوماتيك: كود idempotent، تطبيع أرقام الموبايل، الربط من
-- رقم العضو المشترك، ونظرة الإدارة على مين ربط ومين لسه.
BEGIN;
\ir _helpers.psql
SELECT plan(18);

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['tg2_owner', 'tg2_admin', 'tg2_m1', 'tg2_m2', 'tg2_m3']) AS n;
  PERFORM phantoms_test.grant_admin('tg2_owner', 'owner');
  PERFORM phantoms_test.grant_admin('tg2_admin', 'admin');
END $$;

INSERT INTO public.members (email, full_name, academic_number, phone)
VALUES ('tg2-a@phantoms-test.example', 'Auto Link A', 'TG2-001', '+201000000001'),
       ('tg2-b@phantoms-test.example', 'Auto Link B', 'TG2-002', '01000000001'),
       ('tg2-c@phantoms-test.example', 'Auto Link C', 'TG2-003', '01000000009')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
SELECT m.id,
       CASE m.email
         WHEN 'tg2-a@phantoms-test.example' THEN phantoms_test.uid('tg2_m1')
         WHEN 'tg2-b@phantoms-test.example' THEN phantoms_test.uid('tg2_m2')
         ELSE phantoms_test.uid('tg2_m3')
       END,
       m.email,
       true
FROM public.members AS m
WHERE m.email IN ('tg2-a@phantoms-test.example', 'tg2-b@phantoms-test.example', 'tg2-c@phantoms-test.example')
ON CONFLICT DO NOTHING;

UPDATE public.telegram_settings
   SET enabled = true, bot_token = '123:TEST', bot_username = 'phantoms_test_bot'
 WHERE id = 1;

-- 1) تطبيع أرقام الموبايل -----------------------------------------------------
SELECT is(public.telegram_phone_key('+201234567890'), '1234567890', 'a +20 number normalizes to the local digits');
SELECT is(public.telegram_phone_key('00201234567890'), '1234567890', 'a 0020 prefix normalizes to the same digits');
SELECT is(public.telegram_phone_key('012 3456 7890'), '1234567890', 'spaces do not change the normalized digits');
SELECT is(public.telegram_phone_key('123'), NULL, 'a too-short number is rejected');

-- 2) حراسة الصلاحيات ---------------------------------------------------------
SELECT phantoms_test.login_as('tg2_m3');
SELECT throws_ok($$SELECT public.telegram_link_self_by_contact('01000000009', 777001, NULL, NULL)$$,
  '42501', NULL, 'a member cannot call the contact auto-link RPC from the Data API');
SELECT throws_ok($$SELECT * FROM public.telegram_links_overview()$$,
  'P0001', NULL, 'a member cannot read the admin linking overview');

-- 3) كود الربط idempotent ----------------------------------------------------
SELECT is((public.telegram_member_link_code() ->> 'code') IS NOT NULL, true,
  'an enabled bot issues a link code for the member');
SELECT is(public.telegram_member_link_code() ->> 'code', public.telegram_member_link_code() ->> 'code',
  'asking again returns the same unexpired code');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::int FROM public.telegram_link_codes WHERE user_id = phantoms_test.uid('tg2_m3')), 1,
  'only one live code exists per member');
UPDATE public.telegram_link_codes
   SET expires_at = now() - INTERVAL '1 minute'
 WHERE user_id = phantoms_test.uid('tg2_m3');
SELECT phantoms_test.login_as('tg2_m3');
SELECT isnt(public.telegram_member_link_code() ->> 'code', NULL,
  'an expired code is replaced with a fresh one');

-- 4) الربط من رقم الموبايل ---------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is(public.telegram_link_self_by_contact('01099999999', 777002, 'ghost', 'Ghost') ->> 'reason', 'NO_MATCH',
  'an unknown phone number links nothing');
SELECT is(public.telegram_link_self_by_contact('01000000001', 777003, 'dupe', 'Dupe') ->> 'reason', 'AMBIGUOUS',
  'a phone shared by two members is refused as ambiguous');
SELECT is((public.telegram_link_self_by_contact('01000000009', 777004, 'unique_handle', 'Unique') ->> 'ok')::boolean, true,
  'a unique phone number links the chat');
SELECT is((SELECT count(*)::int FROM public.telegram_links WHERE chat_id = 777004 AND revoked_at IS NULL), 1,
  'the automatic link is stored once for the chat');
SELECT is(public.telegram_link_self_by_contact('01000000009', 777004, 'unique_handle', 'Unique') ->> 'reason', 'ALREADY_LINKED',
  're-sharing the contact is a no-op');

-- 5) نظرة الإدارة ------------------------------------------------------------
SELECT phantoms_test.login_as('tg2_admin');
SELECT lives_ok($$SELECT * FROM public.telegram_links_overview()$$,
  'an admin with the messaging permission reads the overview');
SELECT is((SELECT linked FROM public.telegram_links_overview()
            WHERE email = 'tg2-c@phantoms-test.example'), true,
  'the overview marks the member who linked');
SELECT is((SELECT count(*)::int FROM public.telegram_links_overview() WHERE linked), 1,
  'the overview counts exactly one linked member');
SELECT * FROM finish();
ROLLBACK;
