-- Round 31 — ربط الكود (GitHub) من البوابة:
-- العضو بيلزق لينك البروفايل أو الـ username، والـ RPC بيتطبّع الـ handle
-- ويتأكد إنه مش مربوط بعضو تاني ويكتبه في custom_fields.github — وده نفس
-- المكان اللي الداشبورد والـ contribution heatmap بيقروا منه أصلًا.
BEGIN;

CREATE OR REPLACE FUNCTION public.member_github_link(p_handle TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_raw TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_handle, '')));
  v_handle TEXT;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: ربط الكود متاح لأعضاء الفريق بس.';
  END IF;

  -- فك الربط
  IF v_raw = '' THEN
    UPDATE public.members
       SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) - 'github'
     WHERE id = v_member_id;
    RETURN jsonb_build_object('handle', NULL, 'linked', false);
  END IF;

  -- بنقبل لينك كامل أو @username أو username
  v_handle := pg_catalog.regexp_replace(v_raw, '^https?://(www\.)?github\.com/', '');
  v_handle := pg_catalog.regexp_replace(v_handle, '[/?#].*$', '');
  v_handle := pg_catalog.btrim(v_handle, '@ ');
  IF v_handle !~ '^[a-z0-9]([a-z0-9]|-(?=[a-z0-9])){0,38}$' THEN
    RAISE EXCEPTION 'INVALID_HANDLE: اسم حساب GitHub غير صحيح.';
  END IF;
  IF v_handle IN ('login', 'signup', 'settings', 'features', 'about', 'pricing', 'topics', 'explore', 'marketplace', 'orgs', 'users', 'sponsors', 'collections', 'apps') THEN
    RAISE EXCEPTION 'INVALID_HANDLE: ده مش حساب GitHub شخصي.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.members AS m
    WHERE m.id <> v_member_id
      AND pg_catalog.lower(COALESCE(m.custom_fields ->> 'github', '')) = v_handle
  ) THEN
    RAISE EXCEPTION 'HANDLE_TAKEN: حساب GitHub ده مربوط بعضو تاني.';
  END IF;

  UPDATE public.members
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('github', v_handle)
   WHERE id = v_member_id;

  RETURN jsonb_build_object('handle', v_handle, 'linked', true);
END;
$$;
REVOKE ALL ON FUNCTION public.member_github_link(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_github_link(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_github_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_handle TEXT;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: ربط الكود متاح لأعضاء الفريق بس.';
  END IF;
  SELECT NULLIF(pg_catalog.btrim(COALESCE(m.custom_fields ->> 'github', '')), '')
    INTO v_handle
  FROM public.members AS m
  WHERE m.id = v_member_id;
  RETURN jsonb_build_object(
    'handle', v_handle,
    'linked', v_handle IS NOT NULL,
    'profile_url', CASE WHEN v_handle IS NULL THEN NULL ELSE 'https://github.com/' || v_handle END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_github_state() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_github_state() TO authenticated;

COMMIT;
