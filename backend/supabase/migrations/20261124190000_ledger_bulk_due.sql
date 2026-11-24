-- Round 30 — الزام جماعي:
-- الأدمن بيكتب المبلغ الإجمالي مرة واحدة (3500) فبيتقسم على الأعضاء المختارين،
-- أو بيكتب المبلغ للفرد (100) فبيتحسب الإجمالي. الحساب في الباك إند عشان
-- الإجمالي يطلع مضبوط بالقرش مهما كان عدد الأعضاء.
BEGIN;

-- دليل الأعضاء (كل الأعضاء النشطين + التيم/الوحدة) عشان اختيار أعضاء الالتزام
-- الجماعي يبقى من كل الفريق، مش من اللي عليهم حركة في الخزنة بس.
CREATE OR REPLACE FUNCTION public.admin_ledger_directory()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على الخزنة.';
  END IF;
  RETURN jsonb_build_object(
    'members', (
      SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'full_name'), '[]'::JSONB)
      FROM (
        SELECT jsonb_build_object(
                 'id', m.id,
                 'full_name', m.full_name,
                 'academic_number', m.academic_number,
                 'unit', public.member_unit(m.id),
                 'work_status', m.work_status
               ) AS entry
        FROM public.members AS m
        WHERE COALESCE(m.work_status, 'active') <> 'left'
      ) AS s
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_directory() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_directory() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ledger_save_due_bulk(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label TEXT := NULLIF(btrim(COALESCE(p_payload ->> 'label', '')), '');
  v_due_on DATE;
  v_mode TEXT := COALESCE(NULLIF(p_payload ->> 'mode', ''), 'total');
  v_amount NUMERIC;
  v_selected BIGINT[] := '{}';
  v_targets BIGINT[] := '{}';
  v_selected_count INT := 0;
  v_target_count INT := 0;
  v_per NUMERIC;
  v_total NUMERIC;
  v_created INT := 0;
BEGIN
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على الخزنة.';
  END IF;
  IF v_mode NOT IN ('total', 'per_member') THEN
    RAISE EXCEPTION 'INVALID_MODE: طريقة الحساب غير معروفة.';
  END IF;
  IF v_label IS NULL OR char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'INVALID_LABEL: اكتب اسم الالتزام.';
  END IF;
  IF COALESCE(p_payload ->> 'amount', '') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
  END IF;
  v_amount := (p_payload ->> 'amount')::NUMERIC;
  IF v_amount <= 0 OR v_amount > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.';
  END IF;
  v_due_on := NULLIF(p_payload ->> 'due_on', '')::DATE;

  SELECT COALESCE(array_agg(DISTINCT candidate.id), '{}')
    INTO v_selected
  FROM jsonb_array_elements_text(COALESCE(p_payload -> 'member_ids', '[]'::jsonb)) AS raw(value)
  JOIN public.members AS candidate ON candidate.id = NULLIF(raw.value, '')::BIGINT
  WHERE raw.value ~ '^[0-9]+$';
  v_selected_count := COALESCE(array_length(v_selected, 1), 0);
  IF v_selected_count = 0 THEN
    RAISE EXCEPTION 'INVALID_MEMBERS: اختار عضو واحد على الأقل.';
  END IF;

  -- اللي عنده نفس الالتزام بالفعل بيتخطى بدل ما الطلب كله يفشل.
  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.id), '{}')
    INTO v_targets
  FROM unnest(v_selected) AS candidate(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.team_ledger_dues AS d
    WHERE d.member_id = candidate.id
      AND pg_catalog.lower(pg_catalog.btrim(d.label)) = pg_catalog.lower(v_label)
  );
  v_target_count := COALESCE(array_length(v_targets, 1), 0);

  IF v_target_count = 0 THEN
    RETURN jsonb_build_object(
      'created', 0,
      'skipped', v_selected_count,
      'per_member', 0,
      'total', 0,
      'members', 0
    );
  END IF;

  IF v_mode = 'per_member' THEN
    v_per := round(v_amount, 2);
    v_total := round(v_per * v_target_count, 2);
  ELSE
    v_total := round(v_amount, 2);
    v_per := round(v_total / v_target_count, 2);
    IF v_per <= 0 THEN
      RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ صغير جدًا على عدد الأعضاء ده.';
    END IF;
  END IF;
  IF v_total > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: الإجمالي أكبر من 10,000,000.';
  END IF;

  -- آخر عضو بياخد الباقي عشان مجموع الالتزامات يساوي الإجمالي بالظبط.
  INSERT INTO public.team_ledger_dues (team_id, member_id, label, amount, due_on, created_by)
  SELECT
    NULL,
    target.id,
    v_label,
    CASE
      WHEN target.rn = v_target_count THEN round(v_total - v_per * (v_target_count - 1), 2)
      ELSE v_per
    END,
    v_due_on,
    auth.uid()
  FROM (
    SELECT member_id AS id, row_number() OVER (ORDER BY member_id) AS rn
    FROM unnest(v_targets) AS member_id
  ) AS target;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'created', v_created,
    'skipped', v_selected_count - v_created,
    'per_member', v_per,
    'total', v_total,
    'members', v_created
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_save_due_bulk(JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_save_due_bulk(JSONB) TO authenticated;

COMMIT;
