-- Round 26 — الخزنة بقت global بدل خزنة لكل تيم.
--
-- * team_ledger_entries / team_ledger_dues بقوا خزنة واحدة لكل الفريق:
--   team_id بقى nullable ومش مستخدم في أي فلترة أو صلاحية.
-- * الاستلام: الأدمن/المالك أو هيدز/مونيتورز التيم اللي العضو مسجل فيه.
-- * الفلتر بقى "التيم/الوحدة" اللي العضو تابع لها (AI / Software / Hardware /
--   HR / PR / co-leader / المالك …) وبيتحدد بـ member_unit().
-- * العضو بيشوف كل أرقام الخزنة والمصروفات، ما عدا مين دفع ومين مدفعش
--   (مفيش members array في payload العضو أصلاً).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) الجداول: خزنة واحدة
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_ledger_dues ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.team_ledger_entries ALTER COLUMN team_id DROP NOT NULL;
DROP INDEX IF EXISTS public.team_ledger_dues_unique;
CREATE UNIQUE INDEX team_ledger_dues_member_label
  ON public.team_ledger_dues (member_id, lower(btrim(label)));
CREATE INDEX IF NOT EXISTS team_ledger_dues_member_idx
  ON public.team_ledger_dues (member_id);

COMMENT ON COLUMN public.team_ledger_entries.team_id IS
  'Legacy: الخزنة بقت global، العمود ده مش مستخدم في أي صلاحية أو فلترة.';
COMMENT ON COLUMN public.team_ledger_dues.team_id IS
  'Legacy: الالتزامات بقت على مستوى الفريق كله، العمود ده مش مستخدم.';

-- ---------------------------------------------------------------------------
-- 2) صلاحية إدارة الخزنة (global)
-- ---------------------------------------------------------------------------
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
    );
$$;
REVOKE ALL ON FUNCTION public.ledger_can_manage() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_can_manage() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) التيم/الوحدة اللي العضو تابع لها
--    الترتيب: قيمة مخصصة (custom_fields.unit) ← دور إداري/تيم ← التخصص ← العضوية
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_unit(p_member_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(pg_catalog.btrim(m.custom_fields ->> 'unit'), ''),
    (
      SELECT CASE a.role
               WHEN 'head' THEN 'هيد ' || t.name
               WHEN 'monitor' THEN 'مونيتور ' || t.name
               ELSE a.role
             END
      FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id
      JOIN public.member_auth_bindings AS b ON b.auth_user_id = a.user_id AND b.member_id = m.id
      ORDER BY a.created_at
      LIMIT 1
    ),
    (
      SELECT CASE aa.role
               WHEN 'owner' THEN 'المالك'
               WHEN 'admin' THEN 'أدمن'
               ELSE aa.role
             END
      FROM public.admin_accounts AS aa
      JOIN public.member_auth_bindings AS b ON b.auth_user_id = aa.user_id AND b.member_id = m.id
      LIMIT 1
    ),
    (
      SELECT t.name
      FROM public.teams AS t
      WHERE t.is_active
        AND t.slug = pg_catalog.lower(pg_catalog.btrim(COALESCE(m.specialization, '')))
      LIMIT 1
    ),
    (
      SELECT t.name
      FROM public.team_memberships AS tm
      JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
      WHERE tm.member_id = m.id
        AND COALESCE(tm.status, 'active') = 'active'
      ORDER BY t.name
      LIMIT 1
    ),
    'بدون تيم'
  )
  FROM public.members AS m
  WHERE m.id = p_member_id;
$$;
REVOKE ALL ON FUNCTION public.member_unit(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_unit(BIGINT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) تيمات العضو (عشان نعرف هيدز أنهي تيم يقدروا يستلموا منه)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_member_team_ids(p_member_id BIGINT)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT ids.id), ARRAY[]::UUID[])
  FROM (
    SELECT t.id
    FROM public.members AS m
    JOIN public.teams AS t
      ON t.is_active
     AND t.slug = pg_catalog.lower(pg_catalog.btrim(COALESCE(m.specialization, '')))
    WHERE m.id = p_member_id
    UNION
    SELECT tm.team_id
    FROM public.team_memberships AS tm
    JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
    WHERE tm.member_id = p_member_id
      AND COALESCE(tm.status, 'active') = 'active'
  ) AS ids;
