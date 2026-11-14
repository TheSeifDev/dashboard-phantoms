-- 05 — Atomic task approval and reversal, rank cap, bonus notes, the
-- [B:±n] tag contract shared with the frontend, admin ratings (0023 repair),
-- and the audited infinite-bonus flag.
BEGIN;
\ir _helpers.psql

SELECT plan(40);

-- Fixtures (as postgres) ------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n) FROM unnest(ARRAY['tasks_admin','ranking_admin','notes_admin','outsider']) AS n;
  PERFORM phantoms_test.grant_admin('tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.grant_admin('ranking_admin', 'admin', phantoms_test.perms('ranking'));
  PERFORM phantoms_test.grant_admin('notes_admin', 'admin', phantoms_test.perms('notes'));
  PERFORM phantoms_test.create_member('alice');
  PERFORM phantoms_test.create_member('bob');
  PERFORM phantoms_test.bind_device('alice');
  UPDATE public.members SET completion_rank = 98 WHERE id = phantoms_test.mid('bob');
  INSERT INTO public.tasks (title, assigned_to, bonus_points, tracking)
  VALUES ('Ship it [B:+40]', jsonb_build_array(phantoms_test.mid('alice'), phantoms_test.mid('bob')), 4,
          jsonb_build_object(phantoms_test.mid('alice')::text, '{"status":"under_review"}'::jsonb,
                             phantoms_test.mid('bob')::text, '{"status":"under_review"}'::jsonb));
  INSERT INTO phantoms_test.vars VALUES ('task', (SELECT id::text FROM public.tasks WHERE title LIKE 'Ship it%'));
END $$;

-- Approval authorization ------------------------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 0)$$,
  '42501', NULL, 'anon cannot execute approve_task_submission');
SELECT throws_ok($$SELECT public.revoke_task_approval(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 'reason')$$,
  '42501', NULL, 'anon cannot execute revoke_task_approval');
SELECT throws_ok($$SELECT public.admin_add_member_rating(phantoms_test.mid('alice'), 5, 'x', NULL)$$,
  '42501', NULL, 'anon cannot execute admin_add_member_rating');
RESET ROLE;
SELECT phantoms_test.login_as('outsider');
SELECT throws_like($$SELECT public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 0)$$,
  '%TASKS_PERMISSION_REQUIRED%', 'authenticated non-admin cannot approve');
RESET ROLE;
SELECT phantoms_test.login_as('ranking_admin');
SELECT throws_like($$SELECT public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 0)$$,
  '%TASKS_PERMISSION_REQUIRED%', 'admin without the tasks key cannot approve');
RESET ROLE;

-- Approval effects ----------------------------------------------------------------
SELECT phantoms_test.login_as('tasks_admin');
SELECT throws_like($$SELECT public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 51)$$,
  '%INVALID_BONUS%', 'bonus above 50 is rejected');
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('tasks_admin');
INSERT INTO phantoms_test.vars
SELECT 'approve_alice', public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 2)::text;
SELECT is((phantoms_test.var('approve_alice')::jsonb ->> 'bonus_awarded')::int, 4,
  'awarded bonus is GREATEST(requested 2, task bonus_points 4)');
SELECT is((phantoms_test.var('approve_alice')::jsonb ->> 'completion_rank')::int, 9, 'rank increases by 5 + bonus (0 → 9)');
SELECT is((phantoms_test.var('approve_alice')::jsonb ->> 'total_bonus')::bigint, 4::bigint,
  'returned total_bonus counts the new [B:+4] note only (title tag [B:+40] stripped)');
SELECT throws_like($$SELECT public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 0)$$,
  '%ALREADY_APPROVED%', 'double approval is rejected');
INSERT INTO phantoms_test.vars
SELECT 'approve_bob', public.approve_task_submission(phantoms_test.var('task')::bigint, phantoms_test.mid('bob'), 0)::text;
SELECT is((phantoms_test.var('approve_bob')::jsonb ->> 'completion_rank')::int, 100, 'rank is capped at 100 (98 + 9 → 100)');
SELECT is((phantoms_test.var('approve_bob')::jsonb ->> 'rank_awarded')::int, 2, 'rank_awarded records the capped delta (2)');
RESET ROLE;
SELECT phantoms_test.clear_auth();

