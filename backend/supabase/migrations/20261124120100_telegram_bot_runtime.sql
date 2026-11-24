-- Round 28 (part 2) — Telegram bot runtime: bot-facing RPCs, event triggers and
-- the pg_cron/pg_net drain that keeps the outbox moving without a dashboard tab.
BEGIN;

-- 0) عمود تحكم للإعلانات ------------------------------------------------------
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS send_telegram BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS telegram_sent_at TIMESTAMPTZ;

-- 1) إعدادات البوت (service role فقط) ----------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_bot_config()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.telegram_settings;
BEGIN
  SELECT * INTO v_row FROM public.telegram_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'enabled', v_row.enabled,
    'token', v_row.bot_token,
    'bot_username', v_row.bot_username,
    'webhook_secret', v_row.webhook_secret,
    'drain_url', v_row.drain_url
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_bot_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_bot_config() TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_record_error(p_error TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.telegram_settings
  SET last_error = left(COALESCE(p_error, ''), 500), updated_at = now()
  WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.telegram_record_error(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_record_error(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_mark_webhook_set()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.telegram_settings SET webhook_set_at = now(), last_error = NULL WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.telegram_mark_webhook_set() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_mark_webhook_set() TO service_role;

-- 2) الربط -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_link_chat(
  p_code TEXT,
  p_chat_id BIGINT,
  p_username TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code public.telegram_link_codes;
  v_member BIGINT;
  v_name TEXT;
  v_is_admin BOOLEAN;
BEGIN
  IF p_chat_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CHAT');
  END IF;
  SELECT * INTO v_code FROM public.telegram_link_codes
  WHERE code = upper(btrim(COALESCE(p_code, ''))) AND used_at IS NULL AND expires_at > now()
  LIMIT 1;
  IF v_code.code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  END IF;

  SELECT b.member_id, m.full_name INTO v_member, v_name
  FROM public.member_auth_bindings AS b
  LEFT JOIN public.members AS m ON m.id = b.member_id
  WHERE b.auth_user_id = v_code.user_id
  LIMIT 1;

  -- شات واحد لكل مستخدم، ومستخدم واحد لكل شات.
  UPDATE public.telegram_links SET revoked_at = now()
  WHERE revoked_at IS NULL AND (user_id = v_code.user_id OR chat_id = p_chat_id);

  INSERT INTO public.telegram_links (user_id, member_id, chat_id, username, first_name)
  VALUES (v_code.user_id, v_member, p_chat_id, NULLIF(btrim(COALESCE(p_username, '')), ''), NULLIF(btrim(COALESCE(p_first_name, '')), ''));

  UPDATE public.telegram_link_codes SET used_at = now() WHERE code = v_code.code;

  SELECT EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_code.user_id) INTO v_is_admin;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_code.user_id,
    'member_id', v_member,
    'full_name', v_name,
    'is_admin', v_is_admin,
    'is_owner', public.is_owner_role(v_code.user_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_link_chat(TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_link_chat(TEXT, BIGINT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_bot_context(p_chat_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.telegram_links;
  v_name TEXT;
  v_email TEXT;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_link FROM public.telegram_links
  WHERE chat_id = p_chat_id AND revoked_at IS NULL LIMIT 1;
  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('linked', false);
  END IF;
  SELECT m.full_name, m.email INTO v_name, v_email FROM public.members AS m WHERE m.id = v_link.member_id;
  SELECT EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_link.user_id) INTO v_is_admin;
  UPDATE public.telegram_links SET last_seen_at = now() WHERE id = v_link.id;
  RETURN jsonb_build_object(
    'linked', true,
    'user_id', v_link.user_id,
    'member_id', v_link.member_id,
    'full_name', v_name,
    'email', v_email,
    'muted', v_link.muted,
    'is_admin', v_is_admin,
    'is_owner', public.is_owner_role(v_link.user_id),
    'can_manage_bot', public.telegram_admin_allowed(v_link.user_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_bot_context(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_bot_context(BIGINT) TO service_role;

-- 3) الصادر -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_claim_outbox(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id BIGINT, chat_id BIGINT, body TEXT, kind TEXT, attempts INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.telegram_outbox SET status = 'pending', updated_at = now()
  WHERE status = 'sending' AND updated_at < now() - INTERVAL '5 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM public.telegram_outbox AS o
    WHERE o.status = 'pending'
    ORDER BY o.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.telegram_outbox AS o
  SET status = 'sending', attempts = o.attempts + 1, updated_at = now()
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.id, o.chat_id, o.body, o.kind, o.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_claim_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_claim_outbox(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_complete_outbox(
  p_id BIGINT,
  p_ok BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_message_id BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.telegram_outbox AS o SET
    status = CASE WHEN p_ok THEN 'sent' ELSE CASE WHEN o.attempts >= 5 THEN 'failed' ELSE 'pending' END END,
    last_error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'unknown'), 400) END,
    telegram_message_id = COALESCE(p_message_id, o.telegram_message_id),
    sent_at = CASE WHEN p_ok THEN now() ELSE o.sent_at END,
    updated_at = now()
  WHERE o.id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_complete_outbox(BIGINT, BOOLEAN, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_complete_outbox(BIGINT, BOOLEAN, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_log_update(p_update_id BIGINT, p_chat_id BIGINT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted BOOLEAN := false;
BEGIN
  INSERT INTO public.telegram_updates (update_id, chat_id)
  VALUES (p_update_id, p_chat_id)
  ON CONFLICT (update_id) DO NOTHING;
  v_inserted := FOUND;
  UPDATE public.telegram_settings SET last_webhook_at = now() WHERE id = 1;
  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_log_update(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_log_update(BIGINT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_audit(
  p_chat_id BIGINT,
  p_user_id UUID,
  p_command TEXT,
  p_status TEXT DEFAULT 'ok',
  p_detail TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.telegram_command_audit (chat_id, user_id, command, status, detail)
  VALUES (p_chat_id, p_user_id, left(COALESCE(p_command, 'unknown'), 120), left(COALESCE(p_status, 'ok'), 40), left(p_detail, 500));
$$;
REVOKE ALL ON FUNCTION public.telegram_audit(BIGINT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_audit(BIGINT, UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_set_muted_for_chat(p_chat_id BIGINT, p_muted BOOLEAN DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_muted BOOLEAN;
BEGIN
  UPDATE public.telegram_links AS l
  SET muted = COALESCE(p_muted, NOT l.muted)
  WHERE l.chat_id = p_chat_id AND l.revoked_at IS NULL
  RETURNING l.muted INTO v_muted;
  RETURN COALESCE(v_muted, false);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_set_muted_for_chat(BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_set_muted_for_chat(BIGINT, BOOLEAN) TO service_role;

-- 4) بيانات للأوامر -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_member_bonus(p_member_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM((regexp_match(n.text, '\[B:([+-]?[0-9]{1,18})\]'))[1]::BIGINT), 0)
  FROM public.notes AS n
  WHERE n.target_member_id = p_member_id
    AND n.text ~ '\[B:[+-]?[0-9]{1,18}\]';
$$;
REVOKE ALL ON FUNCTION public.telegram_member_bonus(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_bonus(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_snapshot(p_member_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.members;
  v_bonus BIGINT;
  v_rank INTEGER;
  v_open INTEGER;
  v_late INTEGER;
  v_strikes INTEGER;
  v_due NUMERIC;
  v_next_meeting JSONB;
  v_last_eval JSONB;
BEGIN
  SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
  IF v_member.id IS NULL THEN RETURN NULL; END IF;
  v_bonus := public.telegram_member_bonus(p_member_id);

  SELECT 1 + count(*) INTO v_rank
  FROM public.members AS m2
  WHERE m2.id <> p_member_id
    AND COALESCE(public.telegram_member_bonus(m2.id), 0) > v_bonus;

  SELECT count(*) FILTER (WHERE COALESCE(t.tracking -> p_member_id::text ->> 'status', 'pending') NOT IN ('completed', 'approved')),
         count(*) FILTER (WHERE COALESCE(t.tracking -> p_member_id::text ->> 'status', 'pending') NOT IN ('completed', 'approved')
                            AND t.has_deadline AND t.deadline_date IS NOT NULL
                            AND t.deadline_date ~ '^\d{4}-\d{2}-\d{2}' AND t.deadline_date::date < current_date)
  INTO v_open, v_late
  FROM public.tasks AS t
  WHERE (t.assigned_to = to_jsonb('ALL'::text)
         OR (jsonb_typeof(t.assigned_to) = 'array' AND t.assigned_to ? p_member_id::text));

  SELECT count(*) INTO v_strikes FROM public.member_strikes WHERE member_id = p_member_id;

  SELECT COALESCE(SUM(d.amount), 0) - COALESCE((
      SELECT SUM(e.amount) FROM public.team_ledger_entries AS e
      WHERE e.member_id = p_member_id AND e.kind = 'payment' AND e.status = 'approved' AND e.due_id IS NOT NULL
    ), 0)
  INTO v_due
  FROM public.team_ledger_dues AS d
  WHERE d.member_id = p_member_id;

  SELECT jsonb_build_object('title', m.title, 'starts_at', m.starts_at, 'mode', m.mode, 'location', m.location)
  INTO v_next_meeting
  FROM public.meetings AS m
  WHERE m.status <> 'cancelled' AND m.starts_at > now()
    AND (
      COALESCE(m.audience ->> 'type', 'all') NOT IN ('members')
      OR (m.audience -> 'member_ids') ? p_member_id::text
    )
  ORDER BY m.starts_at LIMIT 1;

  SELECT jsonb_build_object('title', e.title, 'grade', e.grade, 'points', e.points, 'feedback', e.feedback, 'created_at', e.created_at)
  INTO v_last_eval
  FROM public.member_evaluations AS e
  WHERE e.member_id = p_member_id
  ORDER BY e.created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'member_id', v_member.id,
    'full_name', v_member.full_name,
    'email', v_member.email,
    'work_status', v_member.work_status,
    'academic_number', v_member.academic_number,
    'bonus', v_bonus,
    'rank', v_rank,
    'open_tasks', v_open,
    'late_tasks', v_late,
    'strikes', v_strikes,
    'dues_outstanding', v_due,
    'next_meeting', v_next_meeting,
    'last_evaluation', v_last_eval,
    'teams', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.team_memberships AS tm JOIN public.teams AS t ON t.id = tm.team_id
      WHERE tm.member_id = p_member_id AND tm.status = 'active'
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_snapshot(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_snapshot(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_tasks(p_member_id BIGINT, p_limit INTEGER DEFAULT 8)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'deadline', t.deadline_date,
    'status', COALESCE(t.tracking -> p_member_id::text ->> 'status', 'pending'),
    'note', t.tracking -> p_member_id::text ->> 'note'
  ) ORDER BY t.id DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM public.tasks AS t2
    WHERE (t2.assigned_to = to_jsonb('ALL'::text)
           OR (jsonb_typeof(t2.assigned_to) = 'array' AND t2.assigned_to ? p_member_id::text))
      AND COALESCE(t2.tracking -> p_member_id::text ->> 'status', 'pending') NOT IN ('completed', 'approved')
    ORDER BY t2.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20)
  ) AS t;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_tasks(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_tasks(BIGINT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_announcements(p_member_id BIGINT, p_limit INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'content', a.content, 'priority', a.priority, 'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM public.announcements AS a2
    WHERE a2.is_active
      AND (a2.expires_at IS NULL OR a2.expires_at > now())
      AND (
        COALESCE(a2.target_audience ->> 'type', 'all') = 'all'
        OR (a2.target_audience -> 'member_ids') ? p_member_id::text
      )
    ORDER BY a2.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
  ) AS a;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_announcements(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_announcements(BIGINT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_meetings(p_member_id BIGINT, p_limit INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'mode', m.mode,
    'location', m.location, 'online_url', m.online_url, 'attended',
    EXISTS (SELECT 1 FROM public.meeting_attendance AS ma WHERE ma.meeting_id = m.id AND ma.member_id = p_member_id)
  ) ORDER BY m.starts_at), '[]'::jsonb)
  FROM (
    SELECT * FROM public.meetings AS m2
    WHERE m2.status <> 'cancelled' AND m2.starts_at > now() - INTERVAL '2 hours'
      AND (
        COALESCE(m2.audience ->> 'type', 'all') <> 'members'
        OR (m2.audience -> 'member_ids') ? p_member_id::text
      )
    ORDER BY m2.starts_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
  ) AS m;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_meetings(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_meetings(BIGINT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_ledger(p_member_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_summary JSONB;
  v_mine JSONB;
BEGIN
  SELECT jsonb_build_object(
    'available', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'approved' THEN amount END), 0)
      - COALESCE(SUM(CASE WHEN kind IN ('expense', 'withdrawal') AND status = 'approved' THEN amount END), 0),
    'collected', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'approved' THEN amount END), 0),
    'expenses', COALESCE(SUM(CASE WHEN kind IN ('expense', 'withdrawal') AND status = 'approved' THEN amount END), 0),
    'pending', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'pending' THEN amount END), 0)
  ) INTO v_summary
  FROM public.team_ledger_entries;

  SELECT jsonb_build_object(
    'paid', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'approved' THEN amount END), 0),
    'pending', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'pending' THEN amount END), 0),
    'dues', COALESCE((SELECT SUM(amount) FROM public.team_ledger_dues WHERE member_id = p_member_id), 0)
  ) INTO v_mine
  FROM public.team_ledger_entries WHERE member_id = p_member_id;

  RETURN jsonb_build_object('summary', v_summary, 'mine', v_mine);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_ledger(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_ledger(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_evaluations(p_member_id BIGINT, p_limit INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id, 'title', e.title, 'grade', e.grade, 'points', e.points,
    'feedback', e.feedback, 'created_at', e.created_at
  ) ORDER BY e.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM public.member_evaluations AS e2
    WHERE e2.member_id = p_member_id
    ORDER BY e2.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
  ) AS e;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_evaluations(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_evaluations(BIGINT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_strikes(p_member_id BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'reason', s.reason, 'issued_by', s.issued_by_name, 'created_at', s.created_at
  ) ORDER BY s.created_at DESC), '[]'::jsonb)
  FROM public.member_strikes AS s WHERE s.member_id = p_member_id;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_strikes(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_strikes(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_references_all(p_team_slug TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'title', r.title, 'url', r.url, 'category', r.category,
    'team', t.name, 'description', r.description
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM public.reference_links AS r2
    WHERE p_team_slug IS NULL OR p_team_slug = ''
      OR r2.team_id IS NULL
      OR r2.team_id = (SELECT id FROM public.teams WHERE slug = p_team_slug LIMIT 1)
    ORDER BY r2.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30)
  ) AS r
  LEFT JOIN public.teams AS t ON t.id = r.team_id;
$$;
REVOKE ALL ON FUNCTION public.telegram_references_all(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_references_all(TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_leaderboard_top(p_limit INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH scored AS (
    SELECT m.id, m.full_name, m.bonus_infinite, COALESCE(public.telegram_member_bonus(m.id), 0) AS bonus
    FROM public.members AS m
  ), ranked AS (
    SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.bonus_infinite DESC, (CASE WHEN s.bonus_infinite THEN NULL ELSE s.bonus END) DESC NULLS LAST, s.id) AS rank
    FROM scored AS s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', r.rank, 'full_name', r.full_name, 'bonus', r.bonus, 'bonus_infinite', r.bonus_infinite) ORDER BY r.rank), '[]'::jsonb)
  FROM (SELECT * FROM ranked ORDER BY rank LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30)) AS r;
$$;
REVOKE ALL ON FUNCTION public.telegram_leaderboard_top(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_leaderboard_top(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_admin_snapshot()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM public.members),
    'admins', (SELECT count(*) FROM public.admin_accounts),
    'open_tasks', (SELECT count(*) FROM public.tasks),
    'pending_payments', (SELECT count(*) FROM public.team_ledger_entries WHERE kind = 'payment' AND status = 'pending'),
    'pending_capability_requests', (SELECT count(*) FROM public.admin_capability_requests WHERE status = 'pending'),
    'pending_account_deletions', (SELECT count(*) FROM public.member_deletion_requests WHERE status = 'pending'),
    'upcoming_meetings', (SELECT count(*) FROM public.meetings WHERE status <> 'cancelled' AND starts_at > now()),
    'linked_chats', (SELECT count(*) FROM public.telegram_links WHERE revoked_at IS NULL),
    'outbox_pending', (SELECT count(*) FROM public.telegram_outbox WHERE status IN ('pending', 'sending'))
  );
$$;
REVOKE ALL ON FUNCTION public.telegram_admin_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_admin_snapshot() TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_owner_requests()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'capability', r.capability, 'note', r.note,
    'requested_at', r.requested_at, 'email', u.email
  ) ORDER BY r.requested_at), '[]'::jsonb)
  FROM public.admin_capability_requests AS r
  LEFT JOIN auth.users AS u ON u.id = r.user_id
  WHERE r.status = 'pending';
$$;
REVOKE ALL ON FUNCTION public.telegram_owner_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_owner_requests() TO service_role;

-- 5) أفعال من البوت -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_decide_request(
  p_actor UUID,
  p_request_id BIGINT,
  p_approve BOOLEAN,
  p_minutes INTEGER DEFAULT 60,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.admin_capability_requests;
  v_minutes INTEGER := LEAST(GREATEST(COALESCE(p_minutes, 60), 15), 43200);
BEGIN
  IF p_actor IS NULL OR NOT public.is_owner_role(p_actor) THEN
    RAISE EXCEPTION 'OWNER_ONLY: القرار للمالك فقط.';
  END IF;
  SELECT * INTO v_req FROM public.admin_capability_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: الطلب غير موجود.'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'ALREADY_DECIDED: الطلب تم البت فيه.'; END IF;

  IF p_approve THEN
    UPDATE public.admin_capability_requests SET
      status = 'approved', decided_at = now(), decided_by = p_actor,
      decided_note = p_note, duration_minutes = v_minutes,
      expires_at = now() + make_interval(mins => v_minutes)
    WHERE id = v_req.id;
    INSERT INTO public.admin_capability_grants (user_id, capability, granted_by, expires_at)
    VALUES (v_req.user_id, v_req.capability, p_actor, now() + make_interval(mins => v_minutes));
    PERFORM public.telegram_enqueue(v_req.user_id, 'capability',
      format(E'تمت الموافقة على طلبك\nالصلاحية: %s\nالمدة: %s دقيقة', v_req.capability, v_minutes),
      jsonb_build_object('capability', v_req.capability), NULL);
    RETURN jsonb_build_object('ok', true, 'status', 'approved', 'minutes', v_minutes);
  END IF;

  UPDATE public.admin_capability_requests SET
    status = 'rejected', decided_at = now(), decided_by = p_actor, decided_note = p_note
  WHERE id = v_req.id;
  PERFORM public.telegram_enqueue(v_req.user_id, 'capability',
    format(E'تم رفض طلبك\nالصلاحية: %s%s', v_req.capability, CASE WHEN p_note IS NULL THEN '' ELSE E'\nالسبب: ' || p_note END),
    jsonb_build_object('capability', v_req.capability), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 'rejected');
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_decide_request(UUID, BIGINT, BOOLEAN, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_decide_request(UUID, BIGINT, BOOLEAN, INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_task_done(p_member_id BIGINT, p_task_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.tasks;
  v_entry JSONB;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: المهمة غير موجودة.'; END IF;
  IF NOT (v_task.assigned_to = to_jsonb('ALL'::text)
          OR (jsonb_typeof(v_task.assigned_to) = 'array' AND v_task.assigned_to ? p_member_id::text)) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED: المهمة مش مسندة لك.';
  END IF;
  v_entry := COALESCE(v_task.tracking -> p_member_id::text, '{}'::jsonb)
    || jsonb_build_object('status', 'completed', 'completed_at', now(), 'note', 'تم الإنهاء من تلجرام');
  UPDATE public.tasks SET tracking = jsonb_set(COALESCE(tracking, '{}'::jsonb), ARRAY[p_member_id::text], v_entry, true)
  WHERE id = p_task_id;
  RETURN jsonb_build_object('ok', true, 'task', v_task.title);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_task_done(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_task_done(BIGINT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_ledger_decide(
  p_actor UUID,
  p_entry_id BIGINT,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.team_ledger_entries;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: جلسة غير صالحة.'; END IF;
  SELECT * INTO v_entry FROM public.team_ledger_entries WHERE id = p_entry_id FOR UPDATE;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: العملية غير موجودة.'; END IF;
  IF v_entry.status <> 'pending' THEN RAISE EXCEPTION 'ALREADY_DECIDED: العملية تم البت فيها.'; END IF;
  IF NOT (v_entry.receiver_user_id = p_actor OR public.is_owner_role(p_actor)
          OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = p_actor)) THEN
    RAISE EXCEPTION 'FORBIDDEN: مالكش صلاحية تأكيد العملية دي.';
  END IF;
  UPDATE public.team_ledger_entries SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    decided_by = p_actor, decided_at = now(), decision_note = p_note, updated_at = now()
  WHERE id = p_entry_id;
  IF v_entry.member_id IS NOT NULL THEN
    PERFORM public.telegram_enqueue_member(v_entry.member_id, 'ledger',
      format(E'%s عمليتك بمبلغ %s%s',
        CASE WHEN p_approve THEN 'تم تأكيد' ELSE 'تم رفض' END,
        to_char(v_entry.amount, 'FM999G999G999D00'),
        CASE WHEN p_note IS NULL OR p_note = '' THEN '' ELSE E'\nملاحظة: ' || p_note END),
      jsonb_build_object('entry_id', v_entry.id), NULL);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_ledger_decide(UUID, BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_ledger_decide(UUID, BIGINT, BOOLEAN, TEXT) TO service_role;

-- 6) تريجرز الأحداث ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_notify_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
  v_member BIGINT;
BEGIN
  IF NOT COALESCE((SELECT notify_tasks FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  v_body := format(E'<b>مهمة جديدة</b>\n%s', NEW.title);
  IF NEW.has_deadline AND NEW.deadline_date IS NOT NULL THEN
    v_body := v_body || E'\nالموعد: ' || NEW.deadline_date;
  END IF;
  IF NEW.description IS NOT NULL AND btrim(NEW.description) <> '' THEN
    v_body := v_body || E'\n' || left(NEW.description, 300);
  END IF;
  IF NEW.assigned_to = to_jsonb('ALL'::text) THEN
    PERFORM public.telegram_enqueue_everyone('task', v_body, jsonb_build_object('task_id', NEW.id), NULL, NULL);
  ELSE
    FOR v_member IN SELECT (value)::bigint FROM jsonb_array_elements_text(COALESCE(NEW.assigned_to, '[]'::jsonb)) LOOP
      PERFORM public.telegram_enqueue_member(v_member, 'task', v_body,
        jsonb_build_object('task_id', NEW.id), 'task:' || NEW.id || ':' || v_member);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_task() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_task() TO service_role;
DROP TRIGGER IF EXISTS telegram_task_created ON public.tasks;
CREATE TRIGGER telegram_task_created AFTER INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_task();

CREATE OR REPLACE FUNCTION public.telegram_notify_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
  v_member BIGINT;
  v_type TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_announcements FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  IF NOT NEW.is_active OR NOT COALESCE(NEW.send_telegram, true) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) THEN RETURN NEW; END IF;
  v_body := format(E'<b>إعلان</b>\n%s\n\n%s', NEW.title, left(COALESCE(NEW.content, ''), 900));
  IF NEW.priority IN ('high', 'urgent', 'critical') THEN
    v_body := E'<b>إعلان مهم</b>\n' || NEW.title || E'\n\n' || left(COALESCE(NEW.content, ''), 900);
  END IF;
  v_type := COALESCE(NEW.target_audience ->> 'type', 'all');
  IF v_type = 'specific' THEN
    FOR v_member IN SELECT (value)::bigint FROM jsonb_array_elements_text(COALESCE(NEW.target_audience -> 'member_ids', '[]'::jsonb)) LOOP
      PERFORM public.telegram_enqueue_member(v_member, 'announcement', v_body,
        jsonb_build_object('announcement_id', NEW.id), 'ann:' || NEW.id || ':' || v_member);
    END LOOP;
  ELSE
    PERFORM public.telegram_enqueue_everyone('announcement', v_body,
      jsonb_build_object('announcement_id', NEW.id), NULL, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_announcement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_announcement() TO service_role;
DROP TRIGGER IF EXISTS telegram_announcement_created ON public.announcements;
CREATE TRIGGER telegram_announcement_created AFTER INSERT OR UPDATE OF is_active ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_announcement();

CREATE OR REPLACE FUNCTION public.telegram_notify_evaluation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_evaluations FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  v_body := format(E'<b>تقييم جديد</b>\n%s\nالتقدير: %s\nالنقاط: %s',
    COALESCE(NEW.title, 'تقييم'), COALESCE(NEW.grade, '—'), COALESCE(NEW.points, 0));
  IF NEW.feedback IS NOT NULL AND btrim(NEW.feedback) <> '' THEN
    v_body := v_body || E'\n' || left(NEW.feedback, 400);
  END IF;
  PERFORM public.telegram_enqueue_member(NEW.member_id, 'evaluation', v_body,
    jsonb_build_object('evaluation_id', NEW.id), 'eval:' || NEW.id);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_evaluation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_evaluation() TO service_role;
DROP TRIGGER IF EXISTS telegram_evaluation_created ON public.member_evaluations;
CREATE TRIGGER telegram_evaluation_created AFTER INSERT ON public.member_evaluations
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_evaluation();

CREATE OR REPLACE FUNCTION public.telegram_notify_strike()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
  v_count INTEGER;
BEGIN
  IF NOT COALESCE((SELECT notify_strikes FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.member_strikes WHERE member_id = NEW.member_id;
  v_body := format(E'<b>تحذير (Strike)</b>\nالسبب: %s\nعدد التحذيرات: %s من 3', COALESCE(NEW.reason, '—'), v_count);
  IF v_count >= 3 THEN
    v_body := v_body || E'\nده آخر تحذير، الحساب تحت المراجعة.';
  END IF;
  PERFORM public.telegram_enqueue_member(NEW.member_id, 'strike', v_body,
    jsonb_build_object('strike_id', NEW.id), 'strike:' || NEW.id);
  PERFORM public.telegram_enqueue_admins('strike',
    format(E'تحذير جديد\n%s\nالسبب: %s\nالإجمالي: %s', COALESCE(NEW.issued_by_name, 'إدارة'), COALESCE(NEW.reason, '—'), v_count),
    jsonb_build_object('strike_id', NEW.id), false, 'strike-admin:' || NEW.id);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_strike() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_strike() TO service_role;
DROP TRIGGER IF EXISTS telegram_strike_created ON public.member_strikes;
CREATE TRIGGER telegram_strike_created AFTER INSERT ON public.member_strikes
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_strike();

CREATE OR REPLACE FUNCTION public.telegram_notify_meeting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
  v_member BIGINT;
  v_type TEXT;
  v_team TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_meetings FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  v_body := format(E'<b>اجتماع جديد</b>\n%s\nالموعد: %s\nالنوع: %s',
    NEW.title,
    to_char(NEW.starts_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'),
    CASE WHEN NEW.mode = 'online' THEN 'أونلاين' ELSE 'أوفلاين' END);
  IF NEW.mode = 'online' AND NEW.online_url IS NOT NULL THEN
    v_body := v_body || E'\nالرابط: ' || NEW.online_url;
  ELSIF NEW.location IS NOT NULL THEN
    v_body := v_body || E'\nالمكان: ' || NEW.location;
  END IF;
  v_type := COALESCE(NEW.audience ->> 'type', 'all');
  IF v_type = 'members' THEN
    FOR v_member IN SELECT (value)::bigint FROM jsonb_array_elements_text(COALESCE(NEW.audience -> 'member_ids', '[]'::jsonb)) LOOP
      PERFORM public.telegram_enqueue_member(v_member, 'meeting', v_body,
        jsonb_build_object('meeting_id', NEW.id), 'meeting:' || NEW.id || ':' || v_member);
    END LOOP;
  ELSIF v_type = 'teams' THEN
    FOR v_team IN SELECT jsonb_array_elements_text(COALESCE(NEW.audience -> 'teams', '[]'::jsonb)) LOOP
      PERFORM public.telegram_enqueue_everyone('meeting', v_body,
        jsonb_build_object('meeting_id', NEW.id), v_team, NULL);
    END LOOP;
  ELSE
    PERFORM public.telegram_enqueue_everyone('meeting', v_body,
      jsonb_build_object('meeting_id', NEW.id), NULL, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_meeting() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_meeting() TO service_role;
DROP TRIGGER IF EXISTS telegram_meeting_created ON public.meetings;
CREATE TRIGGER telegram_meeting_created AFTER INSERT ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_meeting();

CREATE OR REPLACE FUNCTION public.telegram_notify_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_meetings FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  SELECT title INTO v_title FROM public.meetings WHERE id = NEW.meeting_id;
  PERFORM public.telegram_enqueue_member(NEW.member_id, 'attendance',
    format(E'تم تسجيل حضورك\nالاجتماع: %s', COALESCE(v_title, '—')),
    jsonb_build_object('meeting_id', NEW.meeting_id), 'attend:' || NEW.meeting_id || ':' || NEW.member_id);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_attendance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_attendance() TO service_role;
DROP TRIGGER IF EXISTS telegram_attendance_marked ON public.meeting_attendance;
CREATE TRIGGER telegram_attendance_marked AFTER INSERT ON public.meeting_attendance
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_attendance();

CREATE OR REPLACE FUNCTION public.telegram_notify_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_ledger FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'payment' AND NEW.status = 'pending' AND NEW.receiver_user_id IS NOT NULL THEN
      v_body := format(E'<b>دفعة بانتظار تأكيدك</b>\n%s\nالمبلغ: %s\nمن: %s',
        COALESCE(NEW.title, 'دفعة'),
        to_char(NEW.amount, 'FM999G999G999D00'),
        COALESCE((SELECT full_name FROM public.members WHERE id = NEW.member_id), 'عضو'));
      IF NEW.note IS NOT NULL AND btrim(NEW.note) <> '' THEN
        v_body := v_body || E'\nملاحظة: ' || left(NEW.note, 200);
      END IF;
      PERFORM public.telegram_enqueue(NEW.receiver_user_id, 'ledger', v_body,
        jsonb_build_object('entry_id', NEW.id, 'action', 'decide'), 'ledger-recv:' || NEW.id);
    ELSIF NEW.kind IN ('expense', 'withdrawal') THEN
      PERFORM public.telegram_enqueue_admins('ledger',
        format(E'حركة خزنة جديدة\n%s\nالمبلغ: %s\nالحالة: %s',
          COALESCE(NEW.title, NEW.kind), to_char(NEW.amount, 'FM999G999G999D00'), NEW.status),
        jsonb_build_object('entry_id', NEW.id), false, 'ledger-admin:' || NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.member_id IS NOT NULL THEN
    PERFORM public.telegram_enqueue_member(NEW.member_id, 'ledger',
      format(E'تحديث على عمليتك\n%s\nالمبلغ: %s\nالحالة: %s',
        COALESCE(NEW.title, 'عملية'), to_char(NEW.amount, 'FM999G999G999D00'),
        CASE NEW.status WHEN 'approved' THEN 'مقبولة' WHEN 'rejected' THEN 'مرفوضة' ELSE NEW.status END),
      jsonb_build_object('entry_id', NEW.id), 'ledger-status:' || NEW.id || ':' || NEW.status);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_ledger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_ledger() TO service_role;
DROP TRIGGER IF EXISTS telegram_ledger_event ON public.team_ledger_entries;
CREATE TRIGGER telegram_ledger_event AFTER INSERT OR UPDATE OF status ON public.team_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_ledger();

CREATE OR REPLACE FUNCTION public.telegram_notify_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body TEXT;
  v_slug TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_references FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  SELECT slug INTO v_slug FROM public.teams WHERE id = NEW.team_id;
  v_body := format(E'<b>مصدر جديد</b>\n%s\n%s', NEW.title, NEW.url);
  IF NEW.description IS NOT NULL AND btrim(NEW.description) <> '' THEN
    v_body := v_body || E'\n' || left(NEW.description, 200);
  END IF;
  IF NEW.team_id IS NULL THEN
    PERFORM public.telegram_enqueue_everyone('reference', v_body,
      jsonb_build_object('reference_id', NEW.id), NULL, NULL);
  ELSE
    PERFORM public.telegram_enqueue_everyone('reference', v_body,
      jsonb_build_object('reference_id', NEW.id), v_slug, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_reference() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_reference() TO service_role;
DROP TRIGGER IF EXISTS telegram_reference_created ON public.reference_links;
CREATE TRIGGER telegram_reference_created AFTER INSERT ON public.reference_links
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_reference();

CREATE OR REPLACE FUNCTION public.telegram_notify_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE((SELECT notify_projects FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  PERFORM public.telegram_enqueue_admins('project',
    format(E'<b>مشروع ويب</b>\n%s\nالحالة: %s', NEW.name, COALESCE(NEW.status, '—')),
    jsonb_build_object('project_id', NEW.id), false,
    'project:' || NEW.id || ':' || COALESCE(NEW.status, 'new'));
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_project() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_project() TO service_role;
DROP TRIGGER IF EXISTS telegram_project_event ON public.web_projects;
CREATE TRIGGER telegram_project_event AFTER INSERT OR UPDATE OF status ON public.web_projects
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_project();

CREATE OR REPLACE FUNCTION public.telegram_notify_capability_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE((SELECT notify_capability FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.telegram_enqueue_admins('capability',
      format(E'<b>طلب صلاحية جديد</b>\nالصلاحية: %s\nمن: %s%s',
        NEW.capability,
        COALESCE((SELECT email FROM auth.users WHERE id = NEW.user_id), '—'),
        CASE WHEN NEW.note IS NULL OR NEW.note = '' THEN '' ELSE E'\nملاحظة: ' || left(NEW.note, 200) END),
      jsonb_build_object('request_id', NEW.id, 'action', 'decide'), true,
      'cap-req:' || NEW.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'pending' THEN
    PERFORM public.telegram_enqueue(NEW.user_id, 'capability',
      format(E'تم البت في طلبك\nالصلاحية: %s\nالنتيجة: %s',
        NEW.capability,
        CASE NEW.status WHEN 'approved' THEN 'موافقة' WHEN 'rejected' THEN 'رفض' ELSE NEW.status END),
      jsonb_build_object('request_id', NEW.id), 'cap-res:' || NEW.id || ':' || NEW.status);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_capability_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_capability_request() TO service_role;
DROP TRIGGER IF EXISTS telegram_capability_event ON public.admin_capability_requests;
CREATE TRIGGER telegram_capability_event AFTER INSERT OR UPDATE OF status ON public.admin_capability_requests
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_capability_request();

CREATE OR REPLACE FUNCTION public.telegram_notify_account_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE((SELECT notify_accounts FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.telegram_enqueue_admins('account',
      format(E'<b>طلب حذف حساب</b>\nالعضو: %s\nالسبب: %s',
        COALESCE(NEW.member_name, '—'), COALESCE(NEW.member_reason, '—')),
      jsonb_build_object('request_id', NEW.id), false, 'del-req:' || NEW.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.member_id IS NOT NULL THEN
    PERFORM public.telegram_enqueue_member(NEW.member_id, 'account',
      format(E'تحديث على طلب حذف حسابك\nالحالة: %s', NEW.status),
      jsonb_build_object('request_id', NEW.id), 'del-res:' || NEW.id || ':' || NEW.status);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_account_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_account_request() TO service_role;
DROP TRIGGER IF EXISTS telegram_account_request_event ON public.member_deletion_requests;
CREATE TRIGGER telegram_account_request_event AFTER INSERT OR UPDATE OF status ON public.member_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_account_request();

CREATE OR REPLACE FUNCTION public.telegram_notify_bonus()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE((SELECT notify_bonus FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  PERFORM public.telegram_enqueue_member(NEW.member_id, 'bonus',
    format(E'<b>تحديث على البونص</b>\n%s\nالسبب: %s',
      CASE WHEN NEW.enabled THEN 'البونص المفتوح اتفعّل' ELSE 'البونص المفتوح اتقفل' END,
      COALESCE(NEW.reason, '—')),
    jsonb_build_object('event_id', NEW.id), 'bonus:' || NEW.id);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_bonus() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_bonus() TO service_role;
DROP TRIGGER IF EXISTS telegram_bonus_event ON public.member_infinite_bonus_events;
CREATE TRIGGER telegram_bonus_event AFTER INSERT ON public.member_infinite_bonus_events
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_bonus();

CREATE OR REPLACE FUNCTION public.telegram_notify_note()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF NOT COALESCE((SELECT notify_notes FROM public.telegram_settings WHERE id = 1), false) THEN RETURN NEW; END IF;
  IF NEW.target_member_id IS NULL THEN RETURN NEW; END IF;
  v_text := btrim(regexp_replace(COALESCE(NEW.text, ''), '\[B:[+-]?[0-9]{1,18}\]', '', 'g'));
  IF v_text = '' THEN RETURN NEW; END IF;
  PERFORM public.telegram_enqueue_member(NEW.target_member_id, 'note',
    format(E'<b>ملاحظة من %s</b>\n%s', COALESCE(NEW.author, 'الإدارة'), left(v_text, 700)),
    jsonb_build_object('note_id', NEW.id), 'note:' || NEW.id);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_notify_note() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_notify_note() TO service_role;
DROP TRIGGER IF EXISTS telegram_note_created ON public.notes;
CREATE TRIGGER telegram_note_created AFTER INSERT ON public.notes
FOR EACH ROW EXECUTE FUNCTION public.telegram_notify_note();

-- 7) مجدول السحب عبر pg_cron + pg_net ---------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_cron_drain()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.telegram_settings;
BEGIN
  SELECT * INTO v_row FROM public.telegram_settings WHERE id = 1;
  IF NOT v_row.enabled OR v_row.bot_token IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.telegram_outbox WHERE status = 'pending') THEN RETURN; END IF;
  BEGIN
    PERFORM net.http_post(
      url := v_row.drain_url,
      body := '{"action":"drain"}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-telegram-secret', v_row.webhook_secret),
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN others THEN
    PERFORM public.telegram_record_error('cron: ' || SQLERRM);
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_cron_drain() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_cron_drain() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('phantoms-telegram-drain')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phantoms-telegram-drain');
    PERFORM cron.schedule('phantoms-telegram-drain', '* * * * *', 'SELECT public.telegram_cron_drain();');
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

COMMIT;