$$;
REVOKE ALL ON FUNCTION public.ledger_member_team_ids(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_member_team_ids(BIGINT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) المستلمون: مالك/أدمن + هيدز/مونيتورز تيم العضو
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_receivers(p_member_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_ids UUID[];
BEGIN
  v_team_ids := CASE
    WHEN p_member_id IS NULL THEN NULL
    ELSE public.ledger_member_team_ids(p_member_id)
  END;

  RETURN (
    WITH admins AS (
      SELECT a.user_id,
             u.email,
             COALESCE(NULLIF(pg_catalog.btrim(m.full_name), ''), pg_catalog.split_part(COALESCE(u.email, ''), '@', 1)) AS display_name,
             CASE a.role WHEN 'owner' THEN 'المالك' ELSE 'أدمن' END AS label
      FROM public.admin_accounts AS a
      JOIN auth.users AS u ON u.id = a.user_id
      LEFT JOIN public.member_auth_bindings AS b ON b.auth_user_id = a.user_id
      LEFT JOIN public.members AS m ON m.id = b.member_id
      WHERE u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND a.role IN ('owner', 'admin')
    ),
    heads AS (
      SELECT a.user_id,
             u.email,
             COALESCE(NULLIF(pg_catalog.btrim(m.full_name), ''), pg_catalog.split_part(COALESCE(u.email, ''), '@', 1)) AS display_name,
             CASE a.role WHEN 'head' THEN 'هيد ' || t.name ELSE 'مونيتور ' || t.name END AS label
      FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
      JOIN auth.users AS u ON u.id = a.user_id
      LEFT JOIN public.member_auth_bindings AS b ON b.auth_user_id = a.user_id
      LEFT JOIN public.members AS m ON m.id = b.member_id
      WHERE u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND (v_team_ids IS NULL OR a.team_id = ANY (v_team_ids))
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', r.user_id,
          'email', r.email,
          'display_name', r.display_name,
          'label', r.label
        )
        ORDER BY r.label, r.display_name
      ),
      '[]'::JSONB
    )
    FROM (SELECT * FROM admins UNION SELECT * FROM heads) AS r
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_receivers(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_receivers(BIGINT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) الإدارة: ملخص الخزنة + الحركات + الالتزامات + حالة الأعضاء (اختياري بفلتر وحدة)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_overview(p_unit TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_unit TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_unit, '')), '');
  v_summary JSONB;
  v_entries JSONB;
  v_dues JSONB;
  v_members JSONB;
  v_units JSONB;
