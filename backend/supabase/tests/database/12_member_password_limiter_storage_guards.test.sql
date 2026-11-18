-- Bounded limiter storage regressions. Synthetic service calls; rollback-only.
BEGIN;
\ir _helpers.psql
SELECT plan(18);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.member_password_check_rate_limit(repeat('a', 64), 8, 900, 900)$$,
  '42501', NULL, 'anonymous callers cannot execute the limiter');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.member_password_check_rate_limit(repeat('b', 64), 8, 900, 900)$$,
  '42501', NULL, 'authenticated callers cannot execute the limiter');
RESET ROLE;
SELECT ok(
  has_function_privilege('service_role', 'public.member_password_check_rate_limit(text,integer,integer,integer)', 'EXECUTE'),
  'service role retains limiter execution');

-- Synthetic JWT claims for SQL-only service RPC tests, not real GoTrue proof.
SELECT set_config('request.jwt.claim', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DELETE FROM public.member_password_rate_limits;

-- A full table rejects only a novel key while an existing key remains usable.
INSERT INTO public.member_password_rate_limits(key_hash, window_started_at, attempts, blocked_until, updated_at)
SELECT md5('cap-' || series::text) || md5('cap-suffix-' || series::text), now(), 0, NULL, now()
FROM generate_series(1, 10000) AS series;
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits), 10000, 'storage cap fixture contains exactly 10000 rows');
SELECT throws_like(
  $$SELECT public.member_password_check_rate_limit(md5('novel-cap') || md5('novel-cap-suffix'), 8, 900, 900)$$,
  '%RATE_LIMIT_STORAGE_FULL%', 'novel keys fail closed at the storage cap');
SELECT ok(
  NOT public.member_password_check_rate_limit(md5('cap-1') || md5('cap-suffix-1'), 1000, 900, 900),
  'an existing live key continues to work at the storage cap');
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits), 10000, 'rejected novel key does not grow the table');

-- One bounded cleanup batch removes only an old, fully inactive row and then
-- admits the novel key; no active reservation table is touched by this RPC.
DELETE FROM public.member_password_rate_limits;
INSERT INTO public.member_password_rate_limits(key_hash, window_started_at, attempts, blocked_until, updated_at)
VALUES (md5('stale-key') || md5('stale-key-suffix'), now() - interval '2 days', 8, now() - interval '1 day', now() - interval '2 days');
INSERT INTO public.member_password_rate_limits(key_hash, window_started_at, attempts, blocked_until, updated_at)
SELECT md5('cleanup-' || series::text) || md5('cleanup-suffix-' || series::text), now(), 0, NULL, now()
FROM generate_series(1, 9999) AS series;
SELECT ok(
  NOT public.member_password_check_rate_limit(md5('cleanup-novel') || md5('cleanup-novel-suffix'), 8, 900, 900),
  'expired inactive storage is cleaned before admitting a novel key');
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits WHERE key_hash = md5('stale-key') || md5('stale-key-suffix')), 0, 'expired inactive row is pruned');
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits WHERE key_hash = md5('cleanup-novel') || md5('cleanup-novel-suffix')), 1, 'novel key is inserted after bounded cleanup');
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits), 10000, 'cleanup and admission remain bounded at the cap');

-- Active blocks are never cleanup-eligible, so a full table remains fail closed.
DELETE FROM public.member_password_rate_limits;
INSERT INTO public.member_password_rate_limits(key_hash, window_started_at, attempts, blocked_until, updated_at)
VALUES (md5('active-block') || md5('active-block-suffix'), now() - interval '2 days', 8, now() + interval '1 hour', now() - interval '2 days');
INSERT INTO public.member_password_rate_limits(key_hash, window_started_at, attempts, blocked_until, updated_at)
SELECT md5('active-fill-' || series::text) || md5('active-fill-suffix-' || series::text), now(), 0, NULL, now()
FROM generate_series(1, 9999) AS series;
SELECT throws_like(
  $$SELECT public.member_password_check_rate_limit(md5('active-novel') || md5('active-novel-suffix'), 8, 900, 900)$$,
  '%RATE_LIMIT_STORAGE_FULL%', 'active blocked rows prevent unsafe cap recycling');
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits WHERE key_hash = md5('active-block') || md5('active-block-suffix')), 1, 'active blocked row is preserved');
SELECT is((SELECT count(*)::integer FROM public.member_password_rate_limits), 10000, 'active-block rejection does not grow storage');

-- Existing independent limiter semantics remain unchanged.
DELETE FROM public.member_password_rate_limits;
SELECT ok(NOT public.member_password_check_rate_limit(md5('independent-a') || md5('independent-a-suffix'), 1, 900, 900), 'first independent attempt is allowed');
SELECT ok(public.member_password_check_rate_limit(md5('independent-a') || md5('independent-a-suffix'), 1, 900, 900), 'second attempt exhausts the independent key');
SELECT ok(NOT public.member_password_check_rate_limit(md5('independent-b') || md5('independent-b-suffix'), 1, 900, 900), 'another key keeps an independent budget');
SELECT is((SELECT count(*)::integer FROM public.member_password_invitations), 0, 'limiter checks do not create invitation reservations');

SELECT * FROM finish();
ROLLBACK;
