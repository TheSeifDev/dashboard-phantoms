-- 41 — ربط الكود (GitHub) من البوابة: member_github_link / member_github_state.
-- العضو بيلزق لينك أو @handle أو username، والـ RPC بيتطبّع القيمة، بيرفض
-- الأسماء المحجوزة والمربوطة بعضو تاني، وبيكتب/بيشيل custom_fields.github.
BEGIN;
\ir _helpers.psql
SELECT no_plan();
-- Fixtures -------------------------------------------------------------------
SELECT phantoms_test.create_member('gh_owner', NULL, true);
SELECT phantoms_test.create_member('gh_other', NULL, true);
SELECT phantoms_test.create_member('gh_idle');
-- Posture: عقود الـ RPC -------------------------------------------------------
SELECT has_function('public', 'member_github_link', ARRAY['text']::name[],
  'member_github_link(text) exists');
SELECT has_function('public', 'member_github_state', ARRAY[]::name[],
  'member_github_state() exists');
SELECT is(has_function_privilege('anon', 'public.member_github_link(text)', 'EXECUTE'), false,
  'anon cannot link a GitHub handle');
SELECT is(has_function_privilege('anon', 'public.member_github_state()', 'EXECUTE'), false,
  'anon cannot read a GitHub link state');
SELECT is(has_function_privilege('authenticated', 'public.member_github_link(text)', 'EXECUTE'), true,
  'authenticated members can link a GitHub handle');
SELECT is(has_function_privilege('authenticated', 'public.member_github_state()', 'EXECUTE'), true,
  'authenticated members can read their GitHub link state');
-- Member scope ---------------------------------------------------------------
SELECT phantoms_test.clear_auth();
SELECT throws_like('SELECT public.member_github_state()', 'MEMBER_SCOPE_REQUIRED%',
  'a session without a bound member cannot read a GitHub state');
SELECT throws_like('SELECT public.member_github_link(''octo-cat'')', 'MEMBER_SCOPE_REQUIRED%',
  'a session without a bound member cannot link a GitHub handle');
-- Empty state ----------------------------------------------------------------
SELECT phantoms_test.login_as('gh_owner');
SELECT is(public.member_github_state() ->> 'linked', 'false',
  'a fresh member starts unlinked');
SELECT is(public.member_github_state() ->> 'handle', NULL,
  'a fresh member has no handle');
SELECT is(public.member_github_state() ->> 'profile_url', NULL,
  'a fresh member has no profile URL');
-- Linking accepts a full URL, an @handle and a bare handle --------------------
SELECT is(public.member_github_link('https://github.com/Octo-Cat/repo') ->> 'handle', 'octo-cat',
  'a full profile URL is normalized to a lowercase handle');
SELECT is((SELECT m.custom_fields ->> 'github' FROM public.members AS m
            WHERE m.id = phantoms_test.mid('gh_owner')), 'octo-cat',
  'the handle is stored in the github custom field');
SELECT is(public.member_github_state() ->> 'linked', 'true',
  'the member is reported as linked');
SELECT is(public.member_github_state() ->> 'profile_url', 'https://github.com/octo-cat',
  'the state exposes a canonical profile URL');
SELECT is(public.member_github_link('@Octo-Cat') ->> 'handle', 'octo-cat',
  'an @handle resolves to the same normalized value');
SELECT is(public.member_github_link('  octo-cat  ') ->> 'handle', 'octo-cat',
  'a bare handle is trimmed and accepted');
-- Rejections -----------------------------------------------------------------
SELECT throws_like('SELECT public.member_github_link(''not a handle!'')', 'INVALID_HANDLE%',
  'a malformed handle is rejected');
SELECT throws_like('SELECT public.member_github_link(''login'')', 'INVALID_HANDLE%',
  'a reserved GitHub path is rejected');
SELECT throws_like('SELECT public.member_github_link(''octo--cat'')', 'INVALID_HANDLE%',
  'a handle with a trailing hyphen is rejected');
-- Uniqueness across members ---------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gh_other');
SELECT throws_like('SELECT public.member_github_link(''octo-cat'')', 'HANDLE_TAKEN%',
  'a handle already linked to another member cannot be claimed');
SELECT is(public.member_github_state() ->> 'linked', 'false',
  'the failed claim leaves the other member unlinked');
SELECT is(public.member_github_link('second-cat') ->> 'handle', 'second-cat',
  'a different member can link a different handle');
-- Unlink ----------------------------------------------------------------------
RESET ROLE;
UPDATE public.members
   SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || '{"unit":"AI"}'::jsonb
 WHERE id = phantoms_test.mid('gh_owner');
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gh_owner');
SELECT is(public.member_github_link('') ->> 'linked', 'false',
  'an empty value unlinks the account');
SELECT is((SELECT m.custom_fields ? 'github' FROM public.members AS m
            WHERE m.id = phantoms_test.mid('gh_owner')), false,
  'unlinking removes the github key entirely');
SELECT is(public.member_github_state() ->> 'handle', NULL,
  'the state reports no handle after unlinking');
SELECT is((SELECT m.custom_fields ->> 'unit' FROM public.members AS m
            WHERE m.id = phantoms_test.mid('gh_owner')), 'AI',
  'unlinking leaves the rest of custom_fields untouched');
SELECT * FROM finish();
ROLLBACK;
