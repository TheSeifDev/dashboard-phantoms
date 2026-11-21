-- Additive member profile contract and self-service settings RPCs.
-- Existing members are not backfilled or disabled. New enrollment payloads are
-- validated strictly by the public completion wrapper before profile persistence.
BEGIN;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS academic_number TEXT,
  ADD COLUMN IF NOT EXISTS academic_group TEXT,
  ADD COLUMN IF NOT EXISTS specialization TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_url TEXT,
  ADD COLUMN IF NOT EXISTS university_email TEXT GENERATED ALWAYS AS (
    CASE WHEN academic_number IS NULL THEN NULL ELSE academic_number || '@batechu.com' END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS members_academic_number_unique
  ON public.members (academic_number)
  WHERE academic_number IS NOT NULL;

GRANT SELECT (
  academic_number, academic_group, specialization, university_email, linkedin_url, portfolio_url
) ON public.members TO authenticated;

-- A historical table-level UPDATE would otherwise automatically cover new
-- columns. Preserve exactly the old writable columns, while profile writes
-- enter only through the validated self-service RPCs (RLS stays unchanged).
DO $$
DECLARE v_columns TEXT;
BEGIN
  SELECT pg_catalog.string_agg(pg_catalog.format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_columns FROM information_schema.columns AS c
  WHERE c.table_schema = 'public' AND c.table_name = 'members'
    AND c.column_name NOT IN ('academic_number', 'academic_group', 'specialization',
                              'university_email', 'linkedin_url', 'portfolio_url')
    AND pg_catalog.has_column_privilege('authenticated', 'public.members', c.column_name, 'UPDATE');
  REVOKE UPDATE ON public.members FROM authenticated;
  REVOKE UPDATE (academic_number, academic_group, specialization, university_email, linkedin_url, portfolio_url)
    ON public.members FROM authenticated;
  IF v_columns IS NOT NULL THEN
    EXECUTE pg_catalog.format('GRANT UPDATE (%s) ON public.members TO authenticated', v_columns);
  END IF;
END $$;

-- Canonicalizes the exact twelve-key self-service profile. This helper is
-- intentionally private; browser callers use member_password_complete_profile
-- or the two authenticated settings RPCs below.
CREATE OR REPLACE FUNCTION public.member_profile_validate(p_profile JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_keys CONSTANT TEXT[] := ARRAY[
    'fullName', 'phone', 'residence', 'workConditions', 'bio', 'device', 'gender',
    'academicNumber', 'academicGroup', 'specialization', 'linkedinUrl', 'portfolioUrl'
  ];
  v_full_name TEXT;
  v_phone TEXT;
  v_residence TEXT;
  v_work_conditions TEXT;
  v_bio TEXT;
  v_device TEXT;
  v_gender TEXT;
  v_academic_number TEXT;
  v_academic_group TEXT;
  v_specialization TEXT;
  v_linkedin_url TEXT;
  v_portfolio_url TEXT;
  v_host TEXT;
  v_digits TEXT;
BEGIN
  IF p_profile IS NULL OR pg_catalog.jsonb_typeof(p_profile) <> 'object'
     OR NOT (p_profile ?& v_keys) OR (p_profile - v_keys) <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(p_profile -> 'fullName') <> 'string'
     OR pg_catalog.jsonb_typeof(p_profile -> 'phone') <> 'string'
     OR pg_catalog.jsonb_typeof(p_profile -> 'academicNumber') <> 'string'
     OR pg_catalog.jsonb_typeof(p_profile -> 'academicGroup') <> 'string'
     OR pg_catalog.jsonb_typeof(p_profile -> 'specialization') <> 'string'
     OR pg_catalog.jsonb_typeof(p_profile -> 'residence') NOT IN ('string', 'null')
     OR pg_catalog.jsonb_typeof(p_profile -> 'workConditions') NOT IN ('string', 'null')
     OR pg_catalog.jsonb_typeof(p_profile -> 'bio') NOT IN ('string', 'null')
     OR pg_catalog.jsonb_typeof(p_profile -> 'device') NOT IN ('string', 'null')
     OR pg_catalog.jsonb_typeof(p_profile -> 'gender') NOT IN ('string', 'null')
     OR pg_catalog.jsonb_typeof(p_profile -> 'linkedinUrl') NOT IN ('string', 'null')
     OR pg_catalog.jsonb_typeof(p_profile -> 'portfolioUrl') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  v_full_name := pg_catalog.btrim(p_profile ->> 'fullName');
  v_phone := pg_catalog.btrim(p_profile ->> 'phone');
  v_residence := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'residence', '')), '');
  v_work_conditions := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'workConditions', '')), '');
  v_bio := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'bio', '')), '');
  v_device := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'device', '')), '');
  v_gender := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'gender', '')), '');
  v_academic_number := pg_catalog.translate(pg_catalog.btrim(p_profile ->> 'academicNumber'),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  v_academic_group := pg_catalog.btrim(p_profile ->> 'academicGroup');
  v_specialization := pg_catalog.btrim(p_profile ->> 'specialization');
  v_linkedin_url := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'linkedinUrl', '')), '');
  v_portfolio_url := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'portfolioUrl', '')), '');

  v_digits := pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g');
  IF v_full_name = '' OR pg_catalog.char_length(v_full_name) > 160 OR v_full_name ~ '[[:cntrl:]]'
     OR pg_catalog.char_length(v_phone) > 32 OR v_phone !~ '^\+?[0-9 ()-]+$'
     OR pg_catalog.char_length(v_digits) < 7 OR pg_catalog.char_length(v_digits) > 15
     OR v_academic_number !~ '^[0-9]{1,32}$'
     OR v_academic_group = '' OR pg_catalog.char_length(v_academic_group) > 80 OR v_academic_group ~ '[[:cntrl:]]'
     OR v_specialization NOT IN ('software', 'hardware', 'ai')
     OR (v_residence IS NOT NULL AND (pg_catalog.char_length(v_residence) > 160 OR v_residence ~ '[[:cntrl:]]'))
     OR (v_work_conditions IS NOT NULL AND (pg_catalog.char_length(v_work_conditions) > 2000 OR v_work_conditions ~ '[[:cntrl:]]'))
     OR (v_bio IS NOT NULL AND (pg_catalog.char_length(v_bio) > 4000 OR v_bio ~ '[[:cntrl:]]'))
     OR (v_device IS NOT NULL AND v_device NOT IN ('لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول'))
     OR (v_gender IS NOT NULL AND v_gender NOT IN ('ذكر', 'أنثى')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF v_linkedin_url IS NOT NULL THEN
    IF pg_catalog.char_length(v_linkedin_url) > 2048 OR v_linkedin_url ~ '[[:cntrl:]#]'
       OR v_linkedin_url ~ '[^\x00-\x7F]' OR v_linkedin_url !~ '^https://' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_host := pg_catalog.split_part(pg_catalog.split_part(pg_catalog.substring(v_linkedin_url, 9), '/', 1), '?', 1);
    IF pg_catalog.strpos(v_host, '@') > 0 OR pg_catalog.strpos(v_host, ':') > 0
       OR pg_catalog.lower(v_host) NOT IN ('linkedin.com', 'www.linkedin.com') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  IF v_portfolio_url IS NOT NULL THEN
    IF pg_catalog.char_length(v_portfolio_url) > 2048 OR v_portfolio_url ~ '[[:cntrl:]#]'
       OR v_portfolio_url ~ '[^\x00-\x7F]' OR v_portfolio_url !~ '^https://' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_host := pg_catalog.split_part(pg_catalog.split_part(pg_catalog.substring(v_portfolio_url, 9), '/', 1), '?', 1);
    IF pg_catalog.strpos(v_host, '@') > 0 OR pg_catalog.strpos(v_host, ':') > 0
       OR pg_catalog.lower(v_host) LIKE '%.localhost'
       OR v_host !~ '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'fullName', v_full_name, 'phone', v_phone, 'residence', v_residence,
    'workConditions', v_work_conditions, 'bio', v_bio, 'device', v_device, 'gender', v_gender,
    'academicNumber', v_academic_number, 'academicGroup', v_academic_group,
    'specialization', v_specialization, 'linkedinUrl', v_linkedin_url, 'portfolioUrl', v_portfolio_url
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_profile_validate(JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- Private implementation retained from the prior migration. Only the wrapper
-- below can call it, so legacy seven-key input is not a registration API.
CREATE OR REPLACE FUNCTION public.member_password_complete_profile_legacy(
  p_invitation_id UUID,
  p_claim_id UUID,
  p_auth_user_id UUID,
  p_profile JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lock_email TEXT;
  v_inv public.member_password_invitations;
  v_member public.members;
  v_binding public.member_auth_bindings;
  v_user auth.users;
  v_identity_matches INTEGER;
  v_member_id BIGINT;
  v_full_name TEXT;
  v_phone TEXT;
  v_residence TEXT;
  v_work_conditions TEXT;
  v_bio TEXT;
  v_device TEXT;
  v_gender TEXT;
  v_membership TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT i.normalized_email INTO v_lock_email FROM public.member_password_invitations AS i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phantoms-member-registration:' || v_lock_email, 0)
  );
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'reserved' OR v_inv.claim_id IS DISTINCT FROM p_claim_id
     OR v_inv.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.auth_write_completed_at IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.auth_write_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  IF v_inv.purpose = 'reset' AND p_profile IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  ELSIF p_profile IS NULL THEN
    IF v_inv.purpose <> 'reset' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSE
  IF pg_catalog.jsonb_typeof(p_profile) <> 'object'
     OR NOT (p_profile ? 'fullName')
     OR (p_profile - ARRAY['fullName', 'phone', 'residence', 'workConditions', 'bio', 'device', 'gender']::text[]) <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(p_profile -> 'fullName') <> 'string'
     OR ((p_profile ? 'phone') AND pg_catalog.jsonb_typeof(p_profile -> 'phone') NOT IN ('string', 'null'))
     OR ((p_profile ? 'residence') AND pg_catalog.jsonb_typeof(p_profile -> 'residence') NOT IN ('string', 'null'))
     OR ((p_profile ? 'workConditions') AND pg_catalog.jsonb_typeof(p_profile -> 'workConditions') NOT IN ('string', 'null'))
     OR ((p_profile ? 'bio') AND pg_catalog.jsonb_typeof(p_profile -> 'bio') NOT IN ('string', 'null'))
     OR ((p_profile ? 'device') AND pg_catalog.jsonb_typeof(p_profile -> 'device') NOT IN ('string', 'null'))
     OR ((p_profile ? 'gender') AND pg_catalog.jsonb_typeof(p_profile -> 'gender') NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_full_name := pg_catalog.btrim(p_profile ->> 'fullName');
  v_phone := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'phone', '')), '');
  v_residence := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'residence', '')), '');
  v_work_conditions := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'workConditions', '')), '');
  v_bio := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'bio', '')), '');
  v_device := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'device', '')), '');
  v_gender := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'gender', '')), '');
  IF v_full_name = '' OR pg_catalog.char_length(v_full_name) > 160 OR v_full_name ~ '[[:cntrl:]]'
     OR (v_phone IS NOT NULL AND (pg_catalog.char_length(v_phone) > 32 OR v_phone !~ '^\+?[0-9 ()-]{7,32}$'))
     OR (v_residence IS NOT NULL AND (pg_catalog.char_length(v_residence) > 160 OR v_residence ~ '[[:cntrl:]]'))
     OR (v_work_conditions IS NOT NULL AND (pg_catalog.char_length(v_work_conditions) > 2000 OR v_work_conditions ~ '[[:cntrl:]]'))
     OR (v_bio IS NOT NULL AND (pg_catalog.char_length(v_bio) > 4000 OR v_bio ~ '[[:cntrl:]]'))
     OR (v_device IS NOT NULL AND v_device NOT IN ('لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول'))
     OR (v_gender IS NOT NULL AND v_gender NOT IN ('ذكر', 'أنثى')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  END IF;

  SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_inv.normalized_email;
  IF v_identity_matches <> 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT * INTO v_user FROM auth.users AS u WHERE u.id = p_auth_user_id;
  IF NOT FOUND OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_user.email, ''))) <> v_inv.normalized_email
     OR v_user.encrypted_password IS NULL OR pg_catalog.btrim(v_user.encrypted_password) = ''
     OR v_user.email_confirmed_at IS NULL OR v_user.banned_until IS NOT NULL OR v_user.deleted_at IS NOT NULL
     OR COALESCE(v_user.is_sso_user, false)
     OR NOT (COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = p_auth_user_id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  IF v_inv.expected_auth_user_id IS NOT NULL AND v_inv.expected_auth_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  IF v_inv.purpose = 'join' THEN
    IF v_inv.member_id IS NOT NULL OR v_inv.expected_auth_user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email)
       OR EXISTS (SELECT 1 FROM public.member_auth_bindings AS b WHERE b.auth_user_id = p_auth_user_id) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    INSERT INTO public.members (
      email, full_name, completion_rank, residence, work_conditions, bio, phone, device, gender, work_status
    ) VALUES (
      v_inv.normalized_email, v_full_name, 0, v_residence, v_work_conditions, v_bio, v_phone, v_device, v_gender, 'inactive'
    ) RETURNING id INTO v_member_id;
    INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
    VALUES (v_member_id, p_auth_user_id, v_inv.normalized_email, true);
    v_membership := 'pending_review';
  ELSE
    IF v_inv.member_id IS NULL OR v_inv.purpose NOT IN ('enroll', 'reset') THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    SELECT * INTO v_member FROM public.members WHERE id = v_inv.member_id FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_member.work_status, '') <> 'active'
       OR pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_inv.normalized_email
       OR (SELECT count(*) FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email) <> 1 THEN
      RAISE EXCEPTION 'MEMBER_DISABLED';
    END IF;
    v_member_id := v_member.id;
    IF p_profile IS NOT NULL THEN
      UPDATE public.members
      SET full_name = v_full_name, phone = v_phone, residence = v_residence,
          work_conditions = v_work_conditions, bio = v_bio, device = v_device, gender = v_gender
      WHERE id = v_member_id;
    END IF;

    SELECT * INTO v_binding FROM public.member_auth_bindings WHERE member_id = v_member_id FOR UPDATE;
    IF FOUND AND (v_binding.auth_user_id IS DISTINCT FROM p_auth_user_id
        OR v_binding.normalized_email IS DISTINCT FROM v_inv.normalized_email) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.member_auth_bindings WHERE auth_user_id = p_auth_user_id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
      INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
      VALUES (v_member_id, p_auth_user_id, v_inv.normalized_email, true);
    ELSE
      UPDATE public.member_auth_bindings
      SET normalized_email = v_inv.normalized_email, password_ready = true, updated_at = pg_catalog.now()
      WHERE member_id = v_member_id;
    END IF;
    v_membership := 'active';
  END IF;

  UPDATE public.member_password_invitations
  SET member_id = v_member_id, status = 'complete', auth_user_id = p_auth_user_id,
      completed_at = pg_catalog.clock_timestamp(), used_at = pg_catalog.clock_timestamp()
  WHERE id = v_inv.id AND status = 'reserved' AND claim_id = p_claim_id
    AND expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_inv.id, v_member_id, 'completed', p_auth_user_id,
          pg_catalog.jsonb_build_object('purpose', v_inv.purpose, 'membership', v_membership));
  RETURN pg_catalog.jsonb_build_object('ok', true, 'membership', v_membership);
