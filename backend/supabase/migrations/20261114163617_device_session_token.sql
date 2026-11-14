-- ========================================================
-- 0007_device_session_token.sql
-- جلسة جهاز واحد لكل عضو: رمز الجهاز يُخزَّن على الصف،
-- ومحاولة الدخول من جهاز ثانٍ ترفض ما دام الرمز مختلفاً.
-- الخروج يمسح الرمز حتى يُسمح بجهاز جديد.
-- ========================================================

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS session_token TEXT;

DROP FUNCTION IF EXISTS public.lookup_member_by_email(text);

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
  can_go_alexandria BOOLEAN,
  session_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id BIGINT;
  v_current_token TEXT;
BEGIN
  SELECT m.id, m.session_token INTO v_member_id, v_current_token
  FROM public.members m
  WHERE m.email = lower(btrim(p_email));

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  IF p_device_token IS NOT NULL THEN
    IF v_current_token IS NOT NULL AND v_current_token <> p_device_token THEN
      RAISE EXCEPTION 'DEVICE_CONFLICT: This account is currently in use on another device. Please log out from the first device.';
    END IF;
    UPDATE public.members SET session_token = p_device_token WHERE id = v_member_id;
  END IF;

  RETURN QUERY
  SELECT m.id, m.created_at, m.email, m.full_name,
         m.completion_rank, m.bio, m.device, m.meeting_attendance,
         m.work_status, m.can_go_alexandria, m.session_token
  FROM public.members m
  WHERE m.id = v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_email(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(text, text) TO anon, authenticated;

REVOKE ALL ON public.members FROM anon;
GRANT SELECT (id, created_at, email, full_name, bio, device, meeting_attendance, work_status, completion_rank, can_go_alexandria, session_token)
  ON public.members TO anon;

CREATE OR REPLACE FUNCTION public.logout_member_device(p_member_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.members SET session_token = NULL WHERE id = p_member_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.logout_member_device(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_member_device(BIGINT) TO anon, authenticated;
