-- Every self-service member profile field is mandatory from now on.
--
-- 1. public.member_profile_validate now rejects empty residence, work/study
--    conditions, bio, device, gender, LinkedIn and portfolio links instead of
--    treating them as optional.
-- 2. public.member_profile_settings_payload reports those fields inside
--    missing_fields so profile_complete stays false (and the reminder loop
--    keeps running) until every value is stored and valid.
--
-- Legacy rows are untouched: they simply remain incomplete until the member
-- saves a complete profile, which keeps the completion guard honest.
BEGIN;

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
     -- Mandatory since 2026-11: an empty value is rejected, not stored as NULL.
     OR v_residence IS NULL OR pg_catalog.char_length(v_residence) > 160 OR v_residence ~ '[[:cntrl:]]'
     OR v_work_conditions IS NULL OR pg_catalog.char_length(v_work_conditions) > 2000 OR v_work_conditions ~ '[[:cntrl:]]'
     OR v_bio IS NULL OR pg_catalog.char_length(v_bio) > 4000 OR v_bio ~ '[[:cntrl:]]'
     OR v_device IS NULL OR v_device NOT IN ('لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول')
     OR v_gender IS NULL OR v_gender NOT IN ('ذكر', 'أنثى')
     OR v_linkedin_url IS NULL OR v_portfolio_url IS NULL THEN
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

-- Same private response builder, now listing the newly required fields.
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
  v_linkedin_host TEXT;
  v_portfolio_host TEXT;
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

  IF pg_catalog.btrim(COALESCE(v_member.residence, '')) = '' OR pg_catalog.char_length(pg_catalog.btrim(v_member.residence)) > 160 OR v_member.residence ~ '[[:cntrl:]]' THEN v_missing := v_missing || '["residence"]'::jsonb; END IF;
  IF pg_catalog.btrim(COALESCE(v_member.work_conditions, '')) = '' OR pg_catalog.char_length(pg_catalog.btrim(v_member.work_conditions)) > 2000 OR v_member.work_conditions ~ '[[:cntrl:]]' THEN v_missing := v_missing || '["workConditions"]'::jsonb; END IF;
  IF pg_catalog.btrim(COALESCE(v_member.bio, '')) = '' OR pg_catalog.char_length(pg_catalog.btrim(v_member.bio)) > 4000 OR v_member.bio ~ '[[:cntrl:]]' THEN v_missing := v_missing || '["bio"]'::jsonb; END IF;
  IF COALESCE(v_member.device, '') NOT IN ('لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول') THEN v_missing := v_missing || '["device"]'::jsonb; END IF;
  IF COALESCE(v_member.gender, '') NOT IN ('ذكر', 'أنثى') THEN v_missing := v_missing || '["gender"]'::jsonb; END IF;

  IF COALESCE(v_member.linkedin_url, '') = '' OR pg_catalog.char_length(v_member.linkedin_url) > 2048
     OR v_member.linkedin_url ~ '[[:cntrl:]#]' OR v_member.linkedin_url ~ '[^\x00-\x7F]'
     OR v_member.linkedin_url !~ '^https://' THEN
    v_missing := v_missing || '["linkedinUrl"]'::jsonb;
  ELSE
    v_linkedin_host := pg_catalog.split_part(pg_catalog.split_part(pg_catalog.substring(v_member.linkedin_url, 9), '/', 1), '?', 1);
    IF pg_catalog.strpos(v_linkedin_host, '@') > 0 OR pg_catalog.strpos(v_linkedin_host, ':') > 0
       OR pg_catalog.lower(v_linkedin_host) NOT IN ('linkedin.com', 'www.linkedin.com') THEN
      v_missing := v_missing || '["linkedinUrl"]'::jsonb;
    END IF;
  END IF;

  IF COALESCE(v_member.portfolio_url, '') = '' OR pg_catalog.char_length(v_member.portfolio_url) > 2048
     OR v_member.portfolio_url ~ '[[:cntrl:]#]' OR v_member.portfolio_url ~ '[^\x00-\x7F]'
     OR v_member.portfolio_url !~ '^https://' THEN
    v_missing := v_missing || '["portfolioUrl"]'::jsonb;
  ELSE
    v_portfolio_host := pg_catalog.split_part(pg_catalog.split_part(pg_catalog.substring(v_member.portfolio_url, 9), '/', 1), '?', 1);
    IF pg_catalog.strpos(v_portfolio_host, '@') > 0 OR pg_catalog.strpos(v_portfolio_host, ':') > 0
       OR pg_catalog.lower(v_portfolio_host) LIKE '%.localhost'
       OR v_portfolio_host !~ '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$' THEN
      v_missing := v_missing || '["portfolioUrl"]'::jsonb;
    END IF;
  END IF;

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

COMMIT;
