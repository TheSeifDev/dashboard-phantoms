-- ========================================================
-- 0021_member_evaluations.sql
-- نظام تقييمات الأداء الرسمية للأعضاء (الإدارة + بوابة الأعضاء)
-- ========================================================

BEGIN;

-- إصلاح دالة get_member_announcements لتكون VOLATILE لأن assert_member_device يحدّث last_seen_at
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_member_announcements'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.get_member_announcements(BIGINT, TEXT) VOLATILE';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.member_evaluations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_id BIGINT NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(title)) BETWEEN 1 AND 200),
  grade TEXT NOT NULL DEFAULT 'very_good'
    CHECK (grade IN ('excellent', 'very_good', 'good', 'needs_improvement', 'warning')),
  points INT NOT NULL DEFAULT 0
    CHECK (points BETWEEN -10 AND 20),
  feedback TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(feedback)) BETWEEN 1 AND 3000),
  evaluator_name TEXT NOT NULL DEFAULT 'إدارة وصلة'
    CHECK (pg_catalog.char_length(pg_catalog.btrim(evaluator_name)) BETWEEN 1 AND 120),
  bonus_note_id BIGINT REFERENCES public.notes (id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS member_evaluations_member_idx
  ON public.member_evaluations (member_id, created_at DESC);

ALTER TABLE public.member_evaluations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.member_evaluations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_evaluations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.member_evaluations_id_seq TO authenticated;

DROP POLICY IF EXISTS "Admins manage member evaluations" ON public.member_evaluations;
CREATE POLICY "Admins manage member evaluations"
  ON public.member_evaluations
  FOR ALL
  TO authenticated
  USING (
    public.has_admin_permission('ranking')
    OR public.has_admin_permission('notes')
    OR public.has_admin_permission('members')
  )
  WITH CHECK (
    public.has_admin_permission('ranking')
    OR public.has_admin_permission('notes')
    OR public.has_admin_permission('members')
  );

-- ----------------------------------------------------------
-- دالة بوابة العضو: جلب التقييمات الخاصة بالعضو بعد التحقق من جهازه
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_member_evaluations(
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMPTZ,
  member_id BIGINT,
  title TEXT,
  grade TEXT,
  points INT,
  feedback TEXT,
  evaluator_name TEXT,
  viewed_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  UPDATE public.member_evaluations AS e
  SET viewed_at = COALESCE(e.viewed_at, now())
  WHERE e.member_id = p_member_id
    AND e.viewed_at IS NULL;

  RETURN QUERY
  SELECT
    e.id,
    e.created_at,
    e.member_id,
    e.title,
    e.grade,
    e.points,
    e.feedback,
    e.evaluator_name,
    e.viewed_at,
    e.read_at
  FROM public.member_evaluations AS e
  WHERE e.member_id = p_member_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_evaluations(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_evaluations(BIGINT, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------
-- دالة بوابة العضو: تأكيد قراءة التقييم
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_member_evaluation_read(
  p_evaluation_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  UPDATE public.member_evaluations AS e
  SET
    viewed_at = COALESCE(e.viewed_at, now()),
    read_at = COALESCE(e.read_at, now())
  WHERE e.id = p_evaluation_id
    AND e.member_id = p_member_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_member_evaluation_read(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_member_evaluation_read(BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMIT;
