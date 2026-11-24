-- Round 26 — سلسلة أرقام الخزنة لآخر 6 شهور (للشارت والـ sparkline في الـ UI).
-- بترجع شهر/شهر لكل الحركات المؤكدة، مع رصيد تراكمي، وبتتقصى بنفس فلتر الوحدة.
BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_series(p_unit TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_unit TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_unit, '')), '');
  v_rows JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: الخزنة متاحة لأعضاء الفريق بس.';
  END IF;

  WITH months AS (
    SELECT pg_catalog.generate_series(5, 0, -1) AS back
  ),
  buckets AS (
    SELECT
      m.back,
      pg_catalog.date_trunc('month', pg_catalog.now()) - (m.back || ' month')::INTERVAL AS month_start
    FROM months AS m
  ),
  totals AS (
    SELECT
      b.back,
      b.month_start,
      COALESCE(SUM(CASE WHEN l.kind = 'payment' AND l.status = 'approved' THEN l.amount END), 0) AS collected,
      COALESCE(SUM(CASE WHEN l.kind = 'expense' AND l.status = 'approved' THEN l.amount END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN l.kind = 'withdrawal' AND l.status = 'approved' THEN l.amount END), 0) AS withdrawals
    FROM buckets AS b
    LEFT JOIN public.team_ledger_entries AS l
      ON l.occurred_on >= b.month_start::DATE
     AND l.occurred_on < (b.month_start + INTERVAL '1 month')::DATE
     AND (
       v_unit IS NULL
       OR (l.member_id IS NOT NULL AND public.member_unit(l.member_id) = v_unit)
     )
    GROUP BY b.back, b.month_start
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month', pg_catalog.to_char(t.month_start, 'YYYY-MM'),
        'collected', t.collected,
        'expenses', t.expenses,
        'withdrawals', t.withdrawals,
        'balance', SUM(t.collected - t.expenses - t.withdrawals) OVER (ORDER BY t.month_start)
      )
      ORDER BY t.month_start
    ),
    '[]'::JSONB
  )
  INTO v_rows
  FROM totals AS t;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_series(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_series(TEXT) TO authenticated;

COMMIT;
