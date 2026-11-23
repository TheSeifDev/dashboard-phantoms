-- خزنة الفريق — RPCs الإدارة: ملخص الخزنة، الحركات، الالتزامات، ومراجعة الدفعات.
BEGIN;
-- ---------------------------------------------------------------------------
-- الإدارة: كل بيانات الخزنة لتيم واحد
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_overview(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team JSONB;
  v_summary JSONB;
  v_entries JSONB;
  v_dues JSONB;
  v_members JSONB;
  v_teams JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: الخزنة متاحة للإدارة فقط.';
  END IF;
  IF NOT public.team_ledger_can_manage(p_team_id) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.';
  END IF;
  SELECT jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name)
    INTO v_team
  FROM public.teams AS t
  WHERE t.id = p_team_id;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND: التيم غير موجود.';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name) ORDER BY t.name), '[]'::JSONB)
    INTO v_teams
  FROM public.teams AS t
  WHERE t.is_active
    AND public.team_ledger_can_manage(t.id);
  SELECT jsonb_build_object(
           'collected', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'approved' THEN amount END), 0),
           'expenses', COALESCE(SUM(CASE WHEN kind = 'expense' AND status = 'approved' THEN amount END), 0),
           'withdrawals', COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND status = 'approved' THEN amount END), 0),
           'pending_count', COUNT(*) FILTER (WHERE kind = 'payment' AND status = 'pending'),
           'pending_amount', COALESCE(SUM(CASE WHEN kind = 'payment' AND status = 'pending' THEN amount END), 0),
           'expense_count', COUNT(*) FILTER (WHERE kind = 'expense' AND status = 'approved'),
           'payment_count', COUNT(*) FILTER (WHERE kind = 'payment' AND status = 'approved')
         )
    INTO v_summary
  FROM public.team_ledger_entries
  WHERE team_id = p_team_id;
  v_summary := v_summary || jsonb_build_object(
    'balance', (v_summary ->> 'collected')::NUMERIC
               - (v_summary ->> 'expenses')::NUMERIC
               - (v_summary ->> 'withdrawals')::NUMERIC,
    'expected', COALESCE((SELECT SUM(d.amount) FROM public.team_ledger_dues AS d WHERE d.team_id = p_team_id), 0)
  );
  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'occurred_on') DESC, (entry ->> 'id')::BIGINT DESC), '[]'::JSONB)
    INTO v_entries
  FROM (
    SELECT jsonb_build_object(
             'id', l.id,
             'kind', l.kind,
             'status', l.status,
             'amount', l.amount,
             'title', l.title,
             'category', l.category,
             'note', l.note,
             'member_id', l.member_id,
             'member_name', m.full_name,
             'receiver_user_id', l.receiver_user_id,
             'receiver_label', public.team_ledger_role_label(l.receiver_user_id),
             'receiver_email', ru.email,
             'due_id', l.due_id,
             'occurred_on', l.occurred_on,
             'decision_note', l.decision_note,
             'decided_at', l.decided_at,
             'created_at', l.created_at
           ) AS entry
    FROM public.team_ledger_entries AS l
    LEFT JOIN public.members AS m ON m.id = l.member_id
    LEFT JOIN auth.users AS ru ON ru.id = l.receiver_user_id
    WHERE l.team_id = p_team_id
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT 600
  ) AS s;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'full_name', (entry ->> 'id')::BIGINT), '[]'::JSONB)
    INTO v_dues
  FROM (
    SELECT jsonb_build_object(
             'id', d.id,
             'member_id', d.member_id,
             'full_name', m.full_name,
             'label', d.label,
             'amount', d.amount,
             'due_on', d.due_on,
             'created_at', d.created_at
           ) AS entry
    FROM public.team_ledger_dues AS d
    JOIN public.members AS m ON m.id = d.member_id
    WHERE d.team_id = p_team_id
    ORDER BY m.full_name, d.created_at
  ) AS s;
  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'late')::BOOLEAN DESC, entry ->> 'full_name'), '[]'::JSONB)
    INTO v_members
  FROM (
    SELECT jsonb_build_object(
             'member_id', r.member_id,
             'full_name', r.full_name,
             'academic_number', r.academic_number,
             'due_total', r.due_total,
             'paid_total', r.paid_total,
             'remaining', GREATEST(r.due_total - r.paid_total, 0),
             'status', CASE
               WHEN r.due_total = 0 AND r.paid_total = 0 THEN 'none'
               WHEN r.due_total = 0 THEN 'extra'
               WHEN r.paid_total >= r.due_total THEN 'paid'
               WHEN r.paid_total > 0 THEN 'partial'
               ELSE 'unpaid'
             END,
             'late', (r.due_total > r.paid_total AND r.next_due_on IS NOT NULL AND r.next_due_on < CURRENT_DATE),
             'next_due_on', r.next_due_on,
             'last_payment_on', r.last_payment_on
           ) AS entry
    FROM (
      SELECT base.member_id,
             base.full_name,
             base.academic_number,
             COALESCE(dues.due_total, 0) AS due_total,
             COALESCE(paid.paid_total, 0) AS paid_total,
             dues.next_due_on,
             paid.last_payment_on
      FROM (
        SELECT m.id AS member_id, m.full_name, m.academic_number
        FROM public.team_memberships AS tm
        JOIN public.members AS m ON m.id = tm.member_id
        WHERE tm.team_id = p_team_id
          AND COALESCE(tm.status, 'active') = 'active'
        UNION
        SELECT m.id, m.full_name, m.academic_number
        FROM public.members AS m
        WHERE m.id IN (
          SELECT d.member_id FROM public.team_ledger_dues AS d WHERE d.team_id = p_team_id
          UNION
          SELECT l.member_id FROM public.team_ledger_entries AS l
          WHERE l.team_id = p_team_id AND l.member_id IS NOT NULL
        )
      ) AS base
      LEFT JOIN LATERAL (
        SELECT SUM(d.amount) AS due_total, MIN(d.due_on) AS next_due_on
        FROM public.team_ledger_dues AS d
        WHERE d.team_id = p_team_id AND d.member_id = base.member_id
      ) AS dues ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(l.amount) AS paid_total, MAX(l.occurred_on) AS last_payment_on
        FROM public.team_ledger_entries AS l
        WHERE l.team_id = p_team_id
          AND l.member_id = base.member_id
          AND l.kind = 'payment'
          AND l.status = 'approved'
      ) AS paid ON TRUE
    ) AS r
  ) AS s;
  v_summary := v_summary || jsonb_build_object(
    'outstanding', COALESCE((
      SELECT SUM((entry ->> 'remaining')::NUMERIC) FROM jsonb_array_elements(v_members) AS entry
    ), 0),
    'late_count', COALESCE((
      SELECT COUNT(*) FROM (
        SELECT (entry ->> 'late')::BOOLEAN AS is_late FROM jsonb_array_elements(v_members) AS entry
      ) AS t WHERE t.is_late
    ), 0),
    'member_count', jsonb_array_length(v_members)
  );
  RETURN jsonb_build_object(
    'team', v_team,
    'teams', v_teams,
    'can_manage', TRUE,
    'summary', v_summary,
    'receivers', public.team_ledger_receivers(p_team_id),
    'entries', v_entries,
    'dues', v_dues,
    'members', v_members
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_overview(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_overview(UUID) TO authenticated;
-- ---------------------------------------------------------------------------
-- الإدارة: إضافة/تعديل حركة (مصروف / خصم / دفعة مسجلة يدويًا)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_save_entry(p_team_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id BIGINT;
  v_kind TEXT := COALESCE(NULLIF(btrim(p_payload ->> 'kind'), ''), '');
  v_status TEXT;
  v_amount NUMERIC;
  v_title TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'title', '')), '');
  v_category TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'category', '')), '');
  v_note TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  v_member_id BIGINT;
  v_receiver UUID;
  v_due_id BIGINT;
  v_occurred DATE;
