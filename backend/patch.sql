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
    UPDATE public.members m SET session_token = p_device_token WHERE m.id = v_member_id;
  END IF;

  RETURN QUERY
  SELECT m.id, m.created_at, m.email, m.full_name,
         m.completion_rank, m.bio, m.device, m.meeting_attendance,
         m.work_status, m.can_go_alexandria
  FROM public.members m
  WHERE m.id = v_member_id;
END;
$$;
