-- Round 26 — إصلاح ledger_series: الـ window function كانت جوه jsonb_agg
-- (aggregate function calls cannot contain window function calls).
-- الحل: نحسب الرصيد التراكمي في CTE منفصلة وبعدها نجمّع.
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
  ),
  running AS (
    SELECT
      t.month_start,
      t.collected,
      t.expenses,
      t.withdrawals,
      SUM(t.collected - t.expenses - t.withdrawals) OVER (ORDER BY t.month_start) AS balance
    FROM totals AS t
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month', pg_catalog.to_char(r.month_start, 'YYYY-MM'),
        'collected', r.collected,
        'expenses', r.expenses,
        'withdrawals', r.withdrawals,
        'balance', r.balance
      )
      ORDER BY r.month_start
    ),
    '[]'::JSONB
  )
  INTO v_rows
  FROM running AS r;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_series(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_series(TEXT) TO authenticated;

COMMIT;
