-- ========================================================
-- 0023 — ترحيل هوية قاعدة البيانات بالكامل إلى PHANTOMS
-- (PHANTOMS Complete Database Identity Migration)
--
-- 1) تحديث القيم الافتراضية للجداول (evaluator_name -> 'إدارة PHANTOMS')
-- 2) تحديث السجلات السابقة لتقييمات الأداء
-- 3) تحديث دالة تسجيل تقييمات الأعضاء (admin_add_member_rating)
-- 4) تحديث مفتاح ضبط الجلسة للبونص (phantoms.member_bonus_rpc)
-- 5) تحديث بريد الإدارة الافتراضي
-- ========================================================

BEGIN;

-- 1) تحديث القيمة الافتراضية لعمود المقيم في جدول التقييمات
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'member_evaluations' AND column_name = 'evaluator_name'
  ) THEN
    ALTER TABLE public.member_evaluations ALTER COLUMN evaluator_name SET DEFAULT 'إدارة PHANTOMS';
    UPDATE public.member_evaluations
    SET evaluator_name = 'إدارة PHANTOMS'
    WHERE evaluator_name <> 'إدارة PHANTOMS';
  END IF;
END $$;

-- 2) تحديث دالة إضافة تقييم للعضو لتعتمد 'إدارة PHANTOMS' كافتراضي
CREATE OR REPLACE FUNCTION public.admin_add_member_rating(
  p_member_id BIGINT,
  p_points INT,
  p_reason TEXT,
  p_author TEXT DEFAULT 'إدارة PHANTOMS'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
  v_reason TEXT := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_author TEXT := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_author, '')), ''), 'إدارة PHANTOMS');
  v_text TEXT;
  v_note_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('ranking') THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED: يلزم امتلاك صلاحية ترتيب الفريق لتسجيل تقييم.';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 OR p_points IS NULL OR p_points < -5 OR p_points > 5 THEN
    RAISE EXCEPTION 'INVALID_RATING: بيانات التقييم غير صالحة.';
  END IF;

  SELECT m.full_name INTO v_name
  FROM public.members AS m
  WHERE m.id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود.';
  END IF;

  -- Strip any caller-supplied bonus tag before adding the authoritative one.
  v_reason := pg_catalog.btrim(
    pg_catalog.regexp_replace(v_reason, '\[B:[+-]?[0-9]{1,9}\]', '', 'gi')
  );
  IF pg_catalog.char_length(v_reason) < 1 OR pg_catalog.char_length(v_reason) > 1000
     OR pg_catalog.char_length(v_author) > 100 THEN
    RAISE EXCEPTION 'RATING_REASON_REQUIRED: اكتب سبباً صحيحاً للتقييم.';
  END IF;

  IF p_points > 0 THEN
    v_text := v_reason || ' [B:+' || p_points::TEXT || ']';
  ELSIF p_points < 0 THEN
    v_text := v_reason || ' [B:' || p_points::TEXT || ']';
  ELSE
    v_text := v_reason;
  END IF;

  INSERT INTO public.notes (
    text,
    author,
    author_role,
    date,
    target_member_id,
    target_name
  ) VALUES (
    v_text,
    v_author,
    'Admin',
    pg_catalog.to_char(timezone('Africa/Cairo'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS'),
    p_member_id,
    v_name
  ) RETURNING id INTO v_note_id;

  RETURN v_note_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_member_rating(BIGINT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_member_rating(BIGINT, INT, TEXT, TEXT) TO authenticated;

-- 3) تحديث trigger البونص اللانهائي ليعتمد phantoms.member_bonus_rpc
CREATE OR REPLACE FUNCTION public.guard_member_bonus_infinite_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.bonus_infinite IS DISTINCT FROM NEW.bonus_infinite
     AND pg_catalog.current_setting('phantoms.member_bonus_rpc', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'BONUS_RPC_REQUIRED: غيّر حالة البونص من شاشة تقييم العضو.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_member_bonus_infinite_write() FROM PUBLIC, anon, authenticated;

-- 4) تحديث دالة set_member_bonus_infinite لتعيين مفتاح PHANTOMS
CREATE OR REPLACE FUNCTION public.set_member_bonus_infinite(
  p_member_id BIGINT,
  p_enabled BOOLEAN,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_name TEXT;
  v_email TEXT;
  v_actor_email TEXT := COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', ''))), ''), auth.uid()::TEXT);
  v_reason TEXT := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_write_token TEXT := NULLIF(pg_catalog.current_setting('phantoms.member_bonus_rpc', true), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('ranking') THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED: يلزم صلاحية ترتيب الفريق لتعديل البونص غير المحدود.';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'INVALID_BONUS_REQUEST: بيانات تعديل البونص غير صالحة.';
  END IF;
  IF pg_catalog.char_length(v_reason) < 3 OR pg_catalog.char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'BONUS_REASON_REQUIRED: اكتب سبباً من 3 إلى 500 حرف.';
  END IF;

  SELECT m.bonus_infinite, m.full_name, m.email
    INTO v_enabled, v_name, v_email
  FROM public.members AS m
  WHERE m.id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود.';
  END IF;
  IF v_enabled = p_enabled THEN
    RAISE EXCEPTION 'BONUS_STATE_UNCHANGED: حالة البونص مطابقة للطلب بالفعل.';
  END IF;

  PERFORM pg_catalog.set_config('phantoms.member_bonus_rpc', 'enabled', true);
  UPDATE public.members
  SET bonus_infinite = p_enabled
  WHERE id = p_member_id;
  PERFORM pg_catalog.set_config('phantoms.member_bonus_rpc', COALESCE(v_write_token, ''), true);

  INSERT INTO public.member_infinite_bonus_events (
    member_id, member_name, member_email, enabled, reason, actor_user_id, actor_email
  ) VALUES (
    p_member_id, v_name, v_email, p_enabled, v_reason, auth.uid(), v_actor_email
  );

  RETURN p_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_bonus_infinite(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_bonus_infinite(BIGINT, BOOLEAN, TEXT) TO authenticated;

-- 5) No administrator email is seeded during identity migration.
-- The legacy compatibility table, when present, remains empty.

COMMIT;
