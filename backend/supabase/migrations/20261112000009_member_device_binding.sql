-- ========================================================
-- 0009_member_device_binding.sql
-- ربط هوية العضو بجهازه لمنع BOLA/IDOR في بوابة الأعضاء
--
-- الجذر:
--   1) عمود session_token كان مقروءاً لهوية anon (GRANT + RPC تُرجعه
--      + PUBLIC_MEMBER_COLUMNS في الواجهة) — أي زائر يسحب رموز كل الأجهزة.
--   2) تحديث tracking كان UPDATE مباشراً من anon بشرط USING(true) —
--      أي عضو يمرر memberId чужойاً يعدّل حالة عضو آخر.
--   3) دوال الإعلانات SECURITY DEFINER كانت تقبل p_member_id حراً —
--      أي anon يقرأ/يمسح إعلانات عضو آخر.
--   4) approve_task_submission كانت تكتفي بمنع anon دون التحقق من
--      is_admin() — أي حساب authenticated غير إداري يعتمد مهاماً.
--
-- الحل: رمز جهاز يُمنح عند الدخول (lookup) ويُطلب في كل RPC
-- عضوية. الإدارة (authenticated + is_admin()) معفاة من شرط الجهاز
-- لأنها لا تملك رمزه — وتُتحقق هويتها عبر JWT وقائمة admin_emails.
-- الملف idempotent — تشغيله مرتين آمن.
-- ========================================================

-- ----------------------------------------------------------
-- 0) إزالة session_token من كل ما يراه anon
-- ----------------------------------------------------------
REVOKE ALL ON public.members FROM PUBLIC, anon;

-- إغلاق UPDATE المباشر من anon على tasks — بوابة الأعضاء ستستخدم
-- دالة submit_task_status حصراً (الإدارة تستعمل هوية authenticated).
REVOKE ALL ON public.tasks FROM PUBLIC, anon;
DROP POLICY IF EXISTS "Anon read tasks" ON public.tasks;

REVOKE ALL ON public.notes FROM PUBLIC, anon;
DROP POLICY IF EXISTS "Anon read notes" ON public.notes;

-- ----------------------------------------------------------
-- 1) مساعد التحقق من جهاز العضو
--    يسمح بالمطالبة الأولى (صفوف قديمة بلا رمز) ثم يلزم التطابق.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_member_device(p_member_id bigint, p_device_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_token text;
BEGIN
    IF p_member_id IS NULL OR p_member_id <= 0 THEN
        RAISE EXCEPTION 'INVALID_MEMBER_ID: معرّف العضو غير صالح.';
    END IF;
    IF p_device_token IS NULL OR btrim(p_device_token) = '' THEN
        RAISE EXCEPTION 'DEVICE_REQUIRED: يلزم رمز الجهاز للتحقق من هوية العضو.';
    END IF;
    IF char_length(p_device_token) > 128 THEN
        RAISE EXCEPTION 'DEVICE_REQUIRED: رمز الجهاز غير صالح.';
    END IF;

    SELECT m.session_token INTO v_current_token
    FROM public.members m
    WHERE m.id = p_member_id;

    IF v_current_token IS NULL THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
    END IF;
    -- الصفوف القديمة التي لم تُمنح رمزاً بعد: امنحها رمز المتصل الأول.
    IF v_current_token = '' OR v_current_token IS NULL THEN
        UPDATE public.members SET session_token = p_device_token WHERE public.members.id = p_member_id;
        RETURN;
    END IF;
    IF v_current_token <> p_device_token THEN
        RAISE EXCEPTION 'DEVICE_CONFLICT: هذا الحساب مسجّل الدخول من متصفح أو جهاز آخر. يرجى تسجيل الخروج من الجهاز الأول ثم المحاولة مجدداً.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_member_device(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_member_device(bigint, text) TO anon, authenticated;

-- ----------------------------------------------------------
-- 2) دخول العضو — تُرجع الأعمدة العامة فقط (بلا session_token)
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.lookup_member_by_email(text, text);

