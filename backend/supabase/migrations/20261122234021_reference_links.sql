-- المصادر (Reference): لينكات مهمة (frameworks / libraries / docs) بشكل مركزي.
--
-- التصميم:
--   reference_links : لينك واحد. team_id = NULL يعني مرجع Global لكل الفريق،
--                     أو team_id = تيم معيّن (AI / Software / Hardware وأي تيم جديد).
--   القيد الفريد بيمنع تكرار نفس الرابط داخل نفس النطاق (Global أو تيم).
--
-- الجدول مقفول تمامًا (RLS + revoke) والوصول عبر RPCs:
--   • الإدارة: has_admin_permission('members') — إدارة كل المصادر.
--   • العضو: web_current_member_id() — بيشوف Global + تيماته النشطة بس.
BEGIN;
CREATE TABLE public.reference_links (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 140),
  url TEXT NOT NULL CHECK (url ~* '^https?://[^[:space:]]+$'),
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('framework', 'library', 'docs', 'tool', 'design', 'course', 'repo', 'other')),
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reference_links_scope_url
  ON public.reference_links (COALESCE(team_id::TEXT, 'global'), lower(url));
CREATE INDEX reference_links_team_idx ON public.reference_links (team_id);
CREATE INDEX reference_links_created_idx ON public.reference_links (created_at DESC);
ALTER TABLE public.reference_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reference_links FROM PUBLIC, anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- الإدارة: قائمة كل المصادر (Global + كل التيمات)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_references()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_links JSONB;
  v_teams JSONB;
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: المصادر متاحة للإدارة فقط.';
  END IF;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'title'), '[]'::JSONB)
    INTO v_links
  FROM (
    SELECT jsonb_build_object(
             'id', r.id,
             'title', r.title,
             'url', r.url,
             'description', r.description,
             'category', r.category,
             'team_slug', t.slug,
             'team_name', t.name,
             'created_at', r.created_at,
             'updated_at', r.updated_at
           ) AS entry
    FROM public.reference_links AS r
    LEFT JOIN public.teams AS t ON t.id = r.team_id
  ) AS rows;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) ORDER BY t.name), '[]'::JSONB)
    INTO v_teams
  FROM public.teams AS t
  WHERE t.is_active;
  RETURN jsonb_build_object(
    'links', v_links,
    'teams', v_teams,
    'total', jsonb_array_length(v_links)
  );
END;
$$;
-- ---------------------------------------------------------------------------
-- الإدارة: إنشاء/تعديل مرجع
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_reference(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id BIGINT;
  v_title TEXT := btrim(COALESCE(p_payload ->> 'title', ''));
  v_url TEXT := btrim(COALESCE(p_payload ->> 'url', ''));
  v_description TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), '');
  v_category TEXT := COALESCE(NULLIF(btrim(p_payload ->> 'category'), ''), 'other');
  v_team_slug TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'team_slug', '')), '');
  v_team_id UUID;
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: إدارة المصادر متاحة للإدارة فقط.';
  END IF;
  IF char_length(v_title) < 2 THEN
    RAISE EXCEPTION 'INVALID_TITLE: عنوان المصدر مطلوب.';
  END IF;
  IF v_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'INVALID_URL: الرابط لازم يبدأ بـ http أو https.';
  END IF;
  IF v_category NOT IN ('framework', 'library', 'docs', 'tool', 'design', 'course', 'repo', 'other') THEN
    RAISE EXCEPTION 'INVALID_CATEGORY: نوع المصدر غير معروف.';
  END IF;
  IF v_team_slug IS NOT NULL THEN
    SELECT id INTO v_team_id FROM public.teams WHERE slug = v_team_slug;
    IF v_team_id IS NULL THEN
      RAISE EXCEPTION 'TEAM_NOT_FOUND: التيم غير موجود.';
    END IF;
  END IF;
  BEGIN
    IF p_payload ? 'id' AND NULLIF(p_payload ->> 'id', '') IS NOT NULL THEN
      UPDATE public.reference_links
         SET title = v_title,
             url = v_url,
             description = v_description,
             category = v_category,
             team_id = v_team_id,
             updated_at = now()
       WHERE id = (p_payload ->> 'id')::BIGINT
       RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'REFERENCE_NOT_FOUND: المصدر غير موجود.';
      END IF;
    ELSE
      INSERT INTO public.reference_links (title, url, description, category, team_id, created_by)
      VALUES (v_title, v_url, v_description, v_category, v_team_id, auth.uid())
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DUPLICATE_URL: الرابط ده متسجل بالفعل في نفس النطاق.';
  END;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_delete_reference(p_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_admin_permission('members') THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: إدارة المصادر متاحة للإدارة فقط.';
  END IF;
  DELETE FROM public.reference_links WHERE id = p_id;
  RETURN FOUND;
END;
$$;
-- ---------------------------------------------------------------------------
-- العضو: Global + مصادر تيماته النشطة
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_references()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_links JSONB;
  v_teams JSONB;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: المصادر متاحة لأعضاء الفريق فقط.';
  END IF;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'title'), '[]'::JSONB)
    INTO v_links
  FROM (
    SELECT jsonb_build_object(
             'id', r.id,
             'title', r.title,
             'url', r.url,
             'description', r.description,
             'category', r.category,
             'team_slug', t.slug,
             'team_name', t.name,
             'created_at', r.created_at,
             'updated_at', r.updated_at
           ) AS entry
    FROM public.reference_links AS r
    LEFT JOIN public.teams AS t ON t.id = r.team_id
    WHERE r.team_id IS NULL
       OR r.team_id IN (
         SELECT tm.team_id
         FROM public.team_memberships AS tm
         WHERE tm.member_id = v_member_id
           AND tm.status = 'active'
       )
  ) AS rows;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) ORDER BY t.name), '[]'::JSONB)
    INTO v_teams
  FROM public.teams AS t
  WHERE t.is_active
    AND t.id IN (
      SELECT tm.team_id
      FROM public.team_memberships AS tm
      WHERE tm.member_id = v_member_id
        AND tm.status = 'active'
    );
  RETURN jsonb_build_object(
    'links', v_links,
    'teams', v_teams,
    'total', jsonb_array_length(v_links)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_references() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_save_reference(JSONB) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_reference(BIGINT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.member_references() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_references() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_reference(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_reference(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_references() TO authenticated;
COMMIT;
