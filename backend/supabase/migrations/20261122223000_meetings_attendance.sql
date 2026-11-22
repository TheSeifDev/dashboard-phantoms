-- الاجتماعات والحضور: أونلاين/أوفلاين، جمهور مستهدف، QR من الرقم الأكاديمي.
--
-- التصميم:
--   meetings            : الاجتماع نفسه (نوعه، ميعاده، مكانه أو رابطه، جمهوره).
--   meeting_attendance  : سطر واحد لكل عضو حاضر (scan أو manual) — unique key بيمنع التكرار.
--   meeting_audience_members() : بيحوّل الجمهور (الكل/تيمات/أعضاء محددين/heads+monitors)
--                                 لقائمة member_id واحدة يستخدمها كل شيء.
--
-- الجداول مقفولة تمامًا (RLS + revoke) والوصول كله عبر RPCs:
--   • الإدارة/الهيدز: has_admin_permission('members').
--   • العضو: web_current_member_id() وبيشوف اجتماعاته هو بس.
BEGIN;
CREATE TABLE public.meetings (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  description TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('online', 'offline')),
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 480),
  location TEXT,
  online_url TEXT,
  audience JSONB NOT NULL DEFAULT '{"type": "all"}'::JSONB,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meetings_mode_details CHECK (
    (mode = 'online' AND online_url IS NOT NULL AND btrim(online_url) <> '')
    OR (mode = 'offline' AND location IS NOT NULL AND btrim(location) <> '')
  ),
  CONSTRAINT meetings_online_url_shape CHECK (online_url IS NULL OR online_url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT meetings_audience_shape CHECK (
    jsonb_typeof(audience) = 'object'
    AND audience ? 'type'
    AND audience ->> 'type' IN ('all', 'teams', 'members', 'leaders')
  )
);
CREATE INDEX meetings_starts_at_idx ON public.meetings (starts_at DESC);
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meetings FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.meeting_attendance (
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'scan' CHECK (method IN ('scan', 'manual')),
  marked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, member_id)
);
CREATE INDEX meeting_attendance_member_idx ON public.meeting_attendance (member_id, marked_at DESC);
ALTER TABLE public.meeting_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meeting_attendance FROM PUBLIC, anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- الجمهور المستهدف
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meeting_audience_members(p_audience JSONB)
RETURNS TABLE (member_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.id
  FROM public.members AS m
  WHERE m.work_status = 'active'
    AND CASE COALESCE(p_audience ->> 'type', 'all')
      WHEN 'all' THEN TRUE
      WHEN 'teams' THEN EXISTS (
        SELECT 1
        FROM public.team_memberships AS tm
        JOIN public.teams AS t ON t.id = tm.team_id
        WHERE tm.member_id = m.id
          AND tm.status = 'active'
          AND t.slug IN (
            SELECT slug.value
            FROM jsonb_array_elements_text(COALESCE(p_audience -> 'teams', '[]'::JSONB)) AS slug(value)
          )
      )
      WHEN 'members' THEN m.id IN (
        SELECT candidate.value::BIGINT
        FROM jsonb_array_elements_text(COALESCE(p_audience -> 'member_ids', '[]'::JSONB)) AS candidate(value)
        WHERE candidate.value ~ '^[0-9]+$'
      )
      WHEN 'leaders' THEN EXISTS (
        SELECT 1
        FROM public.member_auth_bindings AS b
        JOIN public.team_admin_assignments AS a ON a.user_id = b.auth_user_id
        WHERE b.member_id = m.id
      )
      ELSE FALSE
    END
$$;
REVOKE ALL ON FUNCTION public.meeting_audience_members(JSONB) FROM PUBLIC, anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- الإدارة: قائمة الاجتماعات
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_meetings(p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit INTEGER := GREATEST(1, LEAST(200, COALESCE(p_limit, 50)));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  v_total INTEGER;
  v_rows JSONB;
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: سجل الاجتماعات متاح للإدارة فقط.';
  END IF;
  SELECT count(*)::INTEGER INTO v_total FROM public.meetings;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'starts_at' DESC), '[]'::JSONB)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'id', m.id,
             'title', m.title,
             'description', m.description,
             'mode', m.mode,
             'starts_at', m.starts_at,
             'duration_minutes', m.duration_minutes,
             'location', m.location,
             'online_url', m.online_url,
             'audience', m.audience,
             'status', m.status,
             'created_at', m.created_at,
             'expected', (SELECT count(*) FROM public.meeting_audience_members(m.audience)),
             'present', (SELECT count(*) FROM public.meeting_attendance AS a WHERE a.meeting_id = m.id)
           ) AS entry
    FROM public.meetings AS m
    ORDER BY m.starts_at DESC
    LIMIT v_limit OFFSET v_offset
  ) AS rows;
  RETURN jsonb_build_object('meetings', v_rows, 'total', v_total);
