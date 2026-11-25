-- Round 36 — تخصيص كل فريق لوحده.
--
-- كل فريق بقى ليه صفحة مستقلة، ومحتاج يقدر يخصص شكلها ومحتواها الأساسي:
-- وصف قصير، لون تمييز من توكنز الهوية، ومحاور شغل (focus areas).
-- البيانات محفوظة في الداتابيز مش في الواجهة، والكتابة للمالك فقط.
BEGIN;

CREATE TABLE IF NOT EXISTS public.team_profiles (
  team_id UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  tagline TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'primary',
  focus_areas TEXT[] NOT NULL DEFAULT '{}'::text[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT team_profiles_tagline_len CHECK (char_length(tagline) <= 160),
  CONSTRAINT team_profiles_accent_check CHECK (accent IN ('primary', 'violet', 'cyan', 'amber')),
  CONSTRAINT team_profiles_focus_count CHECK (cardinality(focus_areas) <= 6)
);

COMMENT ON TABLE public.team_profiles IS 'تخصيص صفحة كل فريق: وصف، لون تمييز، ومحاور شغل. الكتابة للمالك فقط عبر owner_team_profile_set.';

ALTER TABLE public.team_profiles ENABLE ROW LEVEL SECURITY;
-- مفيش policies عن قصد: الوصول كله عبر الدوال المحدودة تحت (SECURITY DEFINER).
REVOKE ALL ON TABLE public.team_profiles FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.team_profile_get(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TEAM';
  END IF;

  SELECT public.is_owner()
      OR EXISTS (
        SELECT 1 FROM public.team_admin_assignments AS a
        WHERE a.team_id = p_team_id AND a.user_id = v_uid
      )
      OR EXISTS (
        SELECT 1
        FROM public.team_memberships AS tm
        JOIN public.member_auth_bindings AS b ON b.member_id = tm.member_id
        WHERE tm.team_id = p_team_id AND b.auth_user_id = v_uid AND tm.status = 'active'
      )
    INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'TEAM_ACCESS_DENIED';
  END IF;

  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'team_id', t.id,
      'slug', t.slug,
      'name', t.name,
      'is_active', t.is_active,
      'tagline', COALESCE(p.tagline, ''),
      'accent', COALESCE(p.accent, 'primary'),
      'focus_areas', COALESCE(p.focus_areas, '{}'::text[]),
      'updated_at', p.updated_at
    )
    FROM public.teams AS t
    LEFT JOIN public.team_profiles AS p ON p.team_id = t.id
    WHERE t.id = p_team_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_team_profile_set(
  p_team_id UUID,
  p_tagline TEXT,
  p_accent TEXT,
  p_focus_areas TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tagline TEXT := btrim(COALESCE(p_tagline, ''));
  v_accent TEXT := COALESCE(NULLIF(btrim(COALESCE(p_accent, '')), ''), 'primary');
  v_focus TEXT[];
BEGIN
  IF v_uid IS NULL OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'OWNER_ONLY';
  END IF;
  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND';
  END IF;
  IF char_length(v_tagline) > 160 THEN
    RAISE EXCEPTION 'TAGLINE_TOO_LONG';
  END IF;
  IF v_accent NOT IN ('primary', 'violet', 'cyan', 'amber') THEN
    RAISE EXCEPTION 'INVALID_ACCENT';
  END IF;

  -- تطبيع محاور الشغل: بدون فراغات، بدون تكرار، بحد أقصى 6 محاور و40 حرف للمحور.
  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item), '{}'::text[])
    INTO v_focus
    FROM (
      SELECT btrim(raw) AS item
      FROM unnest(COALESCE(p_focus_areas, '{}'::text[])) AS raw
      WHERE btrim(COALESCE(raw, '')) <> ''
    ) AS cleaned;

  IF cardinality(v_focus) > 6 THEN
    RAISE EXCEPTION 'TOO_MANY_FOCUS_AREAS';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_focus) AS f WHERE char_length(f) > 40) THEN
    RAISE EXCEPTION 'FOCUS_AREA_TOO_LONG';
  END IF;

  INSERT INTO public.team_profiles AS tp (team_id, tagline, accent, focus_areas, updated_at, updated_by)
  VALUES (p_team_id, v_tagline, v_accent, v_focus, now(), v_uid)
  ON CONFLICT (team_id) DO UPDATE
    SET tagline = EXCLUDED.tagline,
        accent = EXCLUDED.accent,
        focus_areas = EXCLUDED.focus_areas,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  RETURN public.team_profile_get(p_team_id);
END;
$$;

REVOKE ALL ON FUNCTION public.team_profile_get(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_team_profile_set(UUID, TEXT, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_profile_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_team_profile_set(UUID, TEXT, TEXT, TEXT[]) TO authenticated;

COMMIT;