BEGIN
  IF NOT public.team_ledger_can_manage(p_team_id) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.';
  END IF;
  IF v_kind NOT IN ('payment', 'expense', 'withdrawal') THEN
    RAISE EXCEPTION 'INVALID_KIND: نوع الحركة غير معروف.';
  END IF;
  IF COALESCE(p_payload ->> 'amount', '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
  END IF;
  v_amount := (p_payload ->> 'amount')::NUMERIC;
  IF v_amount <= 0 OR v_amount > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.';
  END IF;
  IF COALESCE(p_payload ->> 'member_id', '') ~ '^[0-9]+$' THEN
    v_member_id := (p_payload ->> 'member_id')::BIGINT;
  END IF;
  IF COALESCE(p_payload ->> 'receiver_user_id', '') <> '' THEN
    v_receiver := (p_payload ->> 'receiver_user_id')::UUID;
  END IF;
  IF COALESCE(p_payload ->> 'due_id', '') ~ '^[0-9]+$' THEN
    v_due_id := (p_payload ->> 'due_id')::BIGINT;
  END IF;
  v_occurred := COALESCE(NULLIF(p_payload ->> 'occurred_on', '')::DATE, CURRENT_DATE);
  IF v_kind = 'payment' THEN
    IF v_member_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.members AS m WHERE m.id = v_member_id) THEN
      RAISE EXCEPTION 'INVALID_MEMBER: لازم تحدد العضو اللي دفع.';
    END IF;
    IF v_receiver IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.team_ledger_receivers(p_team_id)) AS r
      WHERE (r ->> 'user_id')::UUID = v_receiver
    ) THEN
      RAISE EXCEPTION 'INVALID_RECEIVER: المستلم لازم يكون مالك أو أدمن أو هيد/مونيتور التيم.';
    END IF;
    IF v_due_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.team_ledger_dues AS d
      WHERE d.id = v_due_id AND d.team_id = p_team_id AND d.member_id = v_member_id
    ) THEN
      RAISE EXCEPTION 'INVALID_DUE: الالتزام مش تابع للعضو ده.';
    END IF;
    v_status := COALESCE(NULLIF(btrim(p_payload ->> 'status'), ''), 'approved');
    IF v_status NOT IN ('approved', 'pending') THEN
      RAISE EXCEPTION 'INVALID_STATUS: حالة الدفعة غير معروفة.';
    END IF;
  ELSE
    v_status := 'approved';
    v_receiver := NULL;
    v_due_id := NULL;
  END IF;
  IF v_kind = 'expense' THEN
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'INVALID_TITLE: لازم تكتب المصروف اتصرف في إيه.';
    END IF;
    IF v_category IS NULL THEN v_category := 'other'; END IF;
    IF v_category NOT IN ('equipment', 'software', 'subscription', 'transport', 'food', 'printing', 'event', 'marketing', 'other') THEN
      RAISE EXCEPTION 'INVALID_CATEGORY: تصنيف المصروف غير معروف.';
    END IF;
    v_member_id := NULL;
  END IF;
  IF v_kind = 'withdrawal' THEN
    IF v_member_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.members AS m WHERE m.id = v_member_id) THEN
      RAISE EXCEPTION 'INVALID_MEMBER: لازم تحدد العضو اللي سحب.';
    END IF;
    v_category := NULL;
  END IF;
  IF COALESCE(p_payload ->> 'id', '') ~ '^[0-9]+$' THEN
    v_id := (p_payload ->> 'id')::BIGINT;
    UPDATE public.team_ledger_entries
       SET kind = v_kind,
           status = v_status,
           amount = v_amount,
           title = v_title,
           category = v_category,
           note = v_note,
           member_id = v_member_id,
           receiver_user_id = v_receiver,
           due_id = v_due_id,
           occurred_on = v_occurred,
           updated_at = now(),
           decided_by = CASE WHEN v_status = 'approved' AND decided_at IS NULL THEN auth.uid() ELSE decided_by END,
           decided_at = CASE WHEN v_status = 'approved' AND decided_at IS NULL THEN now() ELSE decided_at END
     WHERE id = v_id AND team_id = p_team_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ENTRY_NOT_FOUND: الحركة غير موجودة.';
    END IF;
  ELSE
    INSERT INTO public.team_ledger_entries (
      team_id, kind, status, amount, title, category, note,
      member_id, receiver_user_id, due_id, occurred_on, created_by, decided_by, decided_at
    ) VALUES (
      p_team_id, v_kind, v_status, v_amount, v_title, v_category, v_note,
      v_member_id, v_receiver, v_due_id, v_occurred, auth.uid(),
      CASE WHEN v_status = 'approved' THEN auth.uid() END,
      CASE WHEN v_status = 'approved' THEN now() END
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_save_entry(UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_save_entry(UUID, JSONB) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_ledger_delete_entry(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
BEGIN
  SELECT team_id INTO v_team_id FROM public.team_ledger_entries WHERE id = p_id;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: الحركة غير موجودة.';
  END IF;
  IF NOT public.team_ledger_can_manage(v_team_id) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.';
  END IF;
  DELETE FROM public.team_ledger_entries WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_delete_entry(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_delete_entry(BIGINT) TO authenticated;
-- ---------------------------------------------------------------------------
-- الإدارة: مراجعة دفعة (approved / rejected + ملاحظة + تصحيح المبلغ)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_decide(
  p_id BIGINT,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.team_ledger_entries%ROWTYPE;
  v_decision TEXT := lower(btrim(COALESCE(p_decision, '')));
  v_amount NUMERIC;
BEGIN
  SELECT * INTO v_entry FROM public.team_ledger_entries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: الحركة غير موجودة.';
  END IF;
  IF NOT (
    public.team_ledger_can_manage(v_entry.team_id)
    OR v_entry.receiver_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: المراجعة متاحة للمستلم أو إدارة التيم بس.';
  END IF;
  IF v_entry.kind <> 'payment' THEN
    RAISE EXCEPTION 'INVALID_KIND: المراجعة بتاعت الدفعات بس.';
  END IF;
  IF v_entry.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_DECIDED: الدفعة دي اتقرر فيها بالفعل.';
  END IF;
  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'INVALID_DECISION: القرار لازم يكون approve أو reject.';
  END IF;
  v_amount := COALESCE(p_amount, v_entry.amount);
  IF v_decision = 'approve' THEN
    IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 10000000 THEN
      RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
    END IF;
  ELSE
    v_amount := v_entry.amount;
  END IF;
  UPDATE public.team_ledger_entries
     SET status = CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         amount = v_amount,
         decision_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         decided_by = auth.uid(),
         decided_at = now(),
         updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object(
    'id', p_id,
    'status', CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    'amount', v_amount
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_decide(BIGINT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_decide(BIGINT, TEXT, TEXT, NUMERIC) TO authenticated;
-- ---------------------------------------------------------------------------
-- الإدارة: الالتزامات (dues)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_save_due(p_team_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id BIGINT;
  v_member_id BIGINT;
  v_label TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'label', '')), '');
  v_amount NUMERIC;
  v_due_on DATE;
BEGIN
  IF NOT public.team_ledger_can_manage(p_team_id) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.';
  END IF;
  IF COALESCE(p_payload ->> 'member_id', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_MEMBER: لازم تحدد العضو.';
  END IF;
  v_member_id := (p_payload ->> 'member_id')::BIGINT;
  IF NOT EXISTS (SELECT 1 FROM public.members AS m WHERE m.id = v_member_id) THEN
    RAISE EXCEPTION 'INVALID_MEMBER: العضو غير موجود.';
  END IF;
  IF v_label IS NULL OR char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'INVALID_TITLE: لازم تكتب اسم الالتزام (اشتراك، رحلة، ...).';
  END IF;
  IF COALESCE(p_payload ->> 'amount', '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
  END IF;
  v_amount := (p_payload ->> 'amount')::NUMERIC;
  IF v_amount <= 0 OR v_amount > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.';
  END IF;
  v_due_on := NULLIF(p_payload ->> 'due_on', '')::DATE;
  BEGIN
    IF COALESCE(p_payload ->> 'id', '') ~ '^[0-9]+$' THEN
      v_id := (p_payload ->> 'id')::BIGINT;
      UPDATE public.team_ledger_dues
         SET member_id = v_member_id, label = v_label, amount = v_amount,
             due_on = v_due_on, updated_at = now()
       WHERE id = v_id AND team_id = p_team_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'DUE_NOT_FOUND: الالتزام غير موجود.';
      END IF;
    ELSE
      INSERT INTO public.team_ledger_dues (team_id, member_id, label, amount, due_on, created_by)
      VALUES (p_team_id, v_member_id, v_label, v_amount, v_due_on, auth.uid())
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DUPLICATE_DUE: نفس الالتزام متسجل للعضو ده بالفعل.';
  END;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_save_due(UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_save_due(UUID, JSONB) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_ledger_delete_due(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
BEGIN
  SELECT team_id INTO v_team_id FROM public.team_ledger_dues WHERE id = p_id;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'DUE_NOT_FOUND: الالتزام غير موجود.';
  END IF;
  IF NOT public.team_ledger_can_manage(v_team_id) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على خزنة التيم ده.';
  END IF;
  DELETE FROM public.team_ledger_dues WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_delete_due(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_delete_due(BIGINT) TO authenticated;
COMMIT;
