-- 35 — الخزنة global: خزنة واحدة للفريق كله (مش خزنة لكل تيم)،
-- فلتر التيم/الوحدة بيوصف العضو مش الخزنة، الاستلام للإدارة + هيدز/مونيتورز
-- تيم العضو، والعضو بيشوف كل الأرقام ما عدا مين دفع ومين مدفعش.
BEGIN;
\ir _helpers.psql
SELECT no_plan();

-- Fixtures -------------------------------------------------------------------
DO $$
DECLARE
  v_software UUID;
BEGIN
  PERFORM phantoms_test.create_user('gld_owner');
  PERFORM phantoms_test.grant_admin('gld_owner', 'owner');
  PERFORM phantoms_test.create_user('gld_admin');
  PERFORM phantoms_test.grant_admin('gld_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.create_user('gld_head');
  PERFORM phantoms_test.create_member('gld_payer', NULL, true);
  PERFORM phantoms_test.create_member('gld_other', NULL, true);
  PERFORM phantoms_test.create_member('gld_outsider', NULL, true);
  PERFORM phantoms_test.create_member('gld_custom', NULL, true);

  SELECT id INTO v_software FROM public.teams WHERE slug = 'software';

  UPDATE public.members
     SET specialization = 'software'
   WHERE id IN (phantoms_test.mid('gld_payer'), phantoms_test.mid('gld_other'));

  -- وحدة مخصصة (مش تيم) زي PR / HR / co-leader.
  UPDATE public.members
     SET custom_fields = jsonb_build_object('unit', 'PR')
   WHERE id = phantoms_test.mid('gld_custom');

  INSERT INTO public.team_admin_assignments (team_id, user_id, role, permissions)
  VALUES (v_software, phantoms_test.uid('gld_head'), 'head', phantoms_test.perms('members'));
END $$;

-- Posture: عقود RPC الـglobal -------------------------------------------------
SELECT has_function('public', 'admin_ledger_overview', ARRAY['text']::name[],
  'admin_ledger_overview(text) exists');
SELECT has_function('public', 'admin_ledger_save_entry', ARRAY['jsonb']::name[],
  'admin_ledger_save_entry(jsonb) exists');
SELECT has_function('public', 'admin_ledger_save_due', ARRAY['jsonb']::name[],
  'admin_ledger_save_due(jsonb) exists');
SELECT has_function('public', 'member_ledger', ARRAY[]::name[],
  'member_ledger() exists');
SELECT has_function('public', 'member_ledger_declare_payment', ARRAY['jsonb']::name[],
  'member_ledger_declare_payment(jsonb) exists');
SELECT has_function('public', 'ledger_series', ARRAY['text']::name[],
  'ledger_series(text) exists');
SELECT ok(to_regprocedure('public.admin_ledger_overview(uuid)') IS NULL,
  'the old per-team admin_ledger_overview(uuid) is gone');
SELECT ok(to_regprocedure('public.member_ledger(uuid)') IS NULL,
  'the old per-team member_ledger(uuid) is gone');
SELECT ok(to_regprocedure('public.team_ledger_receivers(uuid)') IS NULL,
  'the old per-team receivers helper is gone');
SELECT ok((SELECT attnotnull FROM pg_attribute
            WHERE attrelid = 'public.team_ledger_entries'::regclass AND attname = 'team_id') = false,
  'team_ledger_entries.team_id is nullable (legacy, unused)');
SELECT ok((SELECT attnotnull FROM pg_attribute
            WHERE attrelid = 'public.team_ledger_dues'::regclass AND attname = 'team_id') = false,
  'team_ledger_dues.team_id is nullable (legacy, unused)');
SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.member_ledger()'::regprocedure),
  'member_ledger runs as SECURITY DEFINER');
SELECT ok(NOT has_function_privilege('anon', 'public.member_ledger()', 'EXECUTE'),
  'anonymous role cannot execute member_ledger');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_ledger_overview(text)', 'EXECUTE'),
  'anonymous role cannot execute admin_ledger_overview');

-- التيم/الوحدة بتاعة العضو ----------------------------------------------------
SELECT is(public.member_unit(phantoms_test.mid('gld_payer')), 'Software',
  'the unit comes from the member specialization when no custom unit is set');
SELECT is(public.member_unit(phantoms_test.mid('gld_custom')), 'PR',
  'a custom unit (PR / HR / co-leader) wins over the team');
SELECT is(public.member_unit(phantoms_test.mid('gld_outsider')), 'بدون تيم',
  'a member with no team and no custom unit is labelled بدون تيم');

-- الإدارة: التزامات على مستوى الفريق ------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_admin');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_due(
       jsonb_build_object('member_id', phantoms_test.mid('gld_payer'),
                          'label', 'اشتراك نوفمبر', 'amount', '500', 'due_on', '2020-01-01')) $$,
  'an admin can set a due without any team id');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_due(
       jsonb_build_object('member_id', phantoms_test.mid('gld_other'),
                          'label', 'اشتراك نوفمبر', 'amount', '500', 'due_on', '2030-01-01')) $$,
  'the same due label is allowed for a different member');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_due(
       jsonb_build_object('member_id', phantoms_test.mid('gld_payer'),
                          'label', 'اشتراك نوفمبر', 'amount', '500')) $$,
  'P0001', 'DUPLICATE_DUE: نفس الالتزام متسجل للعضو ده بالفعل.',
  'the same due label for the same member is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_due(
       jsonb_build_object('member_id', phantoms_test.mid('gld_payer'),
                          'label', 'رحلة', 'amount', '0')) $$,
  'P0001', 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.',
  'a zero amount due is rejected');
