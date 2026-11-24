-- Round 33 — «مين ربط الكود ومين لسه» بقى مصدر واحد للحقيقة:
-- الداشبورد والـ contribution heatmap بيقروا الـ handle من custom_fields.github،
-- ولو مش موجود بيرجعوا للينك البورتفوليو. لكن member_github_state كان بيقرأ
-- custom_fields.github بس، فالعضو اللي حاطط GitHub في البورتفوليو كان بيشوف
-- «مش مربوط» في الإعدادات في حين الإدارة شايفاه مربوط. الميجريشن ده بيوحّد
-- القاعدة في الداتابيز ويطبّع الموجود.
BEGIN;

-- 1) تطبيع الـ handle — نفس قواعد الواجهة: لينك كامل، @handle، أو handle.
CREATE OR REPLACE FUNCTION public.member_github_strict(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v TEXT := pg_catalog.btrim(COALESCE(p_raw, ''));
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  v := pg_catalog.regexp_replace(v, '^(https?://)?(www\.)?github\.com/', '', 'i');
  -- بعد شيل الدومين: أي لينك تاني أو مسار بـ slash مرفوض
  IF v ~* '^https?://' OR pg_catalog.strpos(v, '/') > 0 OR pg_catalog.strpos(v, ' ') > 0 THEN
    RETURN NULL;
  END IF;
  v := pg_catalog.lower(pg_catalog.ltrim(v, '@'));
  IF v !~ '^[a-z0-9]([a-z0-9]|-(?=[a-z0-9])){0,38}$' THEN
    RETURN NULL;
  END IF;
  IF v = ANY (ARRAY['about', 'orgs', 'settings', 'features', 'topics', 'collections',
                    'marketplace', 'sponsors', 'login', 'join', 'explore', 'pricing', 'enterprise']) THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

-- 2) حل الـ handle من نفس المصادر اللي الواجهة بتستخدمها، بنفس الترتيب:
--    custom_fields.github ← أي حقل اسمه فيه GitHub ← لينك بورتفوليو على github.com
CREATE OR REPLACE FUNCTION public.member_github_resolve(p_custom JSONB, p_portfolio TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    public.member_github_strict(COALESCE(p_custom, '{}'::jsonb) ->> 'github'),
    (
      SELECT public.member_github_strict(field.value)
        FROM pg_catalog.jsonb_each_text(COALESCE(p_custom, '{}'::jsonb)) AS field(key, value)
       WHERE field.key <> 'github'
         AND field.key ~* 'git\s*hub|جيت\s*هاب'
         AND public.member_github_strict(field.value) IS NOT NULL
       ORDER BY field.key
       LIMIT 1
    ),
    CASE
      WHEN COALESCE(p_portfolio, '') ~* 'github\.com/' THEN public.member_github_strict(p_portfolio)
      ELSE NULL
    END
  );
$$;

-- نفس نمط باقي الهيلبرز: مفيش استدعاء مباشر من anon/authenticated.
REVOKE ALL ON FUNCTION public.member_github_strict(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_github_resolve(JSONB, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- 3) الحالة بقت بتقرأ من الحل الموحّد وبتقول مصدر الربط.
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
  v_direct TEXT;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: ربط الكود متاح لأعضاء الفريق بس.';
  END IF;
  SELECT public.member_github_resolve(m.custom_fields, m.portfolio_url),
         public.member_github_strict(m.custom_fields ->> 'github')
    INTO v_handle, v_direct
  FROM public.members AS m
  WHERE m.id = v_member_id;
  RETURN jsonb_build_object(
    'handle', v_handle,
    'linked', v_handle IS NOT NULL,
    'profile_url', CASE WHEN v_handle IS NULL THEN NULL ELSE 'https://github.com/' || v_handle END,
    'source', CASE
                WHEN v_handle IS NULL THEN NULL
                WHEN v_direct = v_handle THEN 'custom'
                ELSE 'detected'
              END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_github_state() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_github_state() TO authenticated;

-- 4) الربط/فك الربط: التحقق من التكرار بقى على الحل الموحّد، وفك الربط
--    بيشيل كل مصدر كان بيغذّي الـ handle (وإلا العضو بيفك الربط ويفضل مربوط).
CREATE OR REPLACE FUNCTION public.member_github_link(p_handle TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_raw TEXT := pg_catalog.btrim(COALESCE(p_handle, ''));
  v_handle TEXT;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: ربط الكود متاح لأعضاء الفريق بس.';
  END IF;
  -- فك الربط
  IF v_raw = '' THEN
    UPDATE public.members
       SET custom_fields = (
             SELECT COALESCE(pg_catalog.jsonb_object_agg(field.key, field.value), '{}'::jsonb)
               FROM pg_catalog.jsonb_each(COALESCE(custom_fields, '{}'::jsonb)) AS field(key, value)
              WHERE field.key <> 'github'
                AND NOT (field.key ~* 'git\s*hub|جيت\s*هاب'
                         AND public.member_github_strict(field.value #>> '{}') IS NOT NULL)
           ),
           portfolio_url = CASE
                             WHEN COALESCE(portfolio_url, '') ~* 'github\.com/' THEN NULL
                             ELSE portfolio_url
                           END
     WHERE id = v_member_id;
    RETURN jsonb_build_object('handle', NULL, 'linked', false, 'profile_url', NULL, 'source', NULL);
  END IF;
  v_handle := public.member_github_strict(v_raw);
  IF v_handle IS NULL THEN
    RAISE EXCEPTION 'INVALID_HANDLE: اسم حساب GitHub غير صحيح.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.members AS m
    WHERE m.id <> v_member_id
      AND public.member_github_resolve(m.custom_fields, m.portfolio_url) = v_handle
  ) THEN
    RAISE EXCEPTION 'HANDLE_TAKEN: حساب GitHub ده مربوط بعضو تاني.';
  END IF;
  UPDATE public.members
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('github', v_handle)
   WHERE id = v_member_id;
  RETURN jsonb_build_object(
    'handle', v_handle,
    'linked', true,
    'profile_url', 'https://github.com/' || v_handle,
    'source', 'custom'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_github_link(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_github_link(TEXT) TO authenticated;

-- 5) تطبيع الموجود: أي عضو الـ handle بتاعه جاي من البورتفوليو أو من حقل اسمه
--    GitHub بيتكتب في custom_fields.github، فالحالة والفلتر والإكسبورت بيقروا
--    نفس القيمة من مكان واحد. آمن ومتكرر من غير أثر (idempotent).
WITH resolved AS (
  SELECT m.id,
         public.member_github_resolve(m.custom_fields, m.portfolio_url) AS handle
    FROM public.members AS m
   WHERE public.member_github_strict(m.custom_fields ->> 'github') IS NULL
),
unique_handles AS (
  -- لو نفس الحساب متكرر على أكتر من عضو مش بنخمّن مين صاحبه: نسيبهم زي ما هم
  -- والفلتر هيوريهم «لسه ما ربطوش» لحد ما كل واحد يربط بنفسه.
  SELECT handle
    FROM resolved
   WHERE handle IS NOT NULL
   GROUP BY handle
  HAVING pg_catalog.count(*) = 1
)
UPDATE public.members AS m
   SET custom_fields = COALESCE(m.custom_fields, '{}'::jsonb) || jsonb_build_object('github', r.handle)
  FROM resolved AS r
  JOIN unique_handles AS u ON u.handle = r.handle
 WHERE m.id = r.id
   AND r.handle IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.members AS other
      WHERE other.id <> m.id
        AND public.member_github_strict(other.custom_fields ->> 'github') = r.handle
   );

COMMIT;
