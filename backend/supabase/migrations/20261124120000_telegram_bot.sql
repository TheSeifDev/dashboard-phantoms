-- Round 28 — Telegram team bot replaces WhatsApp.
--
-- One bot, one webhook, every PHANTOMS surface:
--   * linking members/admins to Telegram chats with one-time codes,
--   * a durable outbox that every table event feeds (tasks, announcements,
--     evaluations, strikes, meetings, attendance, ledger, references, web
--     projects, capability requests, account deletion, bonus, notes),
--   * bot RPCs so the edge function can answer /me /tasks /points /ranking
--     /announcements /meetings /ledger /refs /strikes /evals /team /projects
--     /requests and act on inline buttons,
--   * a pg_cron + pg_net drain job so queued messages leave even when nobody
--     has the dashboard open.
BEGIN;

-- 1) الإعدادات ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  bot_token TEXT,
  bot_username TEXT,
  webhook_secret TEXT NOT NULL,
  drain_url TEXT NOT NULL DEFAULT 'https://wxwoaputugxwysuhcebv.supabase.co/functions/v1/telegram-bot',
  notify_tasks BOOLEAN NOT NULL DEFAULT true,
  notify_announcements BOOLEAN NOT NULL DEFAULT true,
  notify_evaluations BOOLEAN NOT NULL DEFAULT true,
  notify_strikes BOOLEAN NOT NULL DEFAULT true,
  notify_meetings BOOLEAN NOT NULL DEFAULT true,
  notify_ledger BOOLEAN NOT NULL DEFAULT true,
  notify_references BOOLEAN NOT NULL DEFAULT true,
  notify_projects BOOLEAN NOT NULL DEFAULT true,
  notify_capability BOOLEAN NOT NULL DEFAULT true,
  notify_accounts BOOLEAN NOT NULL DEFAULT true,
  notify_bonus BOOLEAN NOT NULL DEFAULT true,
  notify_notes BOOLEAN NOT NULL DEFAULT true,
  last_error TEXT,
  last_webhook_at TIMESTAMPTZ,
  webhook_set_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO public.telegram_settings (id, webhook_secret)