END;
$$;

REVOKE ALL ON FUNCTION public.member_password_complete_profile_legacy(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.member_password_complete_profile(
  p_invitation_id UUID,
  p_claim_id UUID,
  p_auth_user_id UUID,
  p_profile JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile JSONB;
  v_legacy_profile JSONB;
  v_member_id BIGINT;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_profile IS NOT NULL THEN
    v_profile := public.member_profile_validate(p_profile);
    IF v_profile IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_legacy_profile := pg_catalog.jsonb_build_object(
      'fullName', v_profile -> 'fullName', 'phone', v_profile -> 'phone',
      'residence', v_profile -> 'residence', 'workConditions', v_profile -> 'workConditions',
      'bio', v_profile -> 'bio', 'device', v_profile -> 'device', 'gender', v_profile -> 'gender'
    );
  END IF;

  v_result := public.member_password_complete_profile_legacy(
    p_invitation_id, p_claim_id, p_auth_user_id, v_legacy_profile
  );

  IF p_profile IS NOT NULL THEN
    SELECT i.member_id INTO v_member_id
    FROM public.member_password_invitations AS i
    WHERE i.id = p_invitation_id;
    IF v_member_id IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    UPDATE public.members
    SET academic_number = v_profile ->> 'academicNumber',
        academic_group = v_profile ->> 'academicGroup',
        specialization = v_profile ->> 'specialization',
        linkedin_url = v_profile ->> 'linkedinUrl',
        portfolio_url = v_profile ->> 'portfolioUrl'
    WHERE id = v_member_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_complete_profile(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_complete_profile(UUID, UUID, UUID, JSONB) TO service_role;

-- A private response builder keeps both authenticated settings RPCs identical.
CREATE OR REPLACE FUNCTION public.member_profile_settings_payload(p_member_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.members;
  v_missing JSONB := '[]'::jsonb;
  v_email TEXT;
  v_phone_digits TEXT;
BEGIN
  SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  v_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_member.email, '')));
  v_phone_digits := pg_catalog.regexp_replace(COALESCE(v_member.phone, ''), '[^0-9]', '', 'g');
  IF pg_catalog.btrim(COALESCE(v_member.full_name, '')) = '' OR pg_catalog.char_length(pg_catalog.btrim(v_member.full_name)) > 160 OR v_member.full_name ~ '[[:cntrl:]]' THEN v_missing := v_missing || '["fullName"]'::jsonb; END IF;
  IF COALESCE(v_member.phone, '') = '' OR pg_catalog.char_length(v_member.phone) > 32 OR v_member.phone !~ '^\+?[0-9 ()-]+$' OR pg_catalog.char_length(v_phone_digits) < 7 OR pg_catalog.char_length(v_phone_digits) > 15 THEN v_missing := v_missing || '["phone"]'::jsonb; END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR pg_catalog.char_length(v_email) > 254 THEN v_missing := v_missing || '["email"]'::jsonb; END IF;
  IF COALESCE(v_member.academic_number, '') !~ '^[0-9]{1,32}$' THEN v_missing := v_missing || '["academicNumber"]'::jsonb; END IF;
  IF pg_catalog.btrim(COALESCE(v_member.academic_group, '')) = '' OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(v_member.academic_group, ''))) > 80 OR v_member.academic_group ~ '[[:cntrl:]]' THEN v_missing := v_missing || '["academicGroup"]'::jsonb; END IF;
  IF v_member.specialization IS NULL OR v_member.specialization NOT IN ('software', 'hardware', 'ai') THEN v_missing := v_missing || '["specialization"]'::jsonb; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'member_id', v_member.id, 'email', v_member.email, 'full_name', v_member.full_name, 'phone', v_member.phone,
    'academic_number', v_member.academic_number, 'academic_group', v_member.academic_group,
    'specialization', v_member.specialization, 'university_email', v_member.university_email,
    'linkedin_url', v_member.linkedin_url, 'portfolio_url', v_member.portfolio_url,
    'residence', v_member.residence, 'work_conditions', v_member.work_conditions,
    'bio', v_member.bio, 'device', v_member.device, 'gender', v_member.gender,
    'profile_complete', jsonb_array_length(v_missing) = 0, 'missing_fields', v_missing
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_profile_settings_payload(BIGINT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.member_get_profile_settings(p_device_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_access JSONB;
  v_member_id BIGINT;
  v_member public.members;
BEGIN
  v_access := public.get_member_password_access();
  IF v_access IS NULL OR NOT (v_access ? 'member_id') THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  v_member_id := (v_access ->> 'member_id')::BIGINT;
  PERFORM public.assert_member_device(v_member_id, p_device_token);
  SELECT * INTO v_member FROM public.members WHERE id = v_member_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_member.work_status, '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_DISABLED'; END IF;
  IF public.get_member_password_access() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  RETURN public.member_profile_settings_payload(v_member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_get_profile_settings(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_get_profile_settings(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_update_profile_settings(p_device_token TEXT, p_profile JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_access JSONB;
  v_profile JSONB;
  v_member_id BIGINT;
  v_member public.members;
BEGIN
  v_access := public.get_member_password_access();
  IF v_access IS NULL OR NOT (v_access ? 'member_id') THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  v_member_id := (v_access ->> 'member_id')::BIGINT;
  PERFORM public.assert_member_device(v_member_id, p_device_token);
  v_profile := public.member_profile_validate(p_profile);
  IF v_profile IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO v_member FROM public.members WHERE id = v_member_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_member.work_status, '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_DISABLED'; END IF;
  IF public.get_member_password_access() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.members
  SET full_name = v_profile ->> 'fullName', phone = v_profile ->> 'phone',
      residence = v_profile ->> 'residence', work_conditions = v_profile ->> 'workConditions',
      bio = v_profile ->> 'bio', device = v_profile ->> 'device', gender = v_profile ->> 'gender',
      academic_number = v_profile ->> 'academicNumber', academic_group = v_profile ->> 'academicGroup',
      specialization = v_profile ->> 'specialization', linkedin_url = v_profile ->> 'linkedinUrl',
      portfolio_url = v_profile ->> 'portfolioUrl'
  WHERE id = v_member_id;
  RETURN public.member_profile_settings_payload(v_member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_update_profile_settings(TEXT, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_update_profile_settings(TEXT, JSONB) TO authenticated;

COMMIT;
