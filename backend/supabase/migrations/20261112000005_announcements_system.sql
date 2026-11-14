-- ========================================================
-- Migration 0005 — نظام الإعلامات (Announcements)
--
-- ماذا يضيف؟
--   1) جدول announcements: عنوان + نص + جمهور مستهدف (الكل أو أعضاء
--      محددين) + أولوية + رايات الإرسال (Push / واتساب).
--   2) سجل قراءة لكل عضو في read_receipts JSONB:
--      { "<member_id>": { "read_at": ts, "dismissed_at": ts } }
--      - read_at      = قرأه (يبقى ظاهراً)
--      - dismissed_at = مسحه (هذا وحده يخفيه من بوابته)
--   3) دوال SECURITY DEFINER لبوابة الأعضاء (anon ممنوع من الجدول
--      مباشرة — نفس نموذج 0003 مع members).
--   4) دالة إحصاءات للإدارة: من قرأ ومن لم يقرأ (Dashboard).
--
-- نموذج الصلاحيات المطابق للمشروع:
--   authenticated (الإدارة) = وصول كامل
--   anon          (البوابة)  = لا وصول مباشر، فقط عبر الدوال
-- ========================================================

-- ----------------------------------------------------------
-- 1) الجدول
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    -- {"type":"all"} أو {"type":"specific","member_ids":[1,2,3]}
    target_audience JSONB NOT NULL DEFAULT '{"type":"all"}'::jsonb,
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    send_push BOOLEAN NOT NULL DEFAULT true,
    send_whatsapp BOOLEAN NOT NULL DEFAULT false,
    whatsapp_sent_at TIMESTAMPTZ,
    whatsapp_sent_count INTEGER NOT NULL DEFAULT 0,
    whatsapp_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT,
    -- {"<member_id>": {"read_at": "...", "dismissed_at": "..."}}
    read_receipts JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------
-- 2) السياسات والصلاحيات على مستوى الأعمدة
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "Admins full access to announcements" ON public.announcements;
CREATE POLICY "Admins full access to announcements"
ON public.announcements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- anon (البوابة) لا يلمس الجدول إطلاقاً — كل الوصول عبر الدوال أدناه
REVOKE ALL ON public.announcements FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.announcements_id_seq TO authenticated;

-- ----------------------------------------------------------
-- 3) دالة بوابة العضو: الإعلانات الموجّهة إليه ولم يمسحها بعد
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_member_announcements(p_member_id bigint)
RETURNS TABLE (
    id bigint,
    created_at timestamptz,
    title text,
    content text,
    priority text,
    is_read boolean,
    is_dismissed boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
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
$$;

-- ----------------------------------------------------------
-- 4) دالة: تعليم الإعلان كمقروء (يبقى ظاهراً — لا يحذفه)
--    دمج وليس استبدال: لا يمسح dismissed_at إن وُجد.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_announcement_read(
    p_announcement_id bigint,
    p_member_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry jsonb;
BEGIN
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

-- ----------------------------------------------------------
-- 5) دالة: مسح الإعلان من بوابة العضو (هذا وحده يخفيه)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dismiss_announcement(
    p_announcement_id bigint,
    p_member_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry jsonb;
BEGIN
    UPDATE public.announcements
    SET read_receipts = jsonb_set(
            read_receipts,
            ARRAY[p_member_id::text],
            coalesce(read_receipts -> p_member_id::text, '{}'::jsonb)
                -- المسح يعني قراءة أيضاً: نضع read_at إن لم تكن موجودة
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

-- ----------------------------------------------------------
-- 6) دالة الإدارة: إحصاءات «من قرأ ومن لم يقرأ»
-- ----------------------------------------------------------
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
BEGIN
    IF current_setting('role', true) = 'anon' THEN
        RAISE EXCEPTION 'ADMIN_ONLY: إحصاءات الإعلان متاحة للإدارة فقط.';
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

-- ----------------------------------------------------------
-- 7) الفهارس
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_announcements_active
    ON public.announcements (is_active, created_at DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_announcements_audience
    ON public.announcements USING GIN (target_audience);
CREATE INDEX IF NOT EXISTS idx_announcements_receipts
    ON public.announcements USING GIN (read_receipts);

-- ----------------------------------------------------------
-- 8) منح التنفيذ
-- ----------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_member_announcements(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_announcement_read(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_announcement(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_announcement_stats(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_member_announcements(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_announcement_read(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_announcement(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_announcement_stats(bigint) TO authenticated;
