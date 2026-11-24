-- Round 33b — تصحيح في تطبيع الـ handle: بعد شيل دومين github.com كان لازم
-- نشيل المسار اللي بعده (مثال: github.com/user/repo أو github.com/user/) قبل
-- التحقق، وإلا اللينك اللي فيه مسار كان بيترفض والعضو يظهر «مش مربوط».
BEGIN;

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
  v := pg_catalog.regexp_replace(v, '^(https?://)?(www\.)?github\.com/?', '', 'i');
  -- المسار أو الـ query بعد اسم الحساب مش جزء من الـ handle
  v := pg_catalog.regexp_replace(v, '[/?#].*$', '');
  IF v = '' OR v ~* '^https?://' OR pg_catalog.strpos(v, ' ') > 0 THEN
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
REVOKE ALL ON FUNCTION public.member_github_strict(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- إعادة التطبيع بعد التصحيح (idempotent: بيكتب بس للناقص).
WITH resolved AS (
  SELECT m.id,
         public.member_github_resolve(m.custom_fields, m.portfolio_url) AS handle
    FROM public.members AS m
   WHERE public.member_github_strict(m.custom_fields ->> 'github') IS NULL
),
unique_handles AS (
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
