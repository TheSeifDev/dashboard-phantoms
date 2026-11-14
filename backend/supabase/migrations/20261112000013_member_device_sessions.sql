-- ==========================================================
-- 0013 — جلسات مستقلة لأجهزة العضو
-- يحتفظ كل جهاز برمز جلسة خاص به؛ تسجيل جهاز جديد لا يلغي الأجهزة الأخرى.
-- الرموز تُخزّن كبصمات SHA-256، وتنتهي الجلسة بعد 90 يوماً من عدم الاستخدام.
-- ==========================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.member_device_sessions (
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (member_id, token_hash)
);

CREATE INDEX IF NOT EXISTS member_device_sessions_last_seen_idx
  ON public.member_device_sessions (last_seen_at);

ALTER TABLE public.member_device_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_device_sessions FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.member_device_sessions IS
  'Private per-device sessions for member portal; tokens are stored as SHA-256 hashes.';

-- Preserve existing active sessions while moving off the single-token member column.
INSERT INTO public.member_device_sessions (member_id, token_hash, created_at, last_seen_at)
SELECT m.id,
       pg_catalog.encode(extensions.digest(pg_catalog.convert_to(m.session_token, 'UTF8'), 'sha256'), 'hex'),
       pg_catalog.now(),
       pg_catalog.now()
FROM public.members AS m
WHERE m.session_token IS NOT NULL
  AND pg_catalog.btrim(m.session_token) <> ''
ON CONFLICT (member_id, token_hash) DO NOTHING;

UPDATE public.members
SET session_token = NULL
WHERE session_token IS NOT NULL;

-- The legacy session_token is never a readable client column, including for
-- authenticated admins. Device access is provided only through the hashed
-- member_device_sessions RPCs below.
REVOKE SELECT (session_token) ON public.members FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_member_device(p_member_id BIGINT, p_device_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token_hash TEXT;
BEGIN
  IF p_member_id IS NULL OR p_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ID: معرّف العضو غير صالح.';
  END IF;
  IF p_device_token IS NULL OR pg_catalog.btrim(p_device_token) = '' OR pg_catalog.char_length(p_device_token) > 128 THEN
    RAISE EXCEPTION 'DEVICE_REQUIRED: يلزم رمز جهاز صالح للتحقق من الجلسة.';
  END IF;

  v_token_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'),
    'hex'
  );

  UPDATE public.member_device_sessions AS s
  SET last_seen_at = pg_catalog.now()
  WHERE s.member_id = p_member_id
    AND s.token_hash = v_token_hash
    AND s.last_seen_at >= pg_catalog.now() - INTERVAL '90 days';

  IF FOUND THEN
    RETURN;
  END IF;

  PERFORM 1 FROM public.members AS m WHERE m.id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
  END IF;

  RAISE EXCEPTION 'DEVICE_REQUIRED: جلسة الجهاز انتهت أو لم تعد صالحة. سجّل الدخول من جديد.';
END;
$$;

-- Internal helper; only the SECURITY DEFINER RPCs below may call it.
REVOKE ALL ON FUNCTION public.assert_member_device(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lookup_member_by_email(
  p_email TEXT,
  p_device_token TEXT DEFAULT NULL
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
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT;
  v_token_hash TEXT;
BEGIN
  IF p_email IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_email)) = 0 OR pg_catalog.char_length(p_email) > 254 THEN
    RETURN;
  END IF;

  SELECT m.id INTO v_member_id
  FROM public.members AS m
  WHERE m.email = pg_catalog.lower(pg_catalog.btrim(p_email));

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  IF p_device_token IS NOT NULL THEN
    IF pg_catalog.btrim(p_device_token) = '' OR pg_catalog.char_length(p_device_token) > 128 THEN
      RAISE EXCEPTION 'DEVICE_REQUIRED: رمز الجهاز غير صالح.';
    END IF;

    v_token_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'),
      'hex'
    );

    DELETE FROM public.member_device_sessions AS s
    WHERE s.member_id = v_member_id
      AND s.last_seen_at < pg_catalog.now() - INTERVAL '90 days';

    INSERT INTO public.member_device_sessions (member_id, token_hash, created_at, last_seen_at)
    VALUES (v_member_id, v_token_hash, pg_catalog.now(), pg_catalog.now())
    ON CONFLICT (member_id, token_hash)
    DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
  END IF;

  RETURN QUERY
  SELECT m.id, m.created_at, m.email, m.full_name,
         m.completion_rank, m.bio, m.device, m.meeting_attendance,
         m.work_status, m.can_go_alexandria
  FROM public.members AS m
  WHERE m.id = v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_email(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.logout_member_device(p_member_id BIGINT, p_device_token TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token_hash TEXT;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  v_token_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'),
    'hex'
  );

  DELETE FROM public.member_device_sessions AS s
  WHERE s.member_id = p_member_id
    AND s.token_hash = v_token_hash;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.logout_member_device(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_member_device(BIGINT, TEXT) TO anon, authenticated;

COMMIT;
