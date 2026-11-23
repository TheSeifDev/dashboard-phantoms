-- 35 — خزنة الفريق: الجداول مقفولة (RLS + revoke)، الوصول عبر RPCs فقط،
-- العضو بيسجّل «أنا دفعت» فتفضل pending لحد تأكيد المستلم (مع تصحيح المبلغ)،
-- والرصيد = المدفوعات المؤكدة − المصروفات − الخصومات.
BEGIN;
\ir _helpers.psql
SELECT plan(62);
-- Fixtures -------------------------------------------------------------------
DO $$
DECLARE
  v_software UUID;
  v_hardware UUID;
BEGIN
  PERFORM phantoms_test.create_user('ldg_owner');
  PERFORM phantoms_test.grant_admin('ldg_owner', 'owner');
  PERFORM phantoms_test.create_user('ldg_admin');
  PERFORM phantoms_test.grant_admin('ldg_admin', 'admin');
  PERFORM phantoms_test.create_user('ldg_head');
  PERFORM phantoms_test.create_member('ldg_payer', NULL, true);
  PERFORM phantoms_test.create_member('ldg_other', NULL, true);
  PERFORM phantoms_test.create_member('ldg_late', NULL, true);
  PERFORM phantoms_test.create_member('ldg_outsider', NULL, true);
  SELECT id INTO v_software FROM public.teams WHERE slug = 'software';
  SELECT id INTO v_hardware FROM public.teams WHERE slug = 'hardware';
  INSERT INTO public.team_admin_assignments (team_id, user_id, role, permissions)
  VALUES (v_software, phantoms_test.uid('ldg_head'), 'head', phantoms_test.perms('members'));
  INSERT INTO public.team_memberships (team_id, member_id, status)
  VALUES (v_software, phantoms_test.mid('ldg_payer'), 'active'),
         (v_software, phantoms_test.mid('ldg_other'), 'active'),
         (v_software, phantoms_test.mid('ldg_late'), 'active');
END $$;
-- Posture --------------------------------------------------------------------
SELECT has_function('public', 'admin_ledger_overview', ARRAY['uuid']::name[],
  'admin_ledger_overview(uuid) exists');
SELECT has_function('public', 'admin_ledger_save_entry', ARRAY['uuid', 'jsonb']::name[],
  'admin_ledger_save_entry(uuid, jsonb) exists');
SELECT has_function('public', 'admin_ledger_decide', ARRAY['bigint', 'text', 'text', 'numeric']::name[],
  'admin_ledger_decide(bigint, text, text, numeric) exists');
SELECT has_function('public', 'admin_ledger_save_due', ARRAY['uuid', 'jsonb']::name[],
  'admin_ledger_save_due(uuid, jsonb) exists');
SELECT has_function('public', 'admin_ledger_delete_due', ARRAY['bigint']::name[],
  'admin_ledger_delete_due(bigint) exists');
SELECT has_function('public', 'member_ledger', ARRAY['uuid']::name[],
  'member_ledger(uuid) exists');
SELECT has_function('public', 'member_ledger_declare_payment', ARRAY['uuid', 'jsonb']::name[],
  'member_ledger_declare_payment(uuid, jsonb) exists');
SELECT has_function('public', 'team_ledger_can_manage', ARRAY['uuid']::name[],
  'team_ledger_can_manage(uuid) exists');
SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.admin_ledger_decide(bigint,text,text,numeric)'::regprocedure),
  'admin_ledger_decide runs as SECURITY DEFINER');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.team_ledger_entries'::regclass),
  'team_ledger_entries has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.team_ledger_dues'::regclass),
  'team_ledger_dues has RLS enabled');
SELECT ok(NOT has_function_privilege('anon', 'public.member_ledger(uuid)', 'EXECUTE'),
  'anonymous role cannot execute member_ledger');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_ledger_overview(uuid)', 'EXECUTE'),
  'anonymous role cannot execute admin_ledger_overview');
-- The tables are readable/writable by no client role, even an authenticated admin.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_admin');
SELECT throws_ok('SELECT count(*) FROM public.team_ledger_entries', '42501', NULL,
  'authenticated clients cannot select team_ledger_entries directly');
SELECT throws_ok('SELECT count(*) FROM public.team_ledger_dues', '42501', NULL,
  'authenticated clients cannot select team_ledger_dues directly');
SELECT throws_ok(
  $$ INSERT INTO public.team_ledger_entries (team_id, kind, amount, member_id, receiver_user_id)
     VALUES ((SELECT id FROM public.teams WHERE slug = 'software'), 'payment', 100,
             phantoms_test.mid('ldg_payer'), phantoms_test.uid('ldg_owner')) $$,
  '42501', NULL,
  'authenticated clients cannot insert ledger entries directly');
