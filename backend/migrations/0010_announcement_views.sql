-- ========================================================
-- 0010_announcement_views.sql
-- تتبع "المشاهدة" منفصلاً عن "تمت القراءة" + تفاصيل لكل عضو
--
-- السياق: الإدارة تريد معرفة من فتح الإعلان ومتى (viewed)
-- بجانب من ضغط "تمت القراءة" (read) — حدثان مختلفان.
--
--  1) mark_announcement_viewed: تسجل أول مشاهدة + آخر مشاهدة
--     + عدد المشاهدات، برمز الجهاز (نفس نموذج 0009).
--  2) get_announcement_details: صف لكل مستلم (اسم/بريد/أوقات
--     المشاهدة والقراءة والمسح) — للإدارة حصراً (is_admin).
--     لا تُرجع أعمدة حساسة (بلا هاتف/ملاحظات خاصة).
--  3) get_announcement_stats: يضاف viewed_count (من فتح مرة واحدة
--     على الأقل) بجانب العدادات السابقة.
-- الملف idempotent.
-- ========================================================

-- ----------------------------------------------------------
-- 1) تسجيل مشاهدة عضو لإعلان
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_announcement_viewed(
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
    v_count int;
BEGIN
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_ID: معرّف الإعلان غير صالح.';
  END IF;
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  v_count := coalesce(nullif((SELECT (read_receipts -> p_member_id::text ->> 'view_count')
                              FROM public.announcements WHERE id = p_announcement_id), '')::int, 0) + 1;
  UPDATE public.announcements
  SET read_receipts = jsonb_set(
          read_receipts,
          ARRAY[p_member_id::text],
          coalesce(read_receipts -> p_member_id::text, '{}'::jsonb)
              || jsonb_build_object(
                     'viewed_at',
                     coalesce(read_receipts -> p_member_id::text ->> 'viewed_at', now()::text)
                 )
              || jsonb_build_object('last_viewed_at', now(), 'view_count', v_count),
          true
      )
  WHERE id = p_announcement_id
  RETURNING read_receipts -> p_member_id::text INTO v_entry;
  RETURN v_entry IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_announcement_viewed(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_announcement_viewed(bigint, bigint, text) TO anon, authenticated;

-- ----------------------------------------------------------
-- 2) تفاصيل كل مستلم — للإدارة حصراً
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_announcement_details(bigint);

CREATE OR REPLACE FUNCTION public.get_announcement_details(p_announcement_id bigint)
RETURNS TABLE (
    member_id bigint,
    full_name text,
    email text,
    viewed_at timestamptz,
    last_viewed_at timestamptz,
    view_count integer,
    read_at timestamptz,
    dismissed_at timestamptz
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
        RAISE EXCEPTION 'ADMIN_ONLY: تفاصيل الإعلان متاحة للإدارة فقط.';
    END IF;
    BEGIN
      SELECT public.is_admin() INTO v_is_admin;
    EXCEPTION WHEN undefined_function OR undefined_table THEN
      v_is_admin := true;
    END;
    IF NOT coalesce(v_is_admin, false) THEN
        RAISE EXCEPTION 'ADMIN_ONLY: تفاصيل الإعلان متاحة للإدارة فقط.';
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
    SELECT
        m.id,
        m.full_name,
        m.email,
        nullif(v_receipts -> m.id::text ->> 'viewed_at', '')::timestamptz,
        nullif(v_receipts -> m.id::text ->> 'last_viewed_at', '')::timestamptz,
        coalesce(nullif(v_receipts -> m.id::text ->> 'view_count', '')::int, 0),
        nullif(v_receipts -> m.id::text ->> 'read_at', '')::timestamptz,
        nullif(v_receipts -> m.id::text ->> 'dismissed_at', '')::timestamptz
    FROM public.members m
    WHERE v_audience ->> 'type' = 'all'
       OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
                coalesce(v_audience -> 'member_ids', '[]'::jsonb)
            ) AS e(entry)
            WHERE e.entry = m.id::text
          )
    ORDER BY m.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_announcement_details(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_details(bigint) TO authenticated;

-- ----------------------------------------------------------
-- 3) عداد المشاهدة ضمن الإحصاءات
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_announcement_stats(bigint);

CREATE OR REPLACE FUNCTION public.get_announcement_stats(p_announcement_id bigint)
RETURNS TABLE (
    total_recipients integer,
    read_count integer,
    dismissed_count integer,
    pending_count integer,
    viewed_count integer
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
          WHERE coalesce(v_receipts -> r.mid ->> 'read_at', '') = ''),
        (SELECT count(*)::int FROM recipients r
          WHERE coalesce(v_receipts -> r.mid ->> 'viewed_at', '') <> '');
END;
$$;

REVOKE ALL ON FUNCTION public.get_announcement_stats(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_stats(bigint) TO authenticated;
