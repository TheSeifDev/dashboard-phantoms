-- Round 26 — تكملة الخزنة الـglobal:
-- 1) هيدز/مونيتورز التيمات (زي الأول) ليهم صلاحية إدارة الخزنة، مش الأدمن بس.
-- 2) منع تكرار نفس الالتزام على نفس العضو برسالة عربية واضحة بدل خطأ unique خام.
BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_can_manage()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.has_admin_permission('members')
      OR EXISTS (
        SELECT 1
        FROM public.admin_accounts AS a
        JOIN auth.users AS u ON u.id = a.user_id
        WHERE a.user_id = auth.uid()
          AND a.role IN ('owner', 'admin')
          AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until <= now())
      )
      OR EXISTS (
        SELECT 1
        FROM public.team_admin_assignments AS a
        JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
        JOIN auth.users AS u ON u.id = a.user_id
        WHERE a.user_id = auth.uid()
          AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until <= now())
      )
    );
$$;
REVOKE ALL ON FUNCTION public.ledger_can_manage() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_can_manage() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ledger_save_due(p_payload JSONB)
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
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على الخزنة.';
  END IF;
  IF COALESCE(p_payload ->> 'member_id', '') ~ '^[0-9]+$' THEN
    v_member_id := (p_payload ->> 'member_id')::BIGINT;
  END IF;
  IF v_member_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.members AS m WHERE m.id = v_member_id) THEN
    RAISE EXCEPTION 'INVALID_MEMBER: لازم تحدد العضو.';
  END IF;
  IF v_label IS NULL OR char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'INVALID_LABEL: اكتب اسم الالتزام.';
  END IF;
  IF COALESCE(p_payload ->> 'amount', '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
  END IF;
  v_amount := (p_payload ->> 'amount')::NUMERIC;
  IF v_amount <= 0 OR v_amount > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.';
  END IF;
  v_due_on := NULLIF(p_payload ->> 'due_on', '')::DATE;
  IF COALESCE(p_payload ->> 'id', '') ~ '^[0-9]+$' THEN
    v_id := (p_payload ->> 'id')::BIGINT;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.team_ledger_dues AS d
    WHERE d.member_id = v_member_id
      AND pg_catalog.lower(pg_catalog.btrim(d.label)) = pg_catalog.lower(v_label)
      AND (v_id IS NULL OR d.id <> v_id)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_DUE: نفس الالتزام متسجل للعضو ده بالفعل.';
  END IF;
  IF v_id IS NOT NULL THEN
    UPDATE public.team_ledger_dues
       SET member_id = v_member_id,
           label = v_label,
           amount = v_amount,
           due_on = v_due_on,
           updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DUE_NOT_FOUND: الالتزام غير موجود.';
    END IF;
  ELSE
    INSERT INTO public.team_ledger_dues (team_id, member_id, label, amount, due_on, created_by)
    VALUES (NULL, v_member_id, v_label, v_amount, v_due_on, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_save_due(JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_save_due(JSONB) TO authenticated;

COMMIT;