END;
$$;
-- ---------------------------------------------------------------------------
-- الإدارة: إنشاء/تعديل اجتماع
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_meeting(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id BIGINT;
  v_title TEXT := btrim(COALESCE(p_payload ->> 'title', ''));
  v_mode TEXT := COALESCE(p_payload ->> 'mode', '');
  v_starts TIMESTAMPTZ;
  v_duration INTEGER := COALESCE((p_payload ->> 'duration_minutes')::INTEGER, 60);
  v_location TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'location', '')), '');
  v_url TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'online_url', '')), '');
  v_description TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), '');
  v_status TEXT := COALESCE(p_payload ->> 'status', 'scheduled');
  v_audience JSONB := COALESCE(p_payload -> 'audience', '{"type": "all"}'::JSONB);
  v_type TEXT := COALESCE(v_audience ->> 'type', 'all');
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: إدارة الاجتماعات متاحة للإدارة فقط.';
  END IF;
  IF char_length(v_title) < 2 THEN
    RAISE EXCEPTION 'INVALID_TITLE: عنوان الاجتماع مطلوب.';
  END IF;
  IF v_mode NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'INVALID_MODE: نوع الاجتماع لازم أونلاين أو أوفلاين.';
  END IF;
  BEGIN
    v_starts := (p_payload ->> 'starts_at')::TIMESTAMPTZ;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_START: ميعاد الاجتماع غير صالح.';
  END;
  IF v_starts IS NULL THEN
    RAISE EXCEPTION 'INVALID_START: ميعاد الاجتماع مطلوب.';
  END IF;
  IF v_duration < 15 OR v_duration > 480 THEN
    RAISE EXCEPTION 'INVALID_DURATION: مدة الاجتماع لازم بين 15 و480 دقيقة.';
  END IF;
  IF v_mode = 'online' AND v_url IS NULL THEN
    RAISE EXCEPTION 'MISSING_URL: الاجتماع الأونلاين محتاج رابط.';
  END IF;
  IF v_mode = 'offline' AND v_location IS NULL THEN
    RAISE EXCEPTION 'MISSING_LOCATION: الاجتماع الأوفلاين محتاج مكان.';
  END IF;
  IF v_status NOT IN ('scheduled', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS: حالة الاجتماع غير معروفة.';
  END IF;
  IF v_type NOT IN ('all', 'teams', 'members', 'leaders') THEN
    RAISE EXCEPTION 'INVALID_AUDIENCE: نوع الجمهور غير معروف.';
  END IF;
  IF v_type = 'teams' AND jsonb_array_length(COALESCE(v_audience -> 'teams', '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'INVALID_AUDIENCE: اختار تيم واحد على الأقل.';
  END IF;
  IF v_type = 'teams' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_audience -> 'teams') AS slug
    WHERE NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.slug = slug)
  ) THEN
    RAISE EXCEPTION 'INVALID_AUDIENCE: فيه تيم غير موجود.';
  END IF;
  IF v_type = 'members' AND jsonb_array_length(COALESCE(v_audience -> 'member_ids', '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'INVALID_AUDIENCE: اختار عضو واحد على الأقل.';
  END IF;
  v_audience := CASE v_type
    WHEN 'all' THEN '{"type": "all"}'::JSONB
    WHEN 'leaders' THEN '{"type": "leaders"}'::JSONB
    WHEN 'teams' THEN jsonb_build_object('type', 'teams', 'teams', v_audience -> 'teams')
    ELSE jsonb_build_object('type', 'members', 'member_ids', v_audience -> 'member_ids')
  END;
  IF p_payload ? 'id' AND NULLIF(p_payload ->> 'id', '') IS NOT NULL THEN
    UPDATE public.meetings
       SET title = v_title,
           description = v_description,
           mode = v_mode,
           starts_at = v_starts,
           duration_minutes = v_duration,
           location = CASE WHEN v_mode = 'offline' THEN v_location ELSE NULL END,
           online_url = CASE WHEN v_mode = 'online' THEN v_url ELSE NULL END,
           audience = v_audience,
           status = v_status,
           updated_at = now()
     WHERE id = (p_payload ->> 'id')::BIGINT
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'MEETING_NOT_FOUND: الاجتماع غير موجود.';
    END IF;
  ELSE
    INSERT INTO public.meetings (title, description, mode, starts_at, duration_minutes, location, online_url, audience, status, created_by)
    VALUES (v_title, v_description, v_mode, v_starts, v_duration,
            CASE WHEN v_mode = 'offline' THEN v_location ELSE NULL END,
            CASE WHEN v_mode = 'online' THEN v_url ELSE NULL END,
            v_audience, v_status, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_delete_meeting(p_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: إدارة الاجتماعات متاحة للإدارة فقط.';
  END IF;
  DELETE FROM public.meetings WHERE id = p_id;
  RETURN FOUND;
END;
$$;
-- ---------------------------------------------------------------------------
-- الإدارة: كشف الحضور لاجتماع (المتوقع + الحاضر + من بره الجمهور)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_meeting_roster(p_meeting_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_meeting JSONB;
  v_members JSONB;
  v_expected INTEGER;
  v_present INTEGER;
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: سجل الحضور متاح للإدارة فقط.';
  END IF;
  SELECT jsonb_build_object(
           'id', m.id, 'title', m.title, 'mode', m.mode, 'starts_at', m.starts_at,
           'duration_minutes', m.duration_minutes, 'location', m.location,
           'online_url', m.online_url, 'audience', m.audience, 'status', m.status
         )
    INTO v_meeting
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id;
  IF v_meeting IS NULL THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND: الاجتماع غير موجود.';
  END IF;
  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'present')::BOOLEAN DESC, entry ->> 'full_name'), '[]'::JSONB)
    INTO v_members
  FROM (
    SELECT jsonb_build_object(
             'member_id', m.id,
             'full_name', m.full_name,
             'academic_number', m.academic_number,
             'present', a.member_id IS NOT NULL,
             'method', a.method,
             'marked_at', a.marked_at,
             'expected', m.id IN (SELECT member_id FROM public.meeting_audience_members((v_meeting -> 'audience')))
           ) AS entry
    FROM public.members AS m
    LEFT JOIN public.meeting_attendance AS a
      ON a.meeting_id = p_meeting_id AND a.member_id = m.id
    WHERE m.work_status = 'active'
      AND (a.member_id IS NOT NULL OR m.id IN (SELECT member_id FROM public.meeting_audience_members((v_meeting -> 'audience'))))
  ) AS rows;
  SELECT count(*) INTO v_expected FROM public.meeting_audience_members((v_meeting -> 'audience'));
  SELECT count(*) INTO v_present FROM public.meeting_attendance WHERE meeting_id = p_meeting_id;
  RETURN jsonb_build_object(
    'meeting', v_meeting,
    'members', v_members,
    'expected', v_expected,
    'present', v_present
  );
END;
$$;
-- ---------------------------------------------------------------------------
-- الإدارة: تسجيل حضور بكود الـQR (الرقم الأكاديمي)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mark_attendance(p_meeting_id BIGINT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_meeting RECORD;
  v_member RECORD;
  v_inserted INTEGER := 0;
  v_expected BOOLEAN := FALSE;
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: تسجيل الحضور متاح للإدارة فقط.';
  END IF;
  IF v_code = '' THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;
  SELECT id, title, status, audience INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF v_meeting.id IS NULL THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND: الاجتماع غير موجود.';
  END IF;
  IF v_meeting.status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;
  SELECT m.id, m.full_name, m.academic_number INTO v_member
  FROM public.members AS m
  WHERE m.work_status = 'active'
    AND upper(regexp_replace(COALESCE(m.academic_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_code
  LIMIT 1;
  IF v_member.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'code', v_code);
  END IF;
  INSERT INTO public.meeting_attendance (meeting_id, member_id, method, marked_by)
  VALUES (p_meeting_id, v_member.id, 'scan', auth.uid())
  ON CONFLICT (meeting_id, member_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_expected := v_member.id IN (SELECT member_id FROM public.meeting_audience_members(v_meeting.audience));
  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted > 0 THEN 'marked' ELSE 'duplicate' END,
    'expected', v_expected,
    'member', jsonb_build_object(
      'member_id', v_member.id,
      'full_name', v_member.full_name,
      'academic_number', v_member.academic_number
    )
  );
END;
$$;
-- ---------------------------------------------------------------------------
-- الإدارة: تعديل يدوي (حاضر/غائب)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_attendance(p_meeting_id BIGINT, p_member_id BIGINT, p_present BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: تعديل الحضور متاح للإدارة فقط.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meetings WHERE id = p_meeting_id) THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND: الاجتماع غير موجود.';
  END IF;
  IF p_present THEN
    INSERT INTO public.meeting_attendance (meeting_id, member_id, method, marked_by)
    VALUES (p_meeting_id, p_member_id, 'manual', auth.uid())
    ON CONFLICT (meeting_id, member_id) DO NOTHING;
  ELSE
    DELETE FROM public.meeting_attendance
    WHERE meeting_id = p_meeting_id AND member_id = p_member_id;
  END IF;
  RETURN TRUE;
END;
$$;
-- ---------------------------------------------------------------------------
-- العضو: اجتماعاته + رقمه الأكاديمي (للـQR) + سجل حضوره
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_meetings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_member RECORD;
  v_upcoming JSONB;
  v_history JSONB;
  v_stats JSONB;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: سجل الاجتماعات متاح لأعضاء الفريق فقط.';
  END IF;
  SELECT m.id, m.full_name, m.academic_number INTO v_member FROM public.members AS m WHERE m.id = v_member_id;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'starts_at'), '[]'::JSONB)
    INTO v_upcoming
  FROM (
    SELECT jsonb_build_object(
             'id', mt.id, 'title', mt.title, 'description', mt.description,
             'mode', mt.mode, 'starts_at', mt.starts_at, 'duration_minutes', mt.duration_minutes,
             'location', mt.location, 'online_url', mt.online_url, 'status', mt.status,
             'present', a.member_id IS NOT NULL
           ) AS entry
    FROM public.meetings AS mt
    LEFT JOIN public.meeting_attendance AS a ON a.meeting_id = mt.id AND a.member_id = v_member_id
    WHERE mt.status = 'scheduled'
      AND mt.starts_at + make_interval(mins => mt.duration_minutes) >= now()
      AND v_member_id IN (SELECT member_id FROM public.meeting_audience_members(mt.audience))
    ORDER BY mt.starts_at
    LIMIT 20
  ) AS rows;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'starts_at' DESC), '[]'::JSONB)
    INTO v_history
  FROM (
    SELECT jsonb_build_object(
             'id', mt.id, 'title', mt.title, 'mode', mt.mode, 'starts_at', mt.starts_at,
             'present', a.member_id IS NOT NULL, 'marked_at', a.marked_at
           ) AS entry
    FROM public.meetings AS mt
    LEFT JOIN public.meeting_attendance AS a ON a.meeting_id = mt.id AND a.member_id = v_member_id
    WHERE mt.starts_at < now()
      AND v_member_id IN (SELECT member_id FROM public.meeting_audience_members(mt.audience))
    ORDER BY mt.starts_at DESC
    LIMIT 40
  ) AS rows;
  SELECT jsonb_build_object(
           'total', count(*)::INTEGER,
           'attended', count(*) FILTER (WHERE a.member_id IS NOT NULL)::INTEGER,
           'online', count(*) FILTER (WHERE mt.mode = 'online' AND a.member_id IS NOT NULL)::INTEGER,
           'offline', count(*) FILTER (WHERE mt.mode = 'offline' AND a.member_id IS NOT NULL)::INTEGER
         )
    INTO v_stats
  FROM public.meetings AS mt
  LEFT JOIN public.meeting_attendance AS a ON a.meeting_id = mt.id AND a.member_id = v_member_id
  WHERE mt.starts_at < now()
    AND v_member_id IN (SELECT member_id FROM public.meeting_audience_members(mt.audience));
  RETURN jsonb_build_object(
    'member', jsonb_build_object(
      'member_id', v_member.id,
      'full_name', v_member.full_name,
      'academic_number', v_member.academic_number
    ),
    'upcoming', v_upcoming,
    'history', v_history,
    'stats', v_stats
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_meetings(INTEGER, INTEGER) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_save_meeting(JSONB) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_meeting(BIGINT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_meeting_roster(BIGINT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_mark_attendance(BIGINT, TEXT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_set_attendance(BIGINT, BIGINT, BOOLEAN) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.member_meetings() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_meetings(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_meeting(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_meeting(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_meeting_roster(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_attendance(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_attendance(BIGINT, BIGINT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_meetings() TO authenticated;
COMMIT;
