-- بوابة العضو: مساهمات الفريق ونبض الفريق واتجاه المساهمات.
--
-- سجل اعتماد المهام (task_contribution_events) خاص، وكان متاح للإدارة بس عبر
-- get_task_contributions() اللي بتشترط has_admin_permission('dashboard').
-- الدالة دي بتفتح نفس الملخص للعضو المسجّل (binding مؤكد + بريد مؤكد + عضوية
-- نشطة) من غير ما تفتح الجدول نفسه، وبترجع أسماء الأعضاء عشان النبض يظهر
-- من غير ما العضو يحتاج قراءة جدول members كامل.
BEGIN;

CREATE FUNCTION public.get_member_team_insights(p_year INTEGER)
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

  -- الخلية بتسخن بعدد الناس اللي اشتغلوا في نفس اليوم، فالـ crew بيتحسب هنا
  -- بدل ما العميل يعيد بناءه من بيانات مهام مش متاحة للأعضاء.
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
               'last_approved_on', ranked.last_approved_on
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
           per.last_approved_on
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

  RETURN jsonb_build_object(
    'timezone', 'Africa/Cairo',
    'tracking_started_at', v_tracking_started_at,
    'today', v_today,
    'year', p_year,
    'history_complete_since', v_history_complete_since,
    'days', v_days,
    'total_approvals', v_total_approvals,
    'members', v_members,
    'roster_size', v_roster
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_team_insights(INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_team_insights(INTEGER) TO authenticated;

COMMIT;