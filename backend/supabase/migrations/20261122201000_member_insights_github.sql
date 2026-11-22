-- بوابة العضو: خريطة مساهمات GitHub بنفس شكل لوحة الإدارة.
--
-- لوحة الإدارة بتستخرج handle من الحقل المخصص «GitHub» أو من رابط github.com
-- في الملف الشخصي (resolveGithubHandle في الواجهة). جدول members محجوب عن
-- الأعضاء، فبنفس المنطق بقى متاح جوه get_member_team_insights() كحقل واحد
-- (github_handle) لكل عضو + قائمة roster للأعضاء اللي ربطوا حساب.
-- التقويم اليومي نفسه بيتجاب من GitHub في المتصفح؛ الدالة بترجّع الـ handle بس.
BEGIN;
-- نفس قواعد normalizeGithubHandle في الواجهة: رابط github.com أو @handle أو
-- handle خام، مع استبعاد المسارات المحجوزة والمدخلات اللي فيها شرطة زيادة.
CREATE OR REPLACE FUNCTION public.normalize_github_handle(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_value TEXT := btrim(COALESCE(p_raw, ''));
BEGIN
  IF v_value = '' THEN
    RETURN NULL;
  END IF;
  IF v_value ~* '^(https?://)?(www\.)?github\.com/' THEN
    v_value := (regexp_match(v_value, 'github\.com/([^/?#[:space:]]+)'))[1];
  ELSIF v_value ~* '^https?://' OR position('/' IN v_value) > 0 THEN
    RETURN NULL;
  END IF;
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;
  v_value := regexp_replace(v_value, '^@', '');
  IF v_value !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37})$' OR v_value ~ '-$' THEN
    RETURN NULL;
  END IF;
  IF lower(v_value) IN (
    'about', 'orgs', 'settings', 'features', 'topics', 'collections',
    'marketplace', 'sponsors', 'login', 'join', 'explore', 'pricing', 'enterprise'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN v_value;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_github_handle(TEXT) FROM PUBLIC, anon, authenticated, service_role;
-- الحقل المخصص اللي اسمه فيه GitHub/جيت هاب بيكسب، وإلا رابط github.com في الملف.
CREATE OR REPLACE FUNCTION public.member_github_handle(p_custom_fields JSONB, p_portfolio_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_entry RECORD;
  v_handle TEXT;
BEGIN
  IF p_custom_fields IS NOT NULL AND jsonb_typeof(p_custom_fields) = 'object' THEN
    FOR v_entry IN SELECT key, value FROM jsonb_each_text(p_custom_fields) LOOP
      IF v_entry.key ~* 'git[[:space:]]*hub|جيت[[:space:]]*هاب' THEN
        v_handle := public.normalize_github_handle(v_entry.value);
        IF v_handle IS NOT NULL THEN
          RETURN v_handle;
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN public.normalize_github_handle(p_portfolio_url);
END;
$$;
REVOKE ALL ON FUNCTION public.member_github_handle(JSONB, TEXT) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.get_member_team_insights(p_year INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (timezone('Africa/Cairo', statement_timestamp()))::DATE;
  v_current_year INTEGER;
  v_year_start TIMESTAMPTZ;
  v_year_end TIMESTAMPTZ;
  v_tracking_started_at TIMESTAMPTZ;
  v_history_complete_since TIMESTAMPTZ;
  v_days JSONB;
  v_total_approvals BIGINT;
  v_members JSONB;
  v_roster_json JSONB;
  v_roster INTEGER;
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.has_admin_permission('dashboard') OR public.web_current_member_id() IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: ملخص مساهمات الفريق متاح لأعضاء الفريق المسجلين فقط.';
  END IF;
  v_current_year := EXTRACT(YEAR FROM v_today)::INTEGER;
  IF p_year IS NULL OR p_year < 2000 OR p_year > v_current_year THEN
    RAISE EXCEPTION 'INVALID_YEAR: السنة المطلوبة خارج النطاق المسموح.';
  END IF;
  v_year_start := make_date(p_year, 1, 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
  v_year_end := make_date(p_year + 1, 1, 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
  SELECT c.tracking_started_at, c.history_complete_since
    INTO v_tracking_started_at, v_history_complete_since
  FROM public.task_contribution_ledger_config AS c
  WHERE c.singleton = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_CONTRIBUTION_LEDGER_UNAVAILABLE';
  END IF;
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object('date', daily.activity_date, 'count', daily.approval_count, 'crew', daily.crew_count)
             ORDER BY daily.activity_date
           ),
           '[]'::jsonb
         ),
         COALESCE(SUM(daily.approval_count), 0)::BIGINT
    INTO v_days, v_total_approvals
  FROM (
    SELECT timezone('Africa/Cairo', e.occurred_at)::DATE AS activity_date,
           COUNT(*)::BIGINT AS approval_count,
           COUNT(DISTINCT e.member_id)::BIGINT AS crew_count
    FROM public.task_contribution_events AS e
    WHERE e.event_type = 'approved'
      AND e.occurred_at >= v_year_start
      AND e.occurred_at < v_year_end
      AND e.occurred_at <= statement_timestamp()
    GROUP BY timezone('Africa/Cairo', e.occurred_at)::DATE
    ORDER BY timezone('Africa/Cairo', e.occurred_at)::DATE
    LIMIT 366
  ) AS daily;
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'member_id', ranked.member_id,
               'full_name', ranked.full_name,
               'approved', ranked.approved,
               'active_days', ranked.active_days,
               'last_approved_on', ranked.last_approved_on,
               'github_handle', ranked.github_handle
             )
             ORDER BY ranked.approved DESC, ranked.full_name
           ),
           '[]'::jsonb
         )
    INTO v_members
  FROM (
    SELECT per.member_id,
           COALESCE(m.full_name, '#' || per.member_id::TEXT) AS full_name,
           per.approved,
           per.active_days,
           per.last_approved_on,
           public.member_github_handle(m.custom_fields, m.portfolio_url) AS github_handle
    FROM (
      SELECT e.member_id,
             COUNT(*)::BIGINT AS approved,
             COUNT(DISTINCT timezone('Africa/Cairo', e.occurred_at)::DATE)::BIGINT AS active_days,
             MAX(timezone('Africa/Cairo', e.occurred_at)::DATE) AS last_approved_on
      FROM public.task_contribution_events AS e
      WHERE e.event_type = 'approved'
        AND e.occurred_at >= v_year_start
        AND e.occurred_at < v_year_end
        AND e.occurred_at <= statement_timestamp()
      GROUP BY e.member_id
    ) AS per
    LEFT JOIN public.members AS m ON m.id = per.member_id
  ) AS ranked;
  SELECT COUNT(*)::INTEGER INTO v_roster
  FROM public.members AS m
  WHERE m.work_status = 'active';
  -- الأعضاء اللي ربطوا GitHub: الاسم + الـ handle بس، عشان الخريطة تجيب
  -- تقويم كل حساب وتعمل أفاتار من غير ما العضو يقرأ جدول الأعضاء.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'member_id', linked.id,
               'full_name', linked.full_name,
               'github_handle', linked.github_handle
             )
             ORDER BY linked.full_name
           ),
           '[]'::jsonb
         )
    INTO v_roster_json
  FROM (
    SELECT m.id,
           m.full_name,
           public.member_github_handle(m.custom_fields, m.portfolio_url) AS github_handle
    FROM public.members AS m
    WHERE m.work_status = 'active'
    ORDER BY m.full_name
    LIMIT 500
  ) AS linked
  WHERE linked.github_handle IS NOT NULL;
  RETURN jsonb_build_object(
    'timezone', 'Africa/Cairo',
    'tracking_started_at', v_tracking_started_at,
    'today', v_today,
    'year', p_year,
    'history_complete_since', v_history_complete_since,
    'days', v_days,
    'total_approvals', v_total_approvals,
    'members', v_members,
    'roster', v_roster_json,
    'roster_size', v_roster
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_team_insights(INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_team_insights(INTEGER) TO authenticated;
COMMIT;