BEGIN
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: الخزنة متاحة للإدارة فقط.';
  END IF;

  SELECT jsonb_build_object(
           'collected', COALESCE(SUM(CASE WHEN l.kind = 'payment' AND l.status = 'approved' THEN l.amount END), 0),
           'expenses', COALESCE(SUM(CASE WHEN l.kind = 'expense' AND l.status = 'approved' THEN l.amount END), 0),
           'withdrawals', COALESCE(SUM(CASE WHEN l.kind = 'withdrawal' AND l.status = 'approved' THEN l.amount END), 0),
           'pending_count', COUNT(*) FILTER (WHERE l.kind = 'payment' AND l.status = 'pending'),
           'pending_amount', COALESCE(SUM(CASE WHEN l.kind = 'payment' AND l.status = 'pending' THEN l.amount END), 0),
           'expense_count', COUNT(*) FILTER (WHERE l.kind = 'expense' AND l.status = 'approved'),
           'payment_count', COUNT(*) FILTER (WHERE l.kind = 'payment' AND l.status = 'approved')
         )
    INTO v_summary
  FROM public.team_ledger_entries AS l;
  v_summary := v_summary || jsonb_build_object(
    'balance', (v_summary ->> 'collected')::NUMERIC
               - (v_summary ->> 'expenses')::NUMERIC
               - (v_summary ->> 'withdrawals')::NUMERIC,
    'expected', COALESCE((SELECT SUM(d.amount) FROM public.team_ledger_dues AS d), 0)
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
             'member_unit', CASE WHEN l.member_id IS NULL THEN NULL ELSE public.member_unit(l.member_id) END,
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
    WHERE v_unit IS NULL
       OR (l.member_id IS NOT NULL AND public.member_unit(l.member_id) = v_unit)
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT 800
  ) AS s;

  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'full_name', (entry ->> 'id')::BIGINT), '[]'::JSONB)
    INTO v_dues
  FROM (
    SELECT jsonb_build_object(
             'id', d.id,
             'member_id', d.member_id,
             'full_name', m.full_name,
             'unit', public.member_unit(d.member_id),
             'label', d.label,
             'amount', d.amount,
             'due_on', d.due_on,
             'created_at', d.created_at
           ) AS entry
    FROM public.team_ledger_dues AS d
    JOIN public.members AS m ON m.id = d.member_id
    WHERE v_unit IS NULL OR public.member_unit(d.member_id) = v_unit
    ORDER BY m.full_name, d.created_at
  ) AS s;

  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'late')::BOOLEAN DESC, entry ->> 'full_name'), '[]'::JSONB)
    INTO v_members
  FROM (
    SELECT jsonb_build_object(
             'member_id', r.member_id,
             'full_name', r.full_name,
             'academic_number', r.academic_number,
             'unit', r.unit,
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
             base.unit,
             COALESCE(dues.due_total, 0) AS due_total,
             COALESCE(paid.paid_total, 0) AS paid_total,
             dues.next_due_on,
             paid.last_payment_on
      FROM (
        SELECT m.id AS member_id, m.full_name, m.academic_number, public.member_unit(m.id) AS unit
        FROM public.members AS m
        WHERE m.id IN (
          SELECT d.member_id FROM public.team_ledger_dues AS d
          UNION
          SELECT l.member_id FROM public.team_ledger_entries AS l WHERE l.member_id IS NOT NULL
        )
      ) AS base
      LEFT JOIN LATERAL (
        SELECT SUM(d.amount) AS due_total, MIN(d.due_on) AS next_due_on
        FROM public.team_ledger_dues AS d
        WHERE d.member_id = base.member_id
      ) AS dues ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(l.amount) AS paid_total, MAX(l.occurred_on) AS last_payment_on
        FROM public.team_ledger_entries AS l
        WHERE l.member_id = base.member_id
          AND l.kind = 'payment'
          AND l.status = 'approved'
      ) AS paid ON TRUE
      WHERE v_unit IS NULL OR base.unit = v_unit
    ) AS r
  ) AS s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', u.unit, 'count', u.member_count) ORDER BY u.unit), '[]'::JSONB)
    INTO v_units
  FROM (
    SELECT public.member_unit(m.id) AS unit, COUNT(*) AS member_count
    FROM public.members AS m
    GROUP BY 1
  ) AS u;

  v_summary := v_summary || jsonb_build_object(
    'outstanding', COALESCE((
      SELECT SUM((entry ->> 'remaining')::NUMERIC) FROM jsonb_array_elements(v_members) AS entry
    ), 0),
    'late_count', COALESCE((
      SELECT COUNT(*) FROM jsonb_array_elements(v_members) AS entry
      WHERE (entry ->> 'late')::BOOLEAN
    ), 0),
    'member_count', jsonb_array_length(v_members)
  );

  RETURN jsonb_build_object(
    'can_manage', TRUE,
    'unit', v_unit,
    'units', v_units,
    'summary', v_summary,
    'receivers', public.ledger_receivers(NULL),
    'entries', v_entries,
    'dues', v_dues,
    'members', v_members
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_overview(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_overview(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) الإدارة: إضافة/تعديل حركة (دفعة مسجلة يدويًا / مصروف / خصم)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_save_entry(p_payload JSONB)
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
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على الخزنة.';
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
      SELECT 1 FROM jsonb_array_elements(public.ledger_receivers(v_member_id)) AS r
      WHERE (r ->> 'user_id')::UUID = v_receiver
    ) THEN
      RAISE EXCEPTION 'INVALID_RECEIVER: المستلم لازم يكون من الإدارة أو هيد/مونيتور تيم العضو.';
    END IF;
    IF v_due_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.team_ledger_dues AS d
      WHERE d.id = v_due_id AND d.member_id = v_member_id
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
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ENTRY_NOT_FOUND: الحركة غير موجودة.';
    END IF;
  ELSE
    INSERT INTO public.team_ledger_entries (
      team_id, kind, status, amount, title, category, note,
      member_id, receiver_user_id, due_id, occurred_on, created_by, decided_by, decided_at
    ) VALUES (
      NULL, v_kind, v_status, v_amount, v_title, v_category, v_note,
      v_member_id, v_receiver, v_due_id, v_occurred, auth.uid(),
      CASE WHEN v_status = 'approved' THEN auth.uid() END,
      CASE WHEN v_status = 'approved' THEN now() END
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_save_entry(JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_save_entry(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) الإدارة: الالتزامات
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9) الإدارة: حذف حركة / التزام (صلاحية global)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ledger_delete_entry(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على الخزنة.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_ledger_entries WHERE id = p_id) THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: الحركة غير موجودة.';
  END IF;
  DELETE FROM public.team_ledger_entries WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_delete_entry(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_delete_entry(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ledger_delete_due(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ledger_can_manage() THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: مفيش صلاحية على الخزنة.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_ledger_dues WHERE id = p_id) THEN
    RAISE EXCEPTION 'DUE_NOT_FOUND: الالتزام غير موجود.';
  END IF;
  DELETE FROM public.team_ledger_dues WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ledger_delete_due(BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_delete_due(BIGINT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10) الإدارة: مراجعة دفعة (الإدارة أو المستلم نفسه)
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
  IF NOT (public.ledger_can_manage() OR v_entry.receiver_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_REQUIRED: المراجعة متاحة للمستلم أو إدارة الخزنة بس.';
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
-- 11) العضو: أرقام الخزنة كاملة + مصروفاته ودفعاته — بدون مين دفع ومين مدفعش
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_ledger()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_summary JSONB;
  v_expenses JSONB;
  v_dues JSONB;
  v_payments JSONB;
  v_my_expected NUMERIC;
  v_my_paid NUMERIC;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: الخزنة متاحة لأعضاء الفريق بس.';
  END IF;

  SELECT jsonb_build_object(
           'collected', COALESCE(SUM(CASE WHEN l.kind = 'payment' AND l.status = 'approved' THEN l.amount END), 0),
           'expenses', COALESCE(SUM(CASE WHEN l.kind = 'expense' AND l.status = 'approved' THEN l.amount END), 0),
           'withdrawals', COALESCE(SUM(CASE WHEN l.kind = 'withdrawal' AND l.status = 'approved' THEN l.amount END), 0),
           'pending_count', COUNT(*) FILTER (WHERE l.kind = 'payment' AND l.status = 'pending'),
           'pending_amount', COALESCE(SUM(CASE WHEN l.kind = 'payment' AND l.status = 'pending' THEN l.amount END), 0),
           'expense_count', COUNT(*) FILTER (WHERE l.kind = 'expense' AND l.status = 'approved'),
           'payment_count', COUNT(*) FILTER (WHERE l.kind = 'payment' AND l.status = 'approved')
         )
    INTO v_summary
  FROM public.team_ledger_entries AS l;

  SELECT COALESCE(SUM(d.amount), 0) INTO v_my_expected
  FROM public.team_ledger_dues AS d
  WHERE d.member_id = v_member_id;

  SELECT COALESCE(SUM(l.amount), 0) INTO v_my_paid
  FROM public.team_ledger_entries AS l
  WHERE l.member_id = v_member_id
    AND l.kind = 'payment'
    AND l.status = 'approved';

  v_summary := v_summary || jsonb_build_object(
    'balance', (v_summary ->> 'collected')::NUMERIC
               - (v_summary ->> 'expenses')::NUMERIC
               - (v_summary ->> 'withdrawals')::NUMERIC,
    'expected', COALESCE((SELECT SUM(d.amount) FROM public.team_ledger_dues AS d), 0),
    'outstanding', COALESCE((
      SELECT SUM(GREATEST(x.due_total - x.paid_total, 0))
      FROM (
        SELECT base.member_id,
               COALESCE((SELECT SUM(d.amount) FROM public.team_ledger_dues AS d WHERE d.member_id = base.member_id), 0) AS due_total,
               COALESCE((SELECT SUM(l.amount) FROM public.team_ledger_entries AS l
                          WHERE l.member_id = base.member_id AND l.kind = 'payment' AND l.status = 'approved'), 0) AS paid_total
        FROM (SELECT DISTINCT d.member_id FROM public.team_ledger_dues AS d) AS base
      ) AS x
    ), 0),
    'member_count', (SELECT COUNT(*) FROM public.members),
    'my_paid', v_my_paid,
    'my_expected', v_my_expected,
    'my_remaining', GREATEST(v_my_expected - v_my_paid, 0),
    'my_pending', COALESCE((
      SELECT SUM(l.amount) FROM public.team_ledger_entries AS l
      WHERE l.member_id = v_member_id AND l.kind = 'payment' AND l.status = 'pending'
    ), 0)
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
    WHERE l.kind = 'expense'
      AND l.status = 'approved'
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT 300
  ) AS s;

  SELECT COALESCE(jsonb_agg(entry ORDER BY (entry ->> 'due_on') NULLS LAST, (entry ->> 'id')::BIGINT), '[]'::JSONB)
    INTO v_dues
  FROM (
    SELECT jsonb_build_object(
             'id', d.id,
             'label', d.label,
             'amount', d.amount,
             'due_on', d.due_on
           ) AS entry
    FROM public.team_ledger_dues AS d
    WHERE d.member_id = v_member_id
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
    WHERE l.member_id = v_member_id
      AND l.kind = 'payment'
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT 200
  ) AS s;

  RETURN jsonb_build_object(
    'unit', public.member_unit(v_member_id),
    'summary', v_summary,
    'expenses', v_expenses,
    'dues', v_dues,
    'payments', v_payments,
    'receivers', public.ledger_receivers(v_member_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_ledger() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_ledger() TO authenticated;

-- ---------------------------------------------------------------------------
-- 12) العضو: «أنا دفعت» (pending لحد ما المستلم/الإدارة يأكد)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_ledger_declare_payment(p_payload JSONB)
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
  v_label TEXT;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SCOPE_REQUIRED: الخزنة متاحة لأعضاء الفريق بس.';
  END IF;
  IF COALESCE(p_payload ->> 'amount', '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون رقم موجب.';
  END IF;
  v_amount := (p_payload ->> 'amount')::NUMERIC;
  IF v_amount <= 0 OR v_amount > 10000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: المبلغ لازم يكون بين 0 و 10,000,000.';
  END IF;
  IF COALESCE(p_payload ->> 'receiver_user_id', '') = '' THEN
    RAISE EXCEPTION 'INVALID_RECEIVER: اختار المستلم.';
  END IF;
  v_receiver := (p_payload ->> 'receiver_user_id')::UUID;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.ledger_receivers(v_member_id)) AS r
    WHERE (r ->> 'user_id')::UUID = v_receiver
  ) THEN
    RAISE EXCEPTION 'INVALID_RECEIVER: المستلم لازم يكون من الإدارة أو هيد/مونيتور تيمك.';
  END IF;
  IF COALESCE(p_payload ->> 'due_id', '') ~ '^[0-9]+$' THEN
    v_due_id := (p_payload ->> 'due_id')::BIGINT;
    IF NOT EXISTS (SELECT 1 FROM public.team_ledger_dues AS d WHERE d.id = v_due_id AND d.member_id = v_member_id) THEN
      RAISE EXCEPTION 'INVALID_DUE: الالتزام مش تابع لك.';
    END IF;
  END IF;
  v_occurred := COALESCE(NULLIF(p_payload ->> 'occurred_on', '')::DATE, CURRENT_DATE);
  INSERT INTO public.team_ledger_entries (
    team_id, kind, status, amount, note, member_id, receiver_user_id, due_id, occurred_on, created_by
  ) VALUES (
    NULL, 'payment', 'pending', v_amount, v_note, v_member_id, v_receiver, v_due_id, v_occurred, auth.uid()
  )
  RETURNING id INTO v_id;
  v_label := public.team_ledger_role_label(v_receiver);
  RETURN jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'amount', v_amount,
    'receiver_label', v_label
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_ledger_declare_payment(JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_ledger_declare_payment(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13) شيل النسخ القديمة اللي كانت مربوطة بتيم واحد
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_ledger_overview(UUID);
DROP FUNCTION IF EXISTS public.admin_ledger_save_entry(UUID, JSONB);
DROP FUNCTION IF EXISTS public.admin_ledger_save_due(UUID, JSONB);
DROP FUNCTION IF EXISTS public.member_ledger(UUID);
DROP FUNCTION IF EXISTS public.member_ledger_declare_payment(UUID, JSONB);
DROP FUNCTION IF EXISTS public.team_ledger_receivers(UUID);

COMMIT;