-- Dues ----------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_due(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('member_id', phantoms_test.mid('ldg_payer'),
                          'label', 'اشتراك نوفمبر', 'amount', '500', 'due_on', '2020-01-01')) $$,
  'an admin can set a due for a team member');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_due(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('member_id', phantoms_test.mid('ldg_other'),
                          'label', 'اشتراك نوفمبر', 'amount', '500', 'due_on', '2030-01-01')) $$,
  'an admin can set a second due with a future date');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_due(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('member_id', phantoms_test.mid('ldg_payer'),
                          'label', 'اشتراك نوفمبر', 'amount', '500')) $$,
  'P0001', 'DUPLICATE_DUE: نفس الالتزام متسجل للعضو ده بالفعل.',
  'the same due label for the same member is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_due(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('member_id', phantoms_test.mid('ldg_payer'),
                          'label', 'رحلة', 'amount', '0')) $$,
  'P0001', 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.',
  'a zero amount due is rejected');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,expected}')::numeric,
  1000::numeric,
  'the summary adds every due for the team');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,outstanding}')::numeric,
  1000::numeric,
  'outstanding equals the unpaid dues when nothing was collected');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,late_count}')::int,
  1,
  'only the member whose due date passed is counted as late');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,member_count}')::int,
  3,
  'the member rollup lists every active team member');
-- Member declares a payment ---------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_payer');
SELECT lives_ok(
  $$ SELECT public.member_ledger_declare_payment(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('amount', '500', 'receiver_user_id', phantoms_test.uid('ldg_owner'),
                          'note', 'تحويل فودافون كاش')) $$,
  'a member can declare a payment to the owner');
SELECT is(
  (public.member_ledger((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,my_pending}')::numeric,
  500::numeric,
  'the declared payment stays pending for the member');
SELECT is(
  (public.member_ledger((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,collected}')::numeric,
  0::numeric,
  'a pending payment is not counted in the team total');
SELECT ok(
  NOT (public.member_ledger((SELECT id FROM public.teams WHERE slug = 'software')) ? 'members'),
  'the member payload never exposes other members balances');
SELECT is(
  jsonb_array_length(public.member_ledger((SELECT id FROM public.teams WHERE slug = 'software')) -> 'teams'),
  1,
  'the member payload lists only the member active teams');
SELECT throws_ok(
  $$ SELECT public.member_ledger_declare_payment(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('amount', '500', 'receiver_user_id', phantoms_test.uid('ldg_other'))) $$,
  'P0001', 'INVALID_RECEIVER: المستلم لازم يكون مالك أو أدمن أو هيد/مونيتور التيم.',
  'a member cannot pay another member who is not a receiver');
SELECT throws_ok(
  $$ SELECT public.member_ledger_declare_payment(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('amount', '0', 'receiver_user_id', phantoms_test.uid('ldg_owner'))) $$,
  'P0001', 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.',
  'a zero payment is rejected');
SELECT throws_ok(
  $$ SELECT public.member_ledger_declare_payment(
       (SELECT id FROM public.teams WHERE slug = 'hardware'),
       jsonb_build_object('amount', '100', 'receiver_user_id', phantoms_test.uid('ldg_owner'))) $$,
  'P0001', 'MEMBER_SCOPE_REQUIRED: إنت مش عضو في التيم ده.',
  'a member cannot declare a payment for a team they are not in');
SELECT throws_ok('SELECT public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = ''software''))',
  'P0001', 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.',
  'a member cannot open the admin ledger');
-- Admin approves with a corrected amount --------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_admin');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,pending_count}')::int,
  1,
  'the admin sees the pending payment waiting for confirmation');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_decide(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'entries') AS entry
        WHERE entry ->> 'status' = 'pending' LIMIT 1),
       'approve', 'وصل 400 بس', 400) $$,
  'the receiver can approve a pending payment and correct the amount');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,collected}')::numeric,
  400::numeric,
  'the approved (corrected) amount is what gets collected');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,balance}')::numeric,
  400::numeric,
  'the available balance equals the approved payments');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_decide(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'entries') AS entry
        WHERE entry ->> 'status' = 'approved' LIMIT 1),
       'approve') $$,
  'P0001', 'ALREADY_DECIDED: الدفعة دي اتقرر فيها بالفعل.',
  'a decided payment cannot be decided twice');
SELECT is(
  (SELECT (entry ->> 'paid_total')::numeric
   FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'members') AS entry
   WHERE (entry ->> 'member_id')::bigint = phantoms_test.mid('ldg_payer')),
  400::numeric,
  'the member rollup reflects the approved amount');