CREATE OR REPLACE FUNCTION public.lookup_member_by_email(
  p_email text,
  p_device_token text DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMPTZ,
  email TEXT,
  full_name TEXT,
  completion_rank INT,
  bio TEXT,
  device TEXT,
  meeting_attendance TEXT,
  work_status TEXT,
  can_go_alexandria BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id BIGINT;
  v_current_token TEXT;
BEGIN
  IF p_email IS NULL OR char_length(btrim(p_email)) = 0 OR char_length(p_email) > 254 THEN
    RETURN;
  END IF;

  SELECT m.id, m.session_token INTO v_member_id, v_current_token
  FROM public.members m
  WHERE m.email = lower(btrim(p_email));

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  IF p_device_token IS NOT NULL THEN
    IF char_length(p_device_token) > 128 THEN
      RAISE EXCEPTION 'DEVICE_REQUIRED: رمز الجهاز غير صالح.';
    END IF;
    IF v_current_token IS NOT NULL AND v_current_token <> '' AND v_current_token <> p_device_token THEN
      RAISE EXCEPTION 'DEVICE_CONFLICT: This account is currently in use on another device. Please log out from the first device.';
    END IF;
    UPDATE public.members SET session_token = p_device_token WHERE public.members.id = v_member_id;
  END IF;

  RETURN QUERY
  SELECT m.id, m.created_at, m.email, m.full_name,
         m.completion_rank, m.bio, m.device, m.meeting_attendance,
         m.work_status, m.can_go_alexandria
  FROM public.members m
  WHERE m.id = v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_email(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(text, text) TO anon, authenticated;

-- ----------------------------------------------------------
-- 3) تحديث حالة مهمة لعضو واحد — المسار الوحيد لبوابة الأعضاء
--    anon: يلزم رمز الجهاز + أن يكون العضو مكلفاً بالمهمة.
--    admin (authenticated + is_admin): معفى من الجهاز، ممنوع من
--    تمرير approved هنا (الاعتماد عبر approve_task_submission حصراً).
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_task_status(bigint, bigint, text, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_task_status(
  p_task_id bigint,
  p_member_id bigint,
  p_device_token text DEFAULT NULL,
  p_status text DEFAULT 'under_review',
  p_note text DEFAULT '',
  p_submission_url text DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := current_setting('role', true);
  v_is_admin boolean := false;
  v_tracking JSONB;
  v_assigned JSONB;
  v_entry JSONB;
  v_old_status text;
  v_note text := coalesce(p_note, '');
  v_url text := coalesce(p_submission_url, '');
BEGIN
  IF p_task_id IS NULL OR p_task_id <= 0 OR p_task_id > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_TASK_ID: معرّف المهمة غير صالح.';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 OR p_member_id > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ID: معرّف العضو غير صالح.';
  END IF;
  IF p_status NOT IN ('pending', 'in_progress', 'under_review', 'revision_requested') THEN
    RAISE EXCEPTION 'INVALID_STATUS: حالة المهمة غير مسموحة من بوابة الأعضاء.';
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'INVALID_NOTE: الملاحظة أطول من الحد المسموح (2000).';
  END IF;
  IF v_url <> '' THEN
    IF char_length(v_url) > 2048 THEN
      RAISE EXCEPTION 'INVALID_URL: رابط التسليم أطول من الحد المسموح.';
    END IF;
    IF v_url !~* '^https?://' THEN
      RAISE EXCEPTION 'INVALID_URL: رابط التسليم يجب أن يبدأ بـ http:// أو https://.';
    END IF;
  END IF;

  IF v_role = 'authenticated' THEN
    BEGIN
      SELECT public.is_admin() AND public.has_admin_permission('tasks') INTO v_is_admin;
    EXCEPTION WHEN undefined_function OR undefined_table THEN
      v_is_admin := true;
    END;
  END IF;

  IF NOT coalesce(v_is_admin, false) THEN
    -- OTP members and admins without the tasks permission must prove device
    -- ownership; only a task-authorized admin gets the bypass.
    PERFORM public.assert_member_device(p_member_id, p_device_token);
  END IF;

  SELECT t.tracking, t.assigned_to INTO v_tracking, v_assigned
  FROM public.tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;

  IF v_tracking IS NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND: المهمة غير موجودة.';
  END IF;
  v_tracking := coalesce(v_tracking, '{}'::jsonb);

  -- العضو المكلف فقط (أو ALL) — الإدارة تتجاوز هذا القيد.
  IF NOT coalesce(v_is_admin, false) THEN
    IF v_assigned = to_jsonb('ALL'::text) THEN
      -- مكلف للجميع: مسموح.
    ELSIF jsonb_typeof(coalesce(v_assigned, '[]'::jsonb)) = 'array'
          AND (v_assigned ? p_member_id::text OR v_assigned @> to_jsonb(p_member_id)) THEN
      -- العضو ضمن المصفوفة: مسموح.
    ELSE
      RAISE EXCEPTION 'NOT_ASSIGNED: العضو غير مكلف بهذه المهمة.';
    END IF;
  END IF;

  v_entry := coalesce(v_tracking -> p_member_id::text, '{}'::jsonb);
  v_old_status := v_entry ->> 'status';

  -- الاعتماد حق إداري ذرّي — لا يمر من هنا أبداً.
  IF p_status = 'approved' OR v_old_status = 'approved' THEN
    RAISE EXCEPTION 'ADMIN_APPROVAL_FORBIDDEN: الاعتماد حق إداري حصرياً.';
  END IF;

  v_entry := v_entry
    || jsonb_build_object('status', p_status, 'note', v_note, 'submission_url', v_url, 'updated_at', now());

  v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::text], v_entry, true);
  UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;

  RETURN jsonb_build_object('task_id', p_task_id, 'member_id', p_member_id, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_task_status(bigint, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_task_status(bigint, bigint, text, text, text, text) TO anon, authenticated;

-- ----------------------------------------------------------
-- 4) جاهزية الميدان — خدمة ذاتية للعضو (عمود واحد فقط)
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_member_readiness(bigint, text, boolean);

CREATE OR REPLACE FUNCTION public.update_member_readiness(
  p_member_id bigint,
  p_device_token text,
  p_can_go boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_can_go IS NULL THEN
    RAISE EXCEPTION 'INVALID_VALUE: قيمة الجاهزية غير صالحة.';
  END IF;
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  UPDATE public.members SET can_go_alexandria = p_can_go WHERE public.members.id = p_member_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.update_member_readiness(bigint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_readiness(bigint, text, boolean) TO anon, authenticated;

-- ----------------------------------------------------------
-- 5) الإعلانات — ربط p_member_id برمز الجهاز
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_member_announcements(bigint);
DROP FUNCTION IF EXISTS public.get_member_announcements(bigint, text);
DROP FUNCTION IF EXISTS public.mark_announcement_read(bigint, bigint);
DROP FUNCTION IF EXISTS public.dismiss_announcement(bigint, bigint);

CREATE OR REPLACE FUNCTION public.get_member_announcements(p_member_id bigint, p_device_token text DEFAULT NULL)
RETURNS TABLE (
    id bigint,
    created_at timestamptz,
    title text,
    content text,
    priority text,
    is_read boolean,
    is_dismissed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  RETURN QUERY
    SELECT
        a.id,
        a.created_at,
        a.title,
        a.content,
        a.priority,
        coalesce(a.read_receipts -> p_member_id::text ->> 'read_at', '') <> '',
        coalesce(a.read_receipts -> p_member_id::text ->> 'dismissed_at', '') <> ''
    FROM public.announcements a
    WHERE a.is_active = true
      AND (a.expires_at IS NULL OR a.expires_at > now())
      AND (
            a.target_audience ->> 'type' = 'all'
         OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    coalesce(a.target_audience -> 'member_ids', '[]'::jsonb)
                ) AS e(entry)
                WHERE e.entry = p_member_id::text
            )
      )
      AND coalesce(a.read_receipts -> p_member_id::text ->> 'dismissed_at', '') = ''
    ORDER BY
        CASE a.priority
            WHEN 'urgent' THEN 4
            WHEN 'high'   THEN 3
            WHEN 'normal' THEN 2
            ELSE 1
        END DESC,
        a.created_at DESC
    LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_announcement_read(
    p_announcement_id bigint,
    p_member_id bigint,
    p_device_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry jsonb;
BEGIN
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_ID: معرّف الإعلان غير صالح.';
  END IF;
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  UPDATE public.announcements
  SET read_receipts = jsonb_set(
          read_receipts,
          ARRAY[p_member_id::text],
          coalesce(read_receipts -> p_member_id::text, '{}'::jsonb)
              || jsonb_build_object('read_at', now()),
          true
      )
  WHERE id = p_announcement_id
  RETURNING read_receipts -> p_member_id::text INTO v_entry;
  RETURN v_entry IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_announcement(
    p_announcement_id bigint,
    p_member_id bigint,
    p_device_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry jsonb;
BEGIN
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_ID: معرّف الإعلان غير صالح.';
  END IF;
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  UPDATE public.announcements
  SET read_receipts = jsonb_set(
          read_receipts,
          ARRAY[p_member_id::text],
          coalesce(read_receipts -> p_member_id::text, '{}'::jsonb)
              || jsonb_build_object(
                     'read_at',
                     coalesce(read_receipts -> p_member_id::text ->> 'read_at', now()::text)
                 )
              || jsonb_build_object('dismissed_at', now()),
          true
      )
  WHERE id = p_announcement_id
  RETURNING read_receipts -> p_member_id::text INTO v_entry;
  RETURN v_entry IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_announcements(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_announcement_read(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_announcement(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_announcements(bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_announcement_read(bigint, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_announcement(bigint, bigint, text) TO anon, authenticated;

-- ----------------------------------------------------------
-- 6) اشتراك Push وتسجيل الخروج — بلا رمز جهاز لا تنفيذ
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_push_subscription(bigint, text, jsonb);
DROP FUNCTION IF EXISTS public.save_push_subscription(bigint, text, jsonb, text);
DROP FUNCTION IF EXISTS public.logout_member_device(bigint);

CREATE OR REPLACE FUNCTION public.save_push_subscription(
    p_member_id BIGINT,
    p_email TEXT,
    p_subscription JSONB,
    p_device_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual_email TEXT;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  SELECT lower(btrim(email)) INTO v_actual_email FROM public.members WHERE public.members.id = p_member_id;
  IF v_actual_email IS NULL OR v_actual_email <> lower(btrim(p_email)) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: بيانات المطابقة غير صحيحة.';
  END IF;
  IF p_subscription IS NULL OR p_subscription = 'null'::jsonb THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION: بيانات الاشتراك غير صالحة.';
  END IF;
  IF octet_length(p_subscription::text) > 4096 THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION: بيانات الاشتراك أكبر من الحد المسموح.';
  END IF;
  IF coalesce(p_subscription ->> 'endpoint', '') NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION: نقطة نهاية الاشتراك غير صالحة.';
  END IF;
  UPDATE public.members SET push_subscription = p_subscription WHERE public.members.id = p_member_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.logout_member_device(p_member_id BIGINT, p_device_token TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  UPDATE public.members SET session_token = NULL WHERE public.members.id = p_member_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(BIGINT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(BIGINT, TEXT, JSONB, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.logout_member_device(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_member_device(BIGINT, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------
-- 7) الاعتماد والإحصاءات — للإدارة حصراً (is_admin)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_task_submission(
    p_task_id BIGINT,
    p_member_id BIGINT,
    p_bonus INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_tracking JSONB;
    v_entry JSONB;
    v_new_rank INT;
    v_is_admin BOOLEAN := false;
BEGIN
    IF current_setting('role', true) = 'anon' THEN
        RAISE EXCEPTION 'ADMIN_APPROVAL_FORBIDDEN: الاعتماد حق إداري حصرياً.';
    END IF;
    BEGIN
      SELECT public.is_admin() INTO v_is_admin;
    EXCEPTION WHEN undefined_function OR undefined_table THEN
      v_is_admin := true;
    END;
    IF NOT coalesce(v_is_admin, false) THEN
        RAISE EXCEPTION 'ADMIN_ONLY: الاعتماد متاح للحسابات الإدارية فقط.';
    END IF;
    IF p_task_id IS NULL OR p_task_id <= 0 OR p_member_id IS NULL OR p_member_id <= 0 THEN
        RAISE EXCEPTION 'INVALID_ID: معرّفات المهمة أو العضو غير صالحة.';
    END IF;
    IF p_bonus IS NULL THEN
        p_bonus := 0;
    END IF;
    IF p_bonus < 0 OR p_bonus > 50 THEN
        RAISE EXCEPTION 'INVALID_BONUS: قيمة المكافأة خارج الحد المسموح (0-50).';
    END IF;

    SELECT tracking INTO v_tracking FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF v_tracking IS NULL AND NOT FOUND THEN
        RAISE EXCEPTION 'TASK_NOT_FOUND: المهمة غير موجودة.';
    END IF;
    v_tracking := coalesce(v_tracking, '{}'::jsonb);

    v_entry := v_tracking -> p_member_id::text;
    IF v_entry IS NULL THEN
        RAISE EXCEPTION 'NOT_ASSIGNED: العضو غير مكلف بهذه المهمة.';
    END IF;

    UPDATE public.members
    SET completion_rank = LEAST(100, COALESCE(completion_rank, 0) + 5 + GREATEST(0, p_bonus))
    WHERE id = p_member_id
    RETURNING completion_rank INTO v_new_rank;

    IF v_new_rank IS NULL THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
    END IF;

    v_entry := coalesce(v_entry, '{}'::jsonb)
        || jsonb_build_object('status', 'approved', 'updated_at', now());
    v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::text], v_entry, true);

    UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;

    RETURN jsonb_build_object(
        'task_id', p_task_id,
        'member_id', p_member_id,
        'status', 'approved',
        'completion_rank', v_new_rank
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_announcement_stats(p_announcement_id bigint)
RETURNS TABLE (
    total_recipients integer,
    read_count integer,
    dismissed_count integer,
    pending_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_audience jsonb;
    v_receipts jsonb;
    v_is_admin boolean := false;
BEGIN
    IF current_setting('role', true) = 'anon' THEN
        RAISE EXCEPTION 'ADMIN_ONLY: إحصاءات الإعلان متاحة للإدارة فقط.';
    END IF;
    BEGIN
      SELECT public.is_admin() INTO v_is_admin;
    EXCEPTION WHEN undefined_function OR undefined_table THEN
      v_is_admin := true;
    END;
    IF NOT coalesce(v_is_admin, false) THEN
        RAISE EXCEPTION 'ADMIN_ONLY: إحصاءات الإعلان متاحة للإدارة فقط.';
    END IF;
    IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN
        RAISE EXCEPTION 'INVALID_ID: معرّف الإعلان غير صالح.';
    END IF;

    SELECT a.target_audience, a.read_receipts
      INTO v_audience, v_receipts
      FROM public.announcements a
     WHERE a.id = p_announcement_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH recipients AS (
        SELECT m.id::text AS mid
        FROM public.members m
        WHERE v_audience ->> 'type' = 'all'
           OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    coalesce(v_audience -> 'member_ids', '[]'::jsonb)
                ) AS e(entry)
                WHERE e.entry = m.id::text
              )
    )
    SELECT
        (SELECT count(*)::int FROM recipients),
        (SELECT count(*)::int FROM recipients r
          WHERE coalesce(v_receipts -> r.mid ->> 'read_at', '') <> ''),
        (SELECT count(*)::int FROM recipients r
          WHERE coalesce(v_receipts -> r.mid ->> 'dismissed_at', '') <> ''),
        (SELECT count(*)::int FROM recipients r
          WHERE coalesce(v_receipts -> r.mid ->> 'read_at', '') = '');
END;
$$;

REVOKE ALL ON FUNCTION public.get_announcement_stats(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_stats(bigint) TO authenticated;