SELECT is((public.admin_ledger_overview() #>> '{summary,expected}')::numeric, 1000::numeric,
  'the summary adds every due on the whole team');
SELECT is((public.admin_ledger_overview() #>> '{summary,outstanding}')::numeric, 1000::numeric,
  'outstanding equals the unpaid dues when nothing was collected');
SELECT is((public.admin_ledger_overview() #>> '{summary,late_count}')::int, 1,
  'only the member whose due date passed is counted as late');
SELECT is((public.admin_ledger_overview() #>> '{summary,member_count}')::int, 2,
  'the member rollup lists every member with a due or a payment');
SELECT is(jsonb_array_length(public.admin_ledger_overview('Software') -> 'dues'), 2,
  'the unit filter keeps the dues of that unit only');
SELECT is(jsonb_array_length(public.admin_ledger_overview('PR') -> 'dues'), 0,
  'a unit with no dues returns an empty list');
SELECT ok(jsonb_array_length(public.admin_ledger_overview() -> 'units') >= 3,
  'the overview exposes the unit filter options');

-- العضو بيسجّل «أنا دفعت» ------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_payer');
SELECT lives_ok(
  $$ SELECT public.member_ledger_declare_payment(
       jsonb_build_object('amount', '500', 'receiver_user_id', phantoms_test.uid('gld_owner'),
                          'note', 'تحويل فودافون كاش')) $$,
  'a member can declare a payment to the owner');
SELECT lives_ok(
  $$ SELECT public.member_ledger_declare_payment(
       jsonb_build_object('amount', '100', 'receiver_user_id', phantoms_test.uid('gld_head'))) $$,
  'a member can declare a payment to the head of their own team');
SELECT is((public.member_ledger() #>> '{summary,my_pending}')::numeric, 600::numeric,
  'the declared payments stay pending for the member');
SELECT is((public.member_ledger() #>> '{summary,collected}')::numeric, 0::numeric,
  'a pending payment is not counted in the team total');
SELECT ok(NOT (public.member_ledger() ? 'members'),
  'the member payload never exposes who paid and who did not');
SELECT ok(NOT (public.member_ledger() ? 'entries'),
  'the member payload never exposes the per-member payment rows');
SELECT is(public.member_ledger() ->> 'unit', 'Software',
  'the member payload carries the member unit');
SELECT throws_ok(
  $$ SELECT public.member_ledger_declare_payment(
       jsonb_build_object('amount', '500', 'receiver_user_id', phantoms_test.uid('gld_other'))) $$,
  'P0001', 'INVALID_RECEIVER: المستلم لازم يكون من الإدارة أو هيد/مونيتور تيمك.',
  'a member cannot pay another member who is not a receiver');
SELECT throws_ok(
  $$ SELECT public.member_ledger_declare_payment(
       jsonb_build_object('amount', '0', 'receiver_user_id', phantoms_test.uid('gld_owner'))) $$,
  'P0001', 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.',
  'a zero payment is rejected');
SELECT throws_ok('SELECT public.admin_ledger_overview()',
  'P0001', 'ADMIN_SCOPE_REQUIRED: الخزنة متاحة للإدارة فقط.',
  'a member cannot open the admin ledger');

-- عضو من غير تيم: بيشوف الخزنة ويدفع للإدارة ---------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_outsider');
SELECT lives_ok('SELECT public.member_ledger()',
  'a member with no internal team can still open the ledger');
SELECT is(public.member_ledger() ->> 'unit', 'بدون تيم',
  'the member without a team gets the بدون تيم label');
SELECT ok(jsonb_array_length(public.member_ledger() -> 'receivers') >= 2,
  'a member without a team can still pay the admins');
SELECT lives_ok(
  $$ SELECT public.member_ledger_declare_payment(
       jsonb_build_object('amount', '50', 'receiver_user_id', phantoms_test.uid('gld_admin'))) $$,
  'a member without a team can declare a payment to an admin');

-- الإدارة بتأكد الدفعة (مع تصحيح المبلغ) --------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_admin');
SELECT is((public.admin_ledger_overview() #>> '{summary,pending_count}')::int, 3,
  'the admin sees every pending payment on the whole team');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_decide(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview() -> 'entries') AS entry
        WHERE entry ->> 'status' = 'pending' AND (entry ->> 'amount')::numeric = 500 LIMIT 1),
       'approve', 'وصل 400 بس', 400) $$,
  'the receiver can approve a pending payment and correct the amount');
SELECT is((public.admin_ledger_overview() #>> '{summary,collected}')::numeric, 400::numeric,
  'the approved (corrected) amount is what gets collected');
SELECT is((public.admin_ledger_overview() #>> '{summary,balance}')::numeric, 400::numeric,
  'the available balance equals the approved payments');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_decide(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview() -> 'entries') AS entry
        WHERE entry ->> 'status' = 'approved' LIMIT 1),
       'approve') $$,
  'P0001', 'ALREADY_DECIDED: الدفعة دي اتقرر فيها بالفعل.',
  'a decided payment cannot be decided twice');
SELECT is(
  (SELECT (entry ->> 'paid_total')::numeric
   FROM jsonb_array_elements(public.admin_ledger_overview() -> 'members') AS entry
   WHERE (entry ->> 'member_id')::bigint = phantoms_test.mid('gld_payer')),
  400::numeric,
  'the member rollup reflects the approved amount');
SELECT is(
  (SELECT (entry ->> 'remaining')::numeric
   FROM jsonb_array_elements(public.admin_ledger_overview() -> 'members') AS entry
   WHERE (entry ->> 'member_id')::bigint = phantoms_test.mid('gld_payer')),
  100::numeric,
  'the member rollup keeps the outstanding remainder');

-- هيد التيم بيدير الخزنة الـglobal -------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_head');
SELECT lives_ok('SELECT public.admin_ledger_overview()',
  'a team head can open the global ledger');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_entry(
       jsonb_build_object('kind', 'expense', 'amount', '10', 'title', 'مصروف صغير', 'category', 'other')) $$,
  'a team head can record an expense');
SELECT is((public.admin_ledger_overview() #>> '{summary,balance}')::numeric, 390::numeric,
  'the head expense is reflected in the balance');

-- مصروفات وخصومات -------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_admin');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_entry(
       jsonb_build_object('kind', 'expense', 'amount', '150', 'title', 'طباعة بانرات',
                          'category', 'printing', 'note', 'ميتنج نوفمبر')) $$,
  'an admin can record an expense with a category');
SELECT is((public.admin_ledger_overview() #>> '{summary,expenses}')::numeric, 160::numeric,
  'the expenses total adds every expense');
SELECT is((public.admin_ledger_overview() #>> '{summary,balance}')::numeric, 240::numeric,
  'the balance subtracts expenses from the collected total');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_entry(jsonb_build_object('kind', 'expense', 'amount', '50')) $$,
  'P0001', 'INVALID_TITLE: لازم تكتب المصروف اتصرف في إيه.',
  'an expense without a title is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_entry(
       jsonb_build_object('kind', 'expense', 'amount', '50', 'title', 'حاجة', 'category', 'nope')) $$,
  'P0001', 'INVALID_CATEGORY: تصنيف المصروف غير معروف.',
  'an unknown expense category is rejected');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_entry(
       jsonb_build_object('kind', 'withdrawal', 'amount', '100',
                          'member_id', phantoms_test.mid('gld_other'), 'note', 'مواصلات')) $$,
  'an admin can record a member withdrawal (deduction)');
