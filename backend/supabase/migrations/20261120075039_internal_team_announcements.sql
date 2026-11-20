BEGIN;

-- Team recipients are a publish-time snapshot. Keep view counters normalized for
-- team records; legacy global announcements continue to use read_receipts JSONB.
ALTER TABLE public.announcement_recipients
  ADD COLUMN last_viewed_at TIMESTAMPTZ,
  ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0);

-- Private authorization shared by member-facing announcement RPCs. A device
-- token proves the member identity for anonymous portal sessions; authenticated
-- member sessions must also match the exact Auth binding. A global user may skip
-- device proof only with the explicit global announcements permission.
CREATE FUNCTION public.announcement_member_identity(p_member_id BIGINT, p_device_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF p_member_id IS NULL OR p_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.members AS m
    WHERE m.id = p_member_id AND m.work_status = 'active'
  ) THEN
    RETURN FALSE;
  END IF;

  IF v_user_id IS NOT NULL AND public.has_admin_permission('announcements') THEN
    RETURN TRUE;
  END IF;

  PERFORM public.assert_member_device(p_member_id, p_device_token);
  IF v_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.member_auth_bindings AS b
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE b.member_id = p_member_id
      AND b.auth_user_id = v_user_id
      AND b.password_ready IS TRUE
      AND u.email_confirmed_at IS NOT NULL
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'MEMBER_IDENTITY_REQUIRED';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.announcement_member_identity(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- Team announcement list. Counts reflect only recipients who remain active
-- members of the active team; no canonical member fields are modified.
CREATE FUNCTION public.team_list_announcements(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id AND t.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (
    public.is_owner()
    OR public.has_admin_permission('announcements')
    OR public.has_team_permission(p_team_id, 'announcements')
  ) THEN RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'title', a.title,
    'content', a.content,
    'priority', a.priority,
    'is_active', a.is_active,
    'created_at', a.created_at,
    'target_audience', a.target_audience,
    'recipient_count', counts.recipient_count,
    'read_count', counts.read_count
  ) ORDER BY a.created_at DESC, a.id DESC), '[]'::jsonb)
  INTO v_result
  FROM public.announcements AS a
  CROSS JOIN LATERAL (
    SELECT count(*)::BIGINT AS recipient_count,
           count(*) FILTER (WHERE ar.read_at IS NOT NULL)::BIGINT AS read_count
    FROM public.announcement_recipients AS ar
    JOIN public.team_memberships AS tm
      ON tm.team_id = ar.team_id AND tm.member_id = ar.member_id AND tm.status = 'active'
    JOIN public.members AS m ON m.id = ar.member_id AND m.work_status = 'active'
    WHERE ar.announcement_id = a.id AND ar.team_id = p_team_id
  ) AS counts
  WHERE a.team_id = p_team_id;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_announcements(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_list_announcements(UUID) TO authenticated;

CREATE FUNCTION public.team_create_announcement(
  p_team_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_priority TEXT,
  p_member_ids JSONB DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_announcement_id BIGINT;
  v_target_audience JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id AND t.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (
    public.is_owner()
    OR public.has_admin_permission('announcements')
    OR public.has_team_permission(p_team_id, 'announcements')
  ) THEN RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED'; END IF;

  IF p_title IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_content IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_content)) NOT BETWEEN 1 AND 10000
     OR p_priority IS NULL OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'INVALID_ANNOUNCEMENT';
  END IF;

  IF p_member_ids IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_member_ids) <> 'array' THEN
      RAISE EXCEPTION 'INVALID_ANNOUNCEMENT_AUDIENCE';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_member_ids) AS e(value)
      WHERE pg_catalog.jsonb_typeof(e.value) <> 'number'
         OR pg_catalog.char_length(e.value::TEXT) NOT BETWEEN 1 AND 19
         OR e.value::TEXT !~ '^[1-9][0-9]*$'
    ) THEN
      RAISE EXCEPTION 'INVALID_ANNOUNCEMENT_AUDIENCE';
    END IF;
    IF EXISTS (
      SELECT e.value::BIGINT
      FROM pg_catalog.jsonb_array_elements(p_member_ids) AS e(value)
      GROUP BY e.value::BIGINT
      HAVING pg_catalog.count(*) > 1
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ANNOUNCEMENT_RECIPIENT';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_member_ids) AS e(value)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.team_memberships AS tm
        JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
        WHERE tm.team_id = p_team_id
          AND tm.member_id = e.value::BIGINT
          AND tm.status = 'active'
      )
    ) THEN
      RAISE EXCEPTION 'ANNOUNCEMENT_RECIPIENT_NOT_ACTIVE_TEAM_MEMBER';
    END IF;
    v_target_audience := pg_catalog.jsonb_build_object('type', 'specific', 'member_ids', p_member_ids);
  ELSE
    v_target_audience := '{"type":"all"}'::JSONB;
  END IF;

  INSERT INTO public.announcements (
    title, content, priority, target_audience, team_id, is_active,
    send_push, send_whatsapp, created_by
  ) VALUES (
    pg_catalog.btrim(p_title), pg_catalog.btrim(p_content), p_priority,
    v_target_audience, p_team_id, TRUE, FALSE, FALSE, auth.uid()::TEXT
  ) RETURNING id INTO v_announcement_id;

  INSERT INTO public.announcement_recipients (announcement_id, team_id, member_id)
  SELECT v_announcement_id, p_team_id, tm.member_id
  FROM public.team_memberships AS tm
  JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
  WHERE tm.team_id = p_team_id
    AND tm.status = 'active'
    AND (
      p_member_ids IS NULL
      OR tm.member_id IN (
        SELECT e.value::BIGINT
        FROM pg_catalog.jsonb_array_elements(p_member_ids) AS e(value)
      )
    );

  RETURN v_announcement_id;
