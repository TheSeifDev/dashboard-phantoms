-- Round 34 — ربط تلجرام أوتوماتيك:
-- 1) كود الربط بقى idempotent: العضو بيفتح صفحة الإعدادات فيتولّد/يُعاد استخدام
--    نفس الكود الصالح، والقديم المنتهي بيتشال — فمفيش تراكم ولا خطوة نسخ ولزق.
-- 2) البوت يقدر يربط الحساب من رقم الموبايل اللي العضو بيشاركه بضغطة واحدة
--    (زر «شارك رقمي») بمطابقته مع members.phone.
-- 3) RPC للإدارة: مين ربط ومين لسه، مع بيانات الربط.
BEGIN;

-- 1) كود ربط واحد صالح لكل عضو ------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_member_link_code()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
  v_expires TIMESTAMPTZ;
  v_row public.telegram_settings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: جلسة غير صالحة.';
  END IF;
  SELECT * INTO v_row FROM public.telegram_settings WHERE id = 1;
  IF NOT v_row.enabled OR v_row.bot_token IS NULL THEN
    RAISE EXCEPTION 'DISABLED: بوت التلجرام مش مفعّل.';
  END IF;
  -- التنضيف: أي كود منتهي أو مستخدم مش محتاجينه
  DELETE FROM public.telegram_link_codes
   WHERE user_id = v_uid AND (expires_at <= now() OR used_at IS NOT NULL);
  -- نفس الكود الصالح يتعاد استخدامه بدل ما نولّد واحد جديد كل مرة
  SELECT c.code, c.expires_at INTO v_code, v_expires
    FROM public.telegram_link_codes AS c
   WHERE c.user_id = v_uid AND c.expires_at > now() AND c.used_at IS NULL
   ORDER BY c.expires_at DESC
   LIMIT 1;
  IF v_code IS NULL THEN
    v_code := upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));
    v_expires := now() + INTERVAL '20 minutes';
    INSERT INTO public.telegram_link_codes (code, user_id, expires_at)
    VALUES (v_code, v_uid, v_expires);
  END IF;
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

-- 2) ربط أوتوماتيك من رقم الموبايل --------------------------------------------
-- ملاحظة: members مالهاش عمود user_id — اليوزر بييجي من member_auth_bindings
-- عن طريق telegram_member_user_id(member_id).
-- أرقام مصر بتتكتب بأشكال مختلفة (+20…، 0020…، 0…)، فبنطبّع الاتنين لنفس الشكل.
CREATE OR REPLACE FUNCTION public.telegram_phone_key(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v TEXT := pg_catalog.regexp_replace(COALESCE(p_raw, ''), '[^0-9]', '', 'g');
BEGIN
  v := pg_catalog.regexp_replace(v, '^00', '');
  v := pg_catalog.regexp_replace(v, '^20', '');
  v := pg_catalog.ltrim(v, '0');
  IF length(v) < 9 THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_phone_key(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.telegram_link_self_by_contact(
  p_phone TEXT,
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
  v_key TEXT := public.telegram_phone_key(p_phone);
  v_member RECORD;
  v_count INTEGER := 0;
  v_existing UUID;
BEGIN
  IF p_chat_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_CHAT');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_PHONE');
  END IF;
  -- لو الشات مربوط خلاص، مفيش حاجة نعملها
  SELECT l.user_id INTO v_existing
    FROM public.telegram_links AS l
   WHERE l.chat_id = p_chat_id AND l.revoked_at IS NULL
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'ALREADY_LINKED');
  END IF;
  FOR v_member IN
    SELECT m.id, public.telegram_member_user_id(m.id) AS user_id, m.full_name
      FROM public.members AS m
     WHERE public.telegram_member_user_id(m.id) IS NOT NULL
       AND public.telegram_phone_key(m.phone) = v_key
  LOOP
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_MATCH');
  END IF;
  IF v_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AMBIGUOUS');
  END IF;
  SELECT m.id, public.telegram_member_user_id(m.id) AS user_id, m.full_name INTO v_member
    FROM public.members AS m
   WHERE public.telegram_member_user_id(m.id) IS NOT NULL
     AND public.telegram_phone_key(m.phone) = v_key
   LIMIT 1;
  INSERT INTO public.telegram_links (user_id, member_id, chat_id, username, first_name)
  VALUES (v_member.user_id, v_member.id, p_chat_id, p_username, p_first_name)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'reason', 'LINKED', 'full_name', v_member.full_name, 'member_id', v_member.id);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_link_self_by_contact(TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_link_self_by_contact(TEXT, BIGINT, TEXT, TEXT) TO service_role;

-- 3) مين ربط ومين لسه (للإدارة) -----------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_links_overview()
RETURNS TABLE (
  member_id BIGINT,
  full_name TEXT,
  email TEXT,
  linked BOOLEAN,
  username TEXT,
  linked_at TIMESTAMPTZ,
  muted BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (public.telegram_admin_allowed(auth.uid()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: إدارة بوت التلجرام تحتاج صلاحية المراسلة.';
  END IF;
  RETURN QUERY
  SELECT m.id,
         m.full_name,
         m.email,
         (l.id IS NOT NULL) AS linked,
         l.username,
         l.linked_at,
         COALESCE(l.muted, false) AS muted,
         l.last_seen_at
    FROM public.members AS m
    LEFT JOIN public.telegram_links AS l
      ON l.member_id = m.id AND l.revoked_at IS NULL
   ORDER BY m.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_links_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_links_overview() TO authenticated;

COMMIT;