SELECT is(
  (SELECT (entry ->> 'remaining')::numeric
   FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'members') AS entry
   WHERE (entry ->> 'member_id')::bigint = phantoms_test.mid('ldg_payer')),
  100::numeric,
  'the member rollup keeps the outstanding remainder');
SELECT is(
  (SELECT (entry ->> 'late')::boolean
   FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'members') AS entry
   WHERE (entry ->> 'member_id')::bigint = phantoms_test.mid('ldg_payer')),
  true,
  'a partially paid member past the due date is still late');
-- Rejection ------------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_other');
SELECT lives_ok(
  $$ SELECT public.member_ledger_declare_payment(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('amount', '300', 'receiver_user_id', phantoms_test.uid('ldg_admin'))) $$,
  'a second member can declare a payment to an admin');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_admin');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_decide(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'entries') AS entry
        WHERE entry ->> 'status' = 'pending' LIMIT 1),
       'reject', 'مفيش تحويل بالاسم ده') $$,
  'the receiver can reject a payment with a note');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,collected}')::numeric,
  400::numeric,
  'a rejected payment never changes the collected total');
SELECT is(
  (SELECT count(*)::int
   FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'entries') AS entry
   WHERE entry ->> 'status' = 'rejected' AND entry ->> 'decision_note' = 'مفيش تحويل بالاسم ده'),
  1,
  'the rejection note is stored with the entry');
-- Expenses and withdrawals ---------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_entry(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('kind', 'expense', 'amount', '150', 'title', 'طباعة بانرات',
                          'category', 'printing', 'note', 'ميتنج نوفمبر')) $$,
  'an admin can record an expense with a category');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,expenses}')::numeric,
  150::numeric,
  'the expense is added to the total expenses');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,balance}')::numeric,
  250::numeric,
  'the balance subtracts expenses from the collected total');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_entry(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('kind', 'expense', 'amount', '50')) $$,
  'P0001', 'INVALID_TITLE: لازم تكتب المصروف اتصرف في إيه.',
  'an expense without a title is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_entry(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('kind', 'expense', 'amount', '50', 'title', 'حاجة', 'category', 'nope')) $$,
  'P0001', 'INVALID_CATEGORY: تصنيف المصروف غير معروف.',
  'an unknown expense category is rejected');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_entry(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('kind', 'withdrawal', 'amount', '100',
                          'member_id', phantoms_test.mid('ldg_other'),
                          'note', 'مواصلات')) $$,
  'an admin can record a member withdrawal (deduction)');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,withdrawals}')::numeric,
  100::numeric,
  'the withdrawal is counted as a deduction on the ledger');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,balance}')::numeric,
  150::numeric,
  'the balance subtracts withdrawals as well');
SELECT throws_ok(
  $$ SELECT public.admin_ledger_save_entry(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('kind', 'withdrawal', 'amount', '50')) $$,
  'P0001', 'INVALID_MEMBER: لازم تحدد العضو اللي سحب.',
  'a withdrawal without a member is rejected');
-- Team head scope ------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_head');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{team,slug}'),
  'software',
  'a team head can open the ledger of the team they manage');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_save_entry(
       (SELECT id FROM public.teams WHERE slug = 'software'),
       jsonb_build_object('kind', 'expense', 'amount', '10', 'title', 'مصروف صغير', 'category', 'other')) $$,
  'a team head can record an expense for their team');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,balance}')::numeric,
  140::numeric,
  'the head expense is reflected in the balance');
SELECT throws_ok('SELECT public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = ''hardware''))',
  'P0001', 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.',
  'a head cannot open another team ledger');
SELECT is(jsonb_array_length(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'teams'), 1,
  'the head only gets the teams they can manage');
-- Outsider -------------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_outsider');
SELECT throws_ok('SELECT public.member_ledger(NULL)', 'P0001',
  'MEMBER_SCOPE_REQUIRED: إنت مش عضو في تيم داخلي لسه.',
  'a member outside every internal team cannot open the ledger');
-- Delete ---------------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ldg_admin');
SELECT lives_ok(
  $$ SELECT public.admin_ledger_delete_entry(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) -> 'entries') AS entry
        WHERE entry ->> 'title' = 'مصروف صغير' LIMIT 1)) $$,
  'an admin can delete a ledger entry');
SELECT is(
  (public.admin_ledger_overview((SELECT id FROM public.teams WHERE slug = 'software')) #>> '{summary,balance}')::numeric,
  150::numeric,
  'deleting an expense restores the balance');
SELECT * FROM finish();
ROLLBACK;