END;
$$;
REVOKE ALL ON FUNCTION public.team_create_announcement(UUID, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_create_announcement(UUID, TEXT, TEXT, TEXT, JSONB)
  TO authenticated;

CREATE FUNCTION public.team_set_announcement_active(
  p_team_id UUID,
  p_announcement_id BIGINT,
  p_active BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id AND t.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (
    public.is_owner()
    OR public.has_admin_permission('announcements')
    OR public.has_team_permission(p_team_id, 'announcements')
  ) THEN RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED'; END IF;
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 OR p_active IS NULL THEN
    RAISE EXCEPTION 'INVALID_ANNOUNCEMENT';
  END IF;

  UPDATE public.announcements
  SET is_active = p_active
  WHERE id = p_announcement_id AND team_id = p_team_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.team_set_announcement_active(UUID, BIGINT, BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_set_announcement_active(UUID, BIGINT, BOOLEAN)
  TO authenticated;

CREATE FUNCTION public.team_delete_announcement(p_team_id UUID, p_announcement_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id AND t.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (
    public.is_owner()
    OR public.has_admin_permission('announcements')
    OR public.has_team_permission(p_team_id, 'announcements')
  ) THEN RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED'; END IF;
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_ANNOUNCEMENT';
  END IF;

  DELETE FROM public.announcements
  WHERE id = p_announcement_id AND team_id = p_team_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.team_delete_announcement(UUID, BIGINT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_delete_announcement(UUID, BIGINT)
  TO authenticated;

-- Member portal functions keep their historic row shape and global JSON receipt
-- behavior. Team-scoped announcements are read/written only through the
-- normalized snapshot row while team, canonical member, and membership remain active.
CREATE OR REPLACE FUNCTION public.get_member_announcements(
  p_member_id BIGINT,
  p_device_token TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMPTZ,
  title TEXT,
  content TEXT,
  priority TEXT,
  is_read BOOLEAN,
  is_dismissed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
VOLATILE
AS $$
BEGIN
  IF NOT public.announcement_member_identity(p_member_id, p_device_token) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    a.id,
    a.created_at,
    a.title,
    a.content,
    a.priority,
    CASE WHEN a.team_id IS NULL
      THEN COALESCE(a.read_receipts -> p_member_id::TEXT ->> 'read_at', '') <> ''
      ELSE ar.read_at IS NOT NULL END,
    CASE WHEN a.team_id IS NULL
      THEN COALESCE(a.read_receipts -> p_member_id::TEXT ->> 'dismissed_at', '') <> ''
      ELSE ar.dismissed_at IS NOT NULL END
  FROM public.announcements AS a
  LEFT JOIN public.announcement_recipients AS ar
    ON a.team_id IS NOT NULL
   AND ar.announcement_id = a.id
   AND ar.team_id = a.team_id
   AND ar.member_id = p_member_id
  WHERE a.is_active IS TRUE
    AND (a.expires_at IS NULL OR a.expires_at > now())
    AND (
      (a.team_id IS NULL AND (
        a.target_audience ->> 'type' = 'all'
        OR (a.target_audience ->> 'type' = 'specific' AND EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements_text(
            CASE WHEN pg_catalog.jsonb_typeof(a.target_audience -> 'member_ids') = 'array'
              THEN a.target_audience -> 'member_ids' ELSE '[]'::JSONB END
          ) AS e(entry)
          WHERE e.entry = p_member_id::TEXT
        ))
      ))
      OR (a.team_id IS NOT NULL AND ar.member_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.teams AS t
        JOIN public.team_memberships AS tm ON tm.team_id = t.id AND tm.status = 'active'
        JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
        WHERE t.id = a.team_id AND t.is_active IS TRUE AND tm.member_id = p_member_id
      ))
    )
    AND CASE WHEN a.team_id IS NULL
      THEN COALESCE(a.read_receipts -> p_member_id::TEXT ->> 'dismissed_at', '') = ''
      ELSE ar.dismissed_at IS NULL END
  ORDER BY
    CASE a.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
    a.created_at DESC
  LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_announcement_read(
  p_announcement_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_entry JSONB;
BEGIN
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN RAISE EXCEPTION 'INVALID_ID'; END IF;
  IF NOT public.announcement_member_identity(p_member_id, p_device_token) THEN RETURN FALSE; END IF;
  SELECT a.team_id INTO v_team_id
  FROM public.announcements AS a
  WHERE a.id = p_announcement_id AND a.is_active IS TRUE
    AND (a.expires_at IS NULL OR a.expires_at > now());
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_team_id IS NOT NULL THEN
    UPDATE public.announcement_recipients AS ar
    SET read_at = now()
    FROM public.teams AS t, public.team_memberships AS tm, public.members AS m
    WHERE ar.announcement_id = p_announcement_id
      AND ar.team_id = v_team_id
      AND ar.member_id = p_member_id
      AND t.id = v_team_id AND t.is_active IS TRUE
      AND tm.team_id = t.id AND tm.member_id = ar.member_id AND tm.status = 'active'
      AND m.id = tm.member_id AND m.work_status = 'active';
    RETURN FOUND;
  END IF;

  UPDATE public.announcements AS a
  SET read_receipts = pg_catalog.jsonb_set(
    a.read_receipts,
    ARRAY[p_member_id::TEXT],
    COALESCE(a.read_receipts -> p_member_id::TEXT, '{}'::JSONB)
      || pg_catalog.jsonb_build_object('read_at', now()),
    TRUE
  )
  WHERE a.id = p_announcement_id AND a.team_id IS NULL
    AND a.is_active IS TRUE AND (a.expires_at IS NULL OR a.expires_at > now())
    AND (
      a.target_audience ->> 'type' = 'all'
      OR (a.target_audience ->> 'type' = 'specific' AND EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(a.target_audience -> 'member_ids') = 'array'
            THEN a.target_audience -> 'member_ids' ELSE '[]'::JSONB END
        ) AS e(entry) WHERE e.entry = p_member_id::TEXT
      ))
    )
  RETURNING a.read_receipts -> p_member_id::TEXT INTO v_entry;
  RETURN v_entry IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_announcement(
  p_announcement_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_entry JSONB;
BEGIN
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN RAISE EXCEPTION 'INVALID_ID'; END IF;
  IF NOT public.announcement_member_identity(p_member_id, p_device_token) THEN RETURN FALSE; END IF;
  SELECT a.team_id INTO v_team_id
  FROM public.announcements AS a
  WHERE a.id = p_announcement_id AND a.is_active IS TRUE
    AND (a.expires_at IS NULL OR a.expires_at > now());
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_team_id IS NOT NULL THEN
    UPDATE public.announcement_recipients AS ar
    SET read_at = COALESCE(ar.read_at, now()), dismissed_at = now()
    FROM public.teams AS t, public.team_memberships AS tm, public.members AS m
    WHERE ar.announcement_id = p_announcement_id
      AND ar.team_id = v_team_id
      AND ar.member_id = p_member_id
      AND t.id = v_team_id AND t.is_active IS TRUE
      AND tm.team_id = t.id AND tm.member_id = ar.member_id AND tm.status = 'active'
      AND m.id = tm.member_id AND m.work_status = 'active';
    RETURN FOUND;
  END IF;

  UPDATE public.announcements AS a
  SET read_receipts = pg_catalog.jsonb_set(
    a.read_receipts,
    ARRAY[p_member_id::TEXT],
    COALESCE(a.read_receipts -> p_member_id::TEXT, '{}'::JSONB)
      || pg_catalog.jsonb_build_object(
        'read_at', COALESCE(a.read_receipts -> p_member_id::TEXT ->> 'read_at', now()::TEXT),
        'dismissed_at', now()
      ),
    TRUE
  )
  WHERE a.id = p_announcement_id AND a.team_id IS NULL
    AND a.is_active IS TRUE AND (a.expires_at IS NULL OR a.expires_at > now())
    AND (
      a.target_audience ->> 'type' = 'all'
      OR (a.target_audience ->> 'type' = 'specific' AND EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(a.target_audience -> 'member_ids') = 'array'
            THEN a.target_audience -> 'member_ids' ELSE '[]'::JSONB END
        ) AS e(entry) WHERE e.entry = p_member_id::TEXT
      ))
    )
  RETURNING a.read_receipts -> p_member_id::TEXT INTO v_entry;
  RETURN v_entry IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_announcement_viewed(
  p_announcement_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_entry JSONB;
BEGIN
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN RAISE EXCEPTION 'INVALID_ID'; END IF;
  IF NOT public.announcement_member_identity(p_member_id, p_device_token) THEN RETURN FALSE; END IF;
  SELECT a.team_id INTO v_team_id
  FROM public.announcements AS a
  WHERE a.id = p_announcement_id AND a.is_active IS TRUE
    AND (a.expires_at IS NULL OR a.expires_at > now());
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_team_id IS NOT NULL THEN
    UPDATE public.announcement_recipients AS ar
    SET viewed_at = COALESCE(ar.viewed_at, now()),
        last_viewed_at = now(),
        view_count = ar.view_count + 1
    FROM public.teams AS t, public.team_memberships AS tm, public.members AS m
    WHERE ar.announcement_id = p_announcement_id
      AND ar.team_id = v_team_id
      AND ar.member_id = p_member_id
      AND t.id = v_team_id AND t.is_active IS TRUE
      AND tm.team_id = t.id AND tm.member_id = ar.member_id AND tm.status = 'active'
      AND m.id = tm.member_id AND m.work_status = 'active';
    RETURN FOUND;
  END IF;

  UPDATE public.announcements AS a
  SET read_receipts = pg_catalog.jsonb_set(
    a.read_receipts,
    ARRAY[p_member_id::TEXT],
    COALESCE(a.read_receipts -> p_member_id::TEXT, '{}'::JSONB)
      || pg_catalog.jsonb_build_object(
        'viewed_at', COALESCE(a.read_receipts -> p_member_id::TEXT ->> 'viewed_at', now()::TEXT),
        'last_viewed_at', now(),
        'view_count', COALESCE(NULLIF(a.read_receipts -> p_member_id::TEXT ->> 'view_count', '')::INTEGER, 0) + 1
      ),
    TRUE
  )
  WHERE a.id = p_announcement_id AND a.team_id IS NULL
    AND a.is_active IS TRUE AND (a.expires_at IS NULL OR a.expires_at > now())
    AND (
      a.target_audience ->> 'type' = 'all'
      OR (a.target_audience ->> 'type' = 'specific' AND EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(a.target_audience -> 'member_ids') = 'array'
            THEN a.target_audience -> 'member_ids' ELSE '[]'::JSONB END
        ) AS e(entry) WHERE e.entry = p_member_id::TEXT
      ))
    )
  RETURNING a.read_receipts -> p_member_id::TEXT INTO v_entry;
  RETURN v_entry IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_announcements(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_announcement_read(BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_announcement(BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_announcement_viewed(BIGINT, BIGINT, TEXT) FROM PUBLIC;
-- Preserve the existing anonymous, token-bound member-portal transport.
GRANT EXECUTE ON FUNCTION public.get_member_announcements(BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_announcement_read(BIGINT, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_announcement(BIGINT, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_announcement_viewed(BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- Admin details and stats retain their established return types. Global rows
-- remain global-admin-only; team rows require the announcements feature on that
-- active team and enumerate only snapshot recipients still active there.
CREATE OR REPLACE FUNCTION public.get_announcement_details(p_announcement_id BIGINT)
RETURNS TABLE (
  member_id BIGINT,
  full_name TEXT,
  email TEXT,
  viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_audience JSONB;
  v_receipts JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN RAISE EXCEPTION 'INVALID_ID'; END IF;

  SELECT a.team_id, a.target_audience, a.read_receipts
  INTO v_team_id, v_audience, v_receipts
  FROM public.announcements AS a WHERE a.id = p_announcement_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_team_id IS NULL THEN
    IF NOT public.has_admin_permission('announcements') THEN RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED'; END IF;
    RETURN QUERY
    SELECT m.id, m.full_name, m.email,
      NULLIF(v_receipts -> m.id::TEXT ->> 'viewed_at', '')::TIMESTAMPTZ,
      NULLIF(v_receipts -> m.id::TEXT ->> 'last_viewed_at', '')::TIMESTAMPTZ,
      COALESCE(NULLIF(v_receipts -> m.id::TEXT ->> 'view_count', '')::INTEGER, 0),
      NULLIF(v_receipts -> m.id::TEXT ->> 'read_at', '')::TIMESTAMPTZ,
      NULLIF(v_receipts -> m.id::TEXT ->> 'dismissed_at', '')::TIMESTAMPTZ
    FROM public.members AS m
    WHERE v_audience ->> 'type' = 'all'
       OR (v_audience ->> 'type' = 'specific' AND EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
           CASE WHEN pg_catalog.jsonb_typeof(v_audience -> 'member_ids') = 'array'
             THEN v_audience -> 'member_ids' ELSE '[]'::JSONB END
         ) AS e(entry) WHERE e.entry = m.id::TEXT
       ))
    ORDER BY m.full_name;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id = v_team_id AND t.is_active IS TRUE) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED';
  END IF;
  IF NOT (public.has_admin_permission('announcements') OR public.has_team_permission(v_team_id, 'announcements')) THEN
    RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT m.id, m.full_name, m.email, ar.viewed_at, ar.last_viewed_at,
         ar.view_count, ar.read_at, ar.dismissed_at
  FROM public.announcement_recipients AS ar
  JOIN public.team_memberships AS tm
    ON tm.team_id = ar.team_id AND tm.member_id = ar.member_id AND tm.status = 'active'
  JOIN public.teams AS t ON t.id = ar.team_id AND t.is_active IS TRUE
  JOIN public.members AS m ON m.id = ar.member_id AND m.work_status = 'active'
  WHERE ar.announcement_id = p_announcement_id AND ar.team_id = v_team_id
  ORDER BY m.full_name, m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_announcement_details(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_details(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_announcement_stats(p_announcement_id BIGINT)
RETURNS TABLE (
  total_recipients INTEGER,
  read_count INTEGER,
  dismissed_count INTEGER,
  pending_count INTEGER,
  viewed_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_audience JSONB;
  v_receipts JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_announcement_id IS NULL OR p_announcement_id <= 0 THEN RAISE EXCEPTION 'INVALID_ID'; END IF;

  SELECT a.team_id, a.target_audience, a.read_receipts
  INTO v_team_id, v_audience, v_receipts
  FROM public.announcements AS a WHERE a.id = p_announcement_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_team_id IS NULL THEN
    IF NOT public.has_admin_permission('announcements') THEN RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED'; END IF;
    RETURN QUERY
    WITH recipients AS (
      SELECT m.id::TEXT AS mid
      FROM public.members AS m
      WHERE v_audience ->> 'type' = 'all'
         OR (v_audience ->> 'type' = 'specific' AND EXISTS (
           SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
             CASE WHEN pg_catalog.jsonb_typeof(v_audience -> 'member_ids') = 'array'
               THEN v_audience -> 'member_ids' ELSE '[]'::JSONB END
           ) AS e(entry) WHERE e.entry = m.id::TEXT
         ))
    )
    SELECT
      (SELECT count(*)::INTEGER FROM recipients),
      (SELECT count(*)::INTEGER FROM recipients r WHERE COALESCE(v_receipts -> r.mid ->> 'read_at', '') <> ''),
      (SELECT count(*)::INTEGER FROM recipients r WHERE COALESCE(v_receipts -> r.mid ->> 'dismissed_at', '') <> ''),
      (SELECT count(*)::INTEGER FROM recipients r WHERE COALESCE(v_receipts -> r.mid ->> 'read_at', '') = ''),
      (SELECT count(*)::INTEGER FROM recipients r WHERE COALESCE(v_receipts -> r.mid ->> 'viewed_at', '') <> '');
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id = v_team_id AND t.is_active IS TRUE) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED';
  END IF;
  IF NOT (public.has_admin_permission('announcements') OR public.has_team_permission(v_team_id, 'announcements')) THEN
    RAISE EXCEPTION 'ANNOUNCEMENTS_PERMISSION_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE ar.read_at IS NOT NULL)::INTEGER,
    count(*) FILTER (WHERE ar.dismissed_at IS NOT NULL)::INTEGER,
    count(*) FILTER (WHERE ar.read_at IS NULL)::INTEGER,
    count(*) FILTER (WHERE ar.viewed_at IS NOT NULL)::INTEGER
  FROM public.announcement_recipients AS ar
  JOIN public.team_memberships AS tm
    ON tm.team_id = ar.team_id AND tm.member_id = ar.member_id AND tm.status = 'active'
  JOIN public.members AS m ON m.id = ar.member_id AND m.work_status = 'active'
  WHERE ar.announcement_id = p_announcement_id AND ar.team_id = v_team_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_announcement_stats(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_stats(BIGINT) TO authenticated;

COMMIT;