SELECT is((SELECT text FROM public.notes WHERE source_task_id = phantoms_test.var('task')::bigint AND target_member_id = phantoms_test.mid('alice')),
  '[B:+4] مكافأة إنجاز مهمة: Ship it ', 'approval writes one linked bonus note with the frontend [B:+n] tag');
SELECT is((SELECT tracking -> phantoms_test.mid('alice')::text ->> 'status' FROM public.tasks WHERE id = phantoms_test.var('task')::bigint),
  'approved', 'tracking entry is marked approved');
SELECT is((SELECT (tracking -> phantoms_test.mid('alice')::text ->> 'bonus_note_id')::bigint FROM public.tasks WHERE id = phantoms_test.var('task')::bigint),
  (SELECT id FROM public.notes WHERE source_task_id = phantoms_test.var('task')::bigint AND target_member_id = phantoms_test.mid('alice')),
  'tracking stores the bonus note id for exact reversal');

-- Members cannot touch an approved entry --------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice'), 'pending', '', '')$$,
  '%ADMIN_APPROVAL_FORBIDDEN%', 'member cannot overwrite an approved submission');
RESET ROLE;

-- Reversal --------------------------------------------------------------------------
SELECT phantoms_test.login_as('tasks_admin');
SELECT throws_like($$SELECT public.revoke_task_approval(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), ' [B:+99] ')$$,
  '%REVOCATION_REASON_REQUIRED%', 'a reason consisting only of a bonus tag is rejected after stripping');
INSERT INTO phantoms_test.vars
SELECT 'revoke_alice', public.revoke_task_approval(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 'Wrong file [B:+99]')::text;
SELECT is((phantoms_test.var('revoke_alice')::jsonb ->> 'completion_rank')::int, 0, 'reversal restores alice''s rank exactly (9 → 0)');
SELECT is((phantoms_test.var('revoke_alice')::jsonb ->> 'bonus_reversed')::int, 4, 'reversal reports the bonus it removed');
SELECT throws_like($$SELECT public.revoke_task_approval(phantoms_test.var('task')::bigint, phantoms_test.mid('alice'), 'again please')$$,
  '%NOT_APPROVED%', 'cannot revoke twice');
INSERT INTO phantoms_test.vars
SELECT 'revoke_bob', public.revoke_task_approval(phantoms_test.var('task')::bigint, phantoms_test.mid('bob'), 'Cap check')::text;
SELECT is((phantoms_test.var('revoke_bob')::jsonb ->> 'completion_rank')::int, 98, 'capped approval reverses to the original 98, not 91');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::int FROM public.notes WHERE target_member_id = phantoms_test.mid('alice') AND text ~ '\[B:'), 0,
  'the approval bonus note is deleted and the revocation note carries no bonus tag');
SELECT is((SELECT tracking -> phantoms_test.mid('alice')::text ->> 'status' FROM public.tasks WHERE id = phantoms_test.var('task')::bigint),
  'revision_requested', 'reversed entry returns to revision_requested');
SELECT is((SELECT tracking -> phantoms_test.mid('alice')::text ->> 'approval_reversal_reason' FROM public.tasks WHERE id = phantoms_test.var('task')::bigint),
  'Wrong file', 'reversal reason is recorded without injected tags');
SELECT phantoms_test.login_anon();
SELECT is(public.get_member_bonus_total(phantoms_test.mid('alice'), phantoms_test.tok('alice')), 0::bigint,
  'member bonus total is back to 0 after reversal');
RESET ROLE;

-- Admin ratings (0023 repair) ---------------------------------------------------
SELECT phantoms_test.login_as('tasks_admin');
SELECT throws_like($$SELECT public.admin_add_member_rating(phantoms_test.mid('alice'), 3, 'Nice', NULL)$$,
  '%RANKING_PERMISSION_REQUIRED%', 'ratings require the ranking key');
RESET ROLE;
SELECT phantoms_test.login_as('ranking_admin');
SELECT throws_like($$SELECT public.admin_add_member_rating(phantoms_test.mid('alice'), 6, 'Too much', NULL)$$,
  '%INVALID_RATING%', 'ratings above +5 are rejected');
SELECT throws_like($$SELECT public.admin_add_member_rating(phantoms_test.mid('alice'), -6, 'Too low', NULL)$$,
  '%INVALID_RATING%', 'ratings below −5 are rejected');
SELECT throws_like($$SELECT public.admin_add_member_rating(phantoms_test.mid('alice'), 2, '  ', NULL)$$,
  '%RATING_REASON_REQUIRED%', 'an empty rating reason is rejected');
SELECT throws_like($$SELECT public.admin_add_member_rating(999999999, 2, 'Ghost', NULL)$$,
  '%MEMBER_NOT_FOUND%', 'rating an unknown member is rejected');
INSERT INTO phantoms_test.vars
SELECT 'rating_pos', public.admin_add_member_rating(phantoms_test.mid('alice'), 3, 'Great demo [B:+50]', NULL)::text;
INSERT INTO phantoms_test.vars
SELECT 'rating_neg', public.admin_add_member_rating(phantoms_test.mid('alice'), -2, 'Missed standup', 'Lead')::text;
INSERT INTO phantoms_test.vars
SELECT 'rating_zero', public.admin_add_member_rating(phantoms_test.mid('alice'), 0, 'Neutral', NULL)::text;
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT text FROM public.notes WHERE id = phantoms_test.var('rating_pos')::bigint), 'Great demo [B:+3]',
  'positive rating uses the [B:+n] tag and strips the injected [B:+50]');
SELECT is((SELECT text FROM public.notes WHERE id = phantoms_test.var('rating_neg')::bigint), 'Missed standup [B:-2]',
  'negative rating uses the [B:-n] tag');
SELECT is((SELECT text FROM public.notes WHERE id = phantoms_test.var('rating_zero')::bigint), 'Neutral',
  'zero rating carries no tag');
SELECT is((SELECT count(*)::int FROM public.notes WHERE target_member_id = phantoms_test.mid('alice') AND text LIKE '%[[BONUS:%'), 0,
  'the unparsed [[BONUS:n]] format is never written');
SELECT is((SELECT author || '|' || author_role FROM public.notes WHERE id = phantoms_test.var('rating_pos')::bigint),
  'إدارة PHANTOMS|Admin', 'default author is the PHANTOMS identity and author_role is Admin');
SELECT is((SELECT author FROM public.notes WHERE id = phantoms_test.var('rating_neg')::bigint), 'Lead', 'explicit author is kept');
SELECT phantoms_test.login_anon();
SELECT is(public.get_member_bonus_total(phantoms_test.mid('alice'), phantoms_test.tok('alice')), 1::bigint,
  'portal bonus total counts ratings exactly (+3 −2 = 1); the injected +50 is not counted');
RESET ROLE;

-- Infinite bonus flag ---------------------------------------------------------
SELECT phantoms_test.login_as('notes_admin');
SELECT throws_like($$SELECT public.set_member_bonus_infinite(phantoms_test.mid('alice'), true, 'Top performer')$$,
  '%RANKING_PERMISSION_REQUIRED%', 'infinite bonus requires the ranking key');
RESET ROLE;
SELECT phantoms_test.login_as('ranking_admin');
SELECT throws_like($$SELECT public.set_member_bonus_infinite(phantoms_test.mid('alice'), true, 'no')$$,
  '%BONUS_REASON_REQUIRED%', 'infinite bonus requires a 3+ character reason');
SELECT is(public.set_member_bonus_infinite(phantoms_test.mid('alice'), true, 'Top performer'), true,
  'ranking admin enables infinite bonus through the RPC');
SELECT throws_like($$SELECT public.set_member_bonus_infinite(phantoms_test.mid('alice'), true, 'Top performer')$$,
  '%BONUS_STATE_UNCHANGED%', 'no-op toggles are rejected');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::int FROM public.member_infinite_bonus_events WHERE member_id = phantoms_test.mid('alice') AND enabled), 1,
  'the toggle is written to the immutable audit log with the actor');

SELECT * FROM finish();
ROLLBACK;
