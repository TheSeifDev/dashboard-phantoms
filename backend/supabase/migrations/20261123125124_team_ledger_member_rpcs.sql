-- خزنة الفريق — RPCs العضو: ملخص الخزنة للتيم، مصروفاته، التزاماته، وتسجيل «أنا دفعت» (pending).
BEGIN;
-- ---------------------------------------------------------------------------
-- العضو: ملخص الخزنة + مصروفات التيم + التزاماته ودفعاته
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_ledger(p_team_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_team_id UUID := p_team_id;
  v_team JSONB;
  v_teams JSONB;
  v_summary JSONB;
  v_expenses JSONB;
  v_dues JSONB;
  v_payments JSONB;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: الخزنة متاحة لأعضاء الفريق بس.';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name) ORDER BY t.name), '[]'::JSONB)
    INTO v_teams
  FROM public.team_memberships AS tm
  JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
  WHERE tm.member_id = v_member_id
    AND COALESCE(tm.status, 'active') = 'active';
  IF jsonb_array_length(v_teams) = 0 THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: إنت مش عضو في تيم داخلي لسه.';
  END IF;
  IF v_team_id IS NULL THEN
    v_team_id := (v_teams -> 0 ->> 'id')::UUID;
  ELSIF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_teams) AS t WHERE (t ->> 'id')::UUID = v_team_id
  ) THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: إنت مش عضو في التيم ده.';
  END IF;
  SELECT jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name)
    INTO v_team
  FROM public.teams AS t
  WHERE t.id = v_team_id;
  SELECT jsonb_build_object(
           'collected', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'approved' THEN amount END), 0),
           'expenses', COALESCE(SUM(CASE WHEN kind = 'expense' AND status = 'approved' THEN amount END), 0),
           'withdrawals', COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND status = 'approved' THEN amount END), 0),
           'expense_count', COUNT(*) FILTER (WHERE kind = 'expense' AND status = 'approved'),
           'my_paid', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'approved' AND member_id = v_member_id THEN amount END), 0),
           'my_pending', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'pending' AND member_id = v_member_id THEN amount END), 0),
           'my_expected', COALESCE((SELECT SUM(d.amount) FROM public.team_ledger_dues AS d WHERE d.team_id = v_team_id AND d.member_id = v_member_id), 0)
         )
    INTO v_summary
  FROM public.team_ledger_entries
  WHERE team_id = v_team_id;
  v_summary := v_summary || jsonb_build_object(
    'balance', (v_summary ->> 'collected')::NUMERIC
               - (v_summary ->> 'expenses')::NUMERIC
               - (v_summary ->> 'withdrawals')::NUMERIC,
    'my_remaining', GREATEST(
      (v_summary ->> 'my_expected')::NUMERIC - (v_summary ->> 'my_paid')::NUMERIC,
      0
    )
  );
  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'occurred_on') DESC, (entry ->> 'id')::BIGINT DESC), '[]'::JSONB)
    INTO v_expenses
  FROM (
    SELECT jsonb_build_object(
             'id', l.id,
             'title', l.title,
             'category', l.category,
             'amount', l.amount,
             'note', l.note,
             'occurred_on', l.occurred_on
           ) AS entry
    FROM public.team_ledger_entries AS l
    WHERE l.team_id = v_team_id
      AND l.kind = 'expense'
      AND l.status = 'approved'
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT 200
  ) AS s;
  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'due_on') NULLS LAST, entry ->> 'label'), '[]'::JSONB)
    INTO v_dues
  FROM (
    SELECT jsonb_build_object(
             'id', d.id,
             'label', d.label,
             'amount', d.amount,
             'due_on', d.due_on
           ) AS entry
    FROM public.team_ledger_dues AS d
    WHERE d.team_id = v_team_id AND d.member_id = v_member_id
    ORDER BY d.due_on NULLS LAST, d.created_at
  ) AS s;
  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'occurred_on') DESC, (entry ->> 'id')::BIGINT DESC), '[]'::JSONB)
    INTO v_payments
  FROM (
    SELECT jsonb_build_object(
             'id', l.id,
             'amount', l.amount,
             'status', l.status,
             'note', l.note,
             'receiver_label', public.team_ledger_role_label(l.receiver_user_id),
             'receiver_email', ru.email,
             'due_id', l.due_id,
             'occurred_on', l.occurred_on,
             'decision_note', l.decision_note,
             'decided_at', l.decided_at,
             'created_at', l.created_at
           ) AS entry
    FROM public.team_ledger_entries AS l
    LEFT JOIN auth.users AS ru ON ru.id = l.receiver_user_id
    WHERE l.team_id = v_team_id
      AND l.kind = 'payment'
      AND l.member_id = v_member_id
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT 100
  ) AS s;
  RETURN jsonb_build_object(
    'team', v_team,
    'teams', v_teams,
    'summary', v_summary,
    'expenses', v_expenses,
    'dues', v_dues,
    'payments', v_payments,
    'receivers', public.team_ledger_receivers(v_team_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_ledger(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_ledger(UUID) TO authenticated;
-- ---------------------------------------------------------------------------
-- العضو: تسجيل "أنا دفعت" → pending لحد تأكيد المستلم
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_ledger_declare_payment(p_team_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_amount NUMERIC;
  v_receiver UUID;
  v_due_id BIGINT;
  v_note TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  v_occurred DATE;
  v_id BIGINT;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: الخزنة متاحة لأعضاء الفريق بس.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_memberships AS tm
    JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
    WHERE tm.team_id = p_team_id
      AND tm.member_id = v_member_id
      AND COALESCE(tm.status, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: إنت مش عضو في التيم ده.';
  END IF;
  IF COALESCE(p_payload ->> 'amount', '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
  END IF;
  v_amount := (p_payload ->> 'amount')::NUMERIC;
  IF v_amount <= 0 OR v_amount > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.';
  END IF;
  IF COALESCE(p_payload ->> 'receiver_user_id', '') = '' THEN
    RAISE EXCEPTION 'INVALID_RECEIVER: لازم تختار دفعت لمين.';
  END IF;
  v_receiver := (p_payload ->> 'receiver_user_id')::UUID;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.team_ledger_receivers(p_team_id)) AS r
    WHERE (r ->> 'user_id')::UUID = v_receiver
  ) THEN
    RAISE EXCEPTION 'INVALID_RECEIVER: المستلم لازم يكون مالك أو أدمن أو هيد/مونيتور التيم.';
  END IF;
  IF COALESCE(p_payload ->> 'due_id', '') ~ '^[0-9]+$' THEN
    v_due_id := (p_payload ->> 'due_id')::BIGINT;
    IF NOT EXISTS (
      SELECT 1 FROM public.team_ledger_dues AS d
      WHERE d.id = v_due_id AND d.team_id = p_team_id AND d.member_id = v_member_id
    ) THEN
      RAISE EXCEPTION 'INVALID_DUE: الالتزام مش تابع ليك.';
    END IF;
  END IF;
  v_occurred := COALESCE(NULLIF(p_payload ->> 'occurred_on', '')::DATE, CURRENT_DATE);
  INSERT INTO public.team_ledger_entries (
    team_id, kind, status, amount, note, member_id, receiver_user_id, due_id, occurred_on, created_by
  ) VALUES (
    p_team_id, 'payment', 'pending', v_amount, v_note, v_member_id, v_receiver, v_due_id, v_occurred, auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'amount', v_amount,
    'receiver_label', public.team_ledger_role_label(v_receiver)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_ledger_declare_payment(UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_ledger_declare_payment(UUID, JSONB) TO authenticated;
COMMIT;