SELECT is((public.admin_ledger_overview() #>> '{summary,withdrawals}')::numeric, 100::numeric,
  'the withdrawal is counted as a deduction on the ledger');
SELECT is((public.admin_ledger_overview() #>> '{summary,balance}')::numeric, 140::numeric,
  'the balance subtracts withdrawals as well');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_entry(jsonb_build_object('kind', 'withdrawal', 'amount', '50')) $$,
  'P0001', 'INVALID_MEMBER: لازم تحدد العضو اللي سحب.',
  'a withdrawal without a member is rejected');

-- سلسلة الشهور للشارت ---------------------------------------------------------
SELECT is(jsonb_array_length(public.ledger_series()), 6,
  'the chart series always covers the last six months');
SELECT is((public.ledger_series() -> 5 ->> 'balance')::numeric,
          (public.admin_ledger_overview() #>> '{summary,balance}')::numeric,
  'the last series point matches the live balance');
SELECT is(jsonb_array_length(public.ledger_series('PR')), 6,
  'the series accepts a unit filter');

-- العضو بيشوف مصروفات الفريق ---------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_other');
SELECT ok(jsonb_array_length(public.member_ledger() -> 'expenses') >= 2,
  'a member sees every team expense');
SELECT ok(NOT (public.member_ledger() ? 'members'),
  'the member view still hides who paid and who did not');

-- الحذف -----------------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('gld_admin');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_delete_entry(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview() -> 'entries') AS entry
        WHERE entry ->> 'title' = 'مصروف صغير' LIMIT 1)) $$,
  'an admin can delete a ledger entry');
SELECT is((public.admin_ledger_overview() #>> '{summary,balance}')::numeric, 150::numeric,
  'deleting an expense restores the balance');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_delete_due(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview() -> 'dues') AS entry
        WHERE (entry ->> 'member_id')::bigint = phantoms_test.mid('gld_payer') LIMIT 1)) $$,
  'an admin can delete a due');
SELECT is((public.admin_ledger_overview() #>> '{summary,expected}')::numeric, 500::numeric,
  'deleting a due lowers the expected total');

SELECT * FROM finish();