VALUES (1, replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', ''))
ON CONFLICT (id) DO NOTHING;

-- 2) الربط بين المستخدم والشات ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_links (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES public.members (id) ON DELETE SET NULL,
  chat_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  muted BOOLEAN NOT NULL DEFAULT false,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_active_user_idx
  ON public.telegram_links (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_active_chat_idx
  ON public.telegram_links (chat_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS telegram_links_member_idx ON public.telegram_links (member_id);

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON public.telegram_link_codes (user_id, expires_at DESC);

-- 3) صندوق الصادر -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  user_id UUID,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  telegram_message_id BIGINT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_outbox_dedupe_idx
  ON public.telegram_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS telegram_outbox_status_idx ON public.telegram_outbox (status, id);
CREATE INDEX IF NOT EXISTS telegram_outbox_chat_idx ON public.telegram_outbox (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.telegram_updates (
  update_id BIGINT PRIMARY KEY,
  chat_id BIGINT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telegram_command_audit (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT,
  user_id UUID,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_command_audit_created_idx ON public.telegram_command_audit (created_at DESC);

-- 4) RLS: كل الوصول عبر RPC فقط ---------------------------------------------
ALTER TABLE public.telegram_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_command_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.telegram_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_link_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_updates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_command_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_settings, public.telegram_links, public.telegram_link_codes,
  public.telegram_outbox, public.telegram_updates, public.telegram_command_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.telegram_links_id_seq, public.telegram_outbox_id_seq,
  public.telegram_command_audit_id_seq TO service_role;

-- 5) مساعدات داخلية ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_settings_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT s.enabled FROM public.telegram_settings AS s WHERE s.id = 1), false);
$$;
REVOKE ALL ON FUNCTION public.telegram_settings_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_settings_enabled() TO service_role;

-- المشرف المسموح له بإدارة بوت التلجرام (المالك أو من عنده صلاحية المراسلة).
CREATE OR REPLACE FUNCTION public.telegram_admin_allowed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN public.is_owner_role(p_user_id) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.admin_accounts AS a
      WHERE a.user_id = p_user_id
        AND COALESCE((a.permissions ->> 'whatsapp')::boolean, false)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.telegram_admin_allowed(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_admin_allowed(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.telegram_member_user_id(p_member_id BIGINT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.auth_user_id FROM public.member_auth_bindings AS b WHERE b.member_id = p_member_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_user_id(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_member_user_id(BIGINT) TO service_role;

-- إدخال رسالة في الصادر لمستخدم واحد (بيتجاهل لو البوت مقفول أو الشات مش مربوط).
CREATE OR REPLACE FUNCTION public.telegram_enqueue(
  p_user_id UUID,
  p_kind TEXT,
  p_body TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb,
  p_dedupe TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_chat BIGINT;
  v_id BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_body IS NULL OR btrim(p_body) = '' THEN RETURN NULL; END IF;
  IF NOT public.telegram_settings_enabled() THEN RETURN NULL; END IF;
  SELECT l.chat_id INTO v_chat
  FROM public.telegram_links AS l
  WHERE l.user_id = p_user_id AND l.revoked_at IS NULL AND l.muted = false
  LIMIT 1;
  IF v_chat IS NULL THEN RETURN NULL; END IF;
  IF p_dedupe IS NOT NULL AND EXISTS (SELECT 1 FROM public.telegram_outbox AS o WHERE o.dedupe_key = p_dedupe) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.telegram_outbox (chat_id, user_id, kind, body, meta, dedupe_key)
  VALUES (v_chat, p_user_id, p_kind, left(p_body, 3900), COALESCE(p_meta, '{}'::jsonb), p_dedupe)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_enqueue(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_enqueue(UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_enqueue_member(
  p_member_id BIGINT,
  p_kind TEXT,
  p_body TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb,
  p_dedupe TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.telegram_enqueue(public.telegram_member_user_id(p_member_id), p_kind, p_body, p_meta, p_dedupe);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_enqueue_member(BIGINT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_enqueue_member(BIGINT, TEXT, TEXT, JSONB, TEXT) TO service_role;

-- كل المشرفين (أو المالك بس لو p_owner_only).
CREATE OR REPLACE FUNCTION public.telegram_enqueue_admins(
  p_kind TEXT,
  p_body TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb,
  p_owner_only BOOLEAN DEFAULT false,
  p_dedupe TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_user IN
    SELECT a.user_id FROM public.admin_accounts AS a
    WHERE (NOT p_owner_only OR a.role = 'owner')
  LOOP
    IF public.telegram_enqueue(v_user, p_kind, p_body, p_meta, p_dedupe) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_enqueue_admins(TEXT, TEXT, JSONB, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_enqueue_admins(TEXT, TEXT, JSONB, BOOLEAN, TEXT) TO service_role;

-- كل الأعضاء المربوطين (اختياريًا على تيم معين).
CREATE OR REPLACE FUNCTION public.telegram_enqueue_everyone(
  p_kind TEXT,
  p_body TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb,
  p_team_slug TEXT DEFAULT NULL,
  p_except_user UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_user IN
    SELECT l.user_id FROM public.telegram_links AS l
    WHERE l.revoked_at IS NULL AND l.muted = false
      AND (p_except_user IS NULL OR l.user_id <> p_except_user)
      AND (
        p_team_slug IS NULL OR p_team_slug = '' OR EXISTS (
          SELECT 1 FROM public.team_memberships AS tm
          JOIN public.teams AS t ON t.id = tm.team_id
          WHERE tm.member_id = l.member_id AND tm.status = 'active' AND t.slug = p_team_slug
        )
      )
  LOOP
    IF public.telegram_enqueue(v_user, p_kind, p_body, p_meta, NULL) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_enqueue_everyone(TEXT, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_enqueue_everyone(TEXT, TEXT, JSONB, TEXT, UUID) TO service_role;

-- 6) RPCs لواجهة الإدارة -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_admin_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.telegram_settings;
BEGIN
  IF NOT public.telegram_admin_allowed(v_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  SELECT * INTO v_row FROM public.telegram_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'configured', v_row.bot_token IS NOT NULL AND btrim(COALESCE(v_row.bot_token, '')) <> '',
    'enabled', v_row.enabled,
    'bot_username', v_row.bot_username,
    'has_token', v_row.bot_token IS NOT NULL AND btrim(COALESCE(v_row.bot_token, '')) <> '',
    'drain_url', v_row.drain_url,
    'webhook_set_at', v_row.webhook_set_at,
    'last_webhook_at', v_row.last_webhook_at,
    'last_error', v_row.last_error,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by,
    'notify', jsonb_build_object(
      'tasks', v_row.notify_tasks,
      'announcements', v_row.notify_announcements,
      'evaluations', v_row.notify_evaluations,
      'strikes', v_row.notify_strikes,
      'meetings', v_row.notify_meetings,
      'ledger', v_row.notify_ledger,
      'references', v_row.notify_references,
      'projects', v_row.notify_projects,
      'capability', v_row.notify_capability,
      'accounts', v_row.notify_accounts,
      'bonus', v_row.notify_bonus,
      'notes', v_row.notify_notes
    ),
    'links', jsonb_build_object(
      'total', (SELECT count(*) FROM public.telegram_links WHERE revoked_at IS NULL),
      'muted', (SELECT count(*) FROM public.telegram_links WHERE revoked_at IS NULL AND muted),
      'members', (SELECT count(*) FROM public.members)
    ),
    'outbox', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.telegram_outbox WHERE status IN ('pending', 'sending')),
      'failed', (SELECT count(*) FROM public.telegram_outbox WHERE status = 'failed'),
      'sent_24h', (SELECT count(*) FROM public.telegram_outbox WHERE status = 'sent' AND sent_at > now() - INTERVAL '24 hours')
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_admin_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_admin_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_save_settings(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := auth.jwt() ->> 'email';
BEGIN
  IF NOT public.telegram_admin_allowed(v_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: بيانات الإعدادات غير صالحة.';
  END IF;
  UPDATE public.telegram_settings AS s SET
    bot_token = CASE
      WHEN p_payload ? 'bot_token' THEN NULLIF(btrim(p_payload ->> 'bot_token'), '')
      ELSE s.bot_token END,
    bot_username = CASE
      WHEN p_payload ? 'bot_username' THEN NULLIF(btrim(ltrim(p_payload ->> 'bot_username', '@')), '')
      ELSE s.bot_username END,
    drain_url = COALESCE(NULLIF(btrim(p_payload ->> 'drain_url'), ''), s.drain_url),
    enabled = COALESCE((p_payload ->> 'enabled')::boolean, s.enabled),
    notify_tasks = COALESCE((p_payload -> 'notify' ->> 'tasks')::boolean, s.notify_tasks),
    notify_announcements = COALESCE((p_payload -> 'notify' ->> 'announcements')::boolean, s.notify_announcements),
    notify_evaluations = COALESCE((p_payload -> 'notify' ->> 'evaluations')::boolean, s.notify_evaluations),
    notify_strikes = COALESCE((p_payload -> 'notify' ->> 'strikes')::boolean, s.notify_strikes),
    notify_meetings = COALESCE((p_payload -> 'notify' ->> 'meetings')::boolean, s.notify_meetings),
    notify_ledger = COALESCE((p_payload -> 'notify' ->> 'ledger')::boolean, s.notify_ledger),
    notify_references = COALESCE((p_payload -> 'notify' ->> 'references')::boolean, s.notify_references),
    notify_projects = COALESCE((p_payload -> 'notify' ->> 'projects')::boolean, s.notify_projects),
    notify_capability = COALESCE((p_payload -> 'notify' ->> 'capability')::boolean, s.notify_capability),
    notify_accounts = COALESCE((p_payload -> 'notify' ->> 'accounts')::boolean, s.notify_accounts),
    notify_bonus = COALESCE((p_payload -> 'notify' ->> 'bonus')::boolean, s.notify_bonus),
    notify_notes = COALESCE((p_payload -> 'notify' ->> 'notes')::boolean, s.notify_notes),
    updated_at = now(),
    updated_by = v_email
  WHERE s.id = 1;
  RETURN public.telegram_admin_state();
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_save_settings(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_save_settings(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_links_list()
RETURNS TABLE (
  id BIGINT,
  user_id UUID,
  member_id BIGINT,
  full_name TEXT,
  email TEXT,
  chat_id BIGINT,
  username TEXT,
  muted BOOLEAN,
  linked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.telegram_admin_allowed(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  RETURN QUERY
  SELECT l.id, l.user_id, l.member_id, m.full_name, m.email, l.chat_id, l.username,
         l.muted, l.linked_at, l.last_seen_at
  FROM public.telegram_links AS l
  LEFT JOIN public.members AS m ON m.id = l.member_id
  WHERE l.revoked_at IS NULL
  ORDER BY l.linked_at DESC
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_links_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_links_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_unlink(p_link_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.telegram_admin_allowed(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  UPDATE public.telegram_links AS l
  SET revoked_at = now()
  WHERE l.id = p_link_id AND l.revoked_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_unlink(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_unlink(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_set_muted(p_link_id BIGINT, p_muted BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.telegram_admin_allowed(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  UPDATE public.telegram_links AS l
  SET muted = COALESCE(p_muted, NOT l.muted)
  WHERE l.id = p_link_id AND l.revoked_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_set_muted(BIGINT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_set_muted(BIGINT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_outbox_list(p_limit INTEGER DEFAULT 60)
RETURNS TABLE (
  id BIGINT,
  chat_id BIGINT,
  kind TEXT,
  body TEXT,
  status TEXT,
  attempts INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.telegram_admin_allowed(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.chat_id, o.kind, o.body, o.status, o.attempts, o.last_error, o.created_at, o.sent_at
  FROM public.telegram_outbox AS o
  ORDER BY o.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_outbox_list(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_outbox_list(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_retry_message(p_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.telegram_admin_allowed(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  UPDATE public.telegram_outbox AS o
  SET status = 'pending', last_error = NULL, updated_at = now()
  WHERE o.id = p_id AND o.status IN ('failed', 'skipped');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_retry_message(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_retry_message(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_send_test()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id BIGINT;
BEGIN
  IF NOT public.telegram_admin_allowed(v_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  v_id := public.telegram_enqueue(
    v_uid,
    'test',
    E'رسالة تجريبية من لوحة PHANTOMS\nالبوت شغال ووصلت الرسالة بنجاح.',
    '{}'::jsonb,
    NULL
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'NOT_LINKED: اربط حسابك بالبوت الأول من صفحة الإعدادات.';
  END IF;
  RETURN jsonb_build_object('queued', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_send_test() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_send_test() TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_broadcast(p_text TEXT, p_audience JSONB DEFAULT '{"type":"all"}'::jsonb)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_body TEXT := btrim(COALESCE(p_text, ''));
  v_type TEXT := COALESCE(p_audience ->> 'type', 'all');
  v_team TEXT := p_audience ->> 'team';
  v_member BIGINT;
  v_count INTEGER := 0;
BEGIN
  IF NOT public.telegram_admin_allowed(v_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  IF v_body = '' OR length(v_body) > 3500 THEN
    RAISE EXCEPTION 'INVALID_TEXT: نص الرسالة مطلوب وأقل من 3500 حرف.';
  END IF;
  IF NOT public.telegram_settings_enabled() THEN
    RAISE EXCEPTION 'DISABLED: البوت متوقف.';
  END IF;
  IF v_type = 'members' THEN
    FOR v_member IN
      SELECT (value)::bigint FROM jsonb_array_elements_text(COALESCE(p_audience -> 'member_ids', '[]'::jsonb))
    LOOP
      IF public.telegram_enqueue_member(v_member, 'broadcast', v_body, '{}'::jsonb, NULL) IS NOT NULL THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;
    RETURN v_count;
  END IF;
  RETURN public.telegram_enqueue_everyone(
    'broadcast',
    v_body,
    '{}'::jsonb,
    CASE WHEN v_type = 'team' THEN v_team ELSE NULL END,
    v_uid
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_broadcast(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_broadcast(TEXT, JSONB) TO authenticated;

-- 7) ربط العضو من البوابة ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_member_link_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.telegram_settings;
  v_link public.telegram_links;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: جلسة غير صالحة.';
  END IF;
  SELECT * INTO v_row FROM public.telegram_settings WHERE id = 1;
  SELECT * INTO v_link FROM public.telegram_links
  WHERE user_id = v_uid AND revoked_at IS NULL LIMIT 1;
  RETURN jsonb_build_object(
    'enabled', v_row.enabled AND v_row.bot_token IS NOT NULL,
    'bot_username', v_row.bot_username,
    'linked', v_link.id IS NOT NULL,
    'username', v_link.username,
    'muted', COALESCE(v_link.muted, false),
    'linked_at', v_link.linked_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_link_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_member_link_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_member_link_code()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
  v_expires TIMESTAMPTZ := now() + INTERVAL '20 minutes';
  v_row public.telegram_settings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: جلسة غير صالحة.';
  END IF;
  SELECT * INTO v_row FROM public.telegram_settings WHERE id = 1;
  IF NOT v_row.enabled OR v_row.bot_token IS NULL THEN
    RAISE EXCEPTION 'DISABLED: بوت التلجرام مش مفعّل.';
  END IF;
  v_code := upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.telegram_link_codes (code, user_id, expires_at)
  VALUES (v_code, v_uid, v_expires);
  RETURN jsonb_build_object(
    'code', v_code,
    'expires_at', v_expires,
    'bot_username', v_row.bot_username,
    'deep_link', CASE WHEN v_row.bot_username IS NOT NULL
      THEN 'https://t.me/' || v_row.bot_username || '?start=' || v_code ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_member_link_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_member_link_code() TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_unlink_self()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: جلسة غير صالحة.';
  END IF;
  UPDATE public.telegram_links AS l
  SET revoked_at = now()
  WHERE l.user_id = auth.uid() AND l.revoked_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_unlink_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_unlink_self() TO authenticated;

CREATE OR REPLACE FUNCTION public.telegram_toggle_mute_self()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_muted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: جلسة غير صالحة.';
  END IF;
  UPDATE public.telegram_links AS l
  SET muted = NOT l.muted
  WHERE l.user_id = auth.uid() AND l.revoked_at IS NULL
  RETURNING l.muted INTO v_muted;
  RETURN COALESCE(v_muted, false);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_toggle_mute_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_toggle_mute_self() TO authenticated;

COMMIT;
