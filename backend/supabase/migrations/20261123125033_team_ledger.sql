-- خزنة الفريق (Team Ledger): نظام مالي داخلي لمتابعة كل معاملات التيم.
--
-- التصميم:
--   team_ledger_dues    : الالتزام/المطلوب من كل عضو (مبلغ + تاريخ استحقاق اختياري).
--   team_ledger_entries : أي حركة مالية (دفعة / مصروف / خصم).
--   الرصيد المتاح = إجمالي المدفوعات المعتمدة − المصروفات − السحوبات.
--
-- الجدولين مقفولين تمامًا (RLS + revoke) والوصول كله عبر RPCs:
--   • الإدارة / الهيدز والمونيتورز: team_ledger_can_manage(team_id).
--   • العضو: web_current_member_id() — بيشوف ملخص تيمه ومصروفاته والتزاماته ودفعاته هو بس.
BEGIN;
CREATE TABLE public.team_ledger_dues (
  id BIGSERIAL PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  due_on DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_ledger_dues_unique
  ON public.team_ledger_dues (team_id, member_id, lower(btrim(label)));
CREATE INDEX team_ledger_dues_team_idx ON public.team_ledger_dues (team_id, member_id);
ALTER TABLE public.team_ledger_dues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_ledger_dues FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.team_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'expense', 'withdrawal')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  title TEXT CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 2 AND 160),
  category TEXT CHECK (
    category IS NULL
    OR category IN ('equipment', 'software', 'subscription', 'transport', 'food', 'printing', 'event', 'marketing', 'other')
  ),
  note TEXT,
  member_id BIGINT REFERENCES public.members(id) ON DELETE SET NULL,
  receiver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_id BIGINT REFERENCES public.team_ledger_dues(id) ON DELETE SET NULL,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_ledger_entries_shape CHECK (
    (kind = 'payment' AND member_id IS NOT NULL AND receiver_user_id IS NOT NULL AND title IS NULL)
    OR (kind = 'expense' AND member_id IS NULL AND receiver_user_id IS NULL AND title IS NOT NULL)
    OR (kind = 'withdrawal' AND member_id IS NOT NULL AND receiver_user_id IS NULL)
  ),
  CONSTRAINT team_ledger_entries_pending_shape CHECK (
    status <> 'pending' OR (kind = 'payment' AND decided_at IS NULL)
  ),
  CONSTRAINT team_ledger_entries_due_shape CHECK (
    due_id IS NULL OR kind = 'payment'
  )
);
CREATE INDEX team_ledger_entries_team_idx ON public.team_ledger_entries (team_id, occurred_on DESC, id DESC);
CREATE INDEX team_ledger_entries_member_idx ON public.team_ledger_entries (member_id, occurred_on DESC);
CREATE INDEX team_ledger_entries_pending_idx ON public.team_ledger_entries (team_id, status) WHERE status = 'pending';
ALTER TABLE public.team_ledger_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_ledger_entries FROM PUBLIC, anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- مساعدات: صلاحية الإدارة على الخزنة + وصف دور المستلم
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_ledger_can_manage(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_team_id IS NULL OR auth.uid() IS NULL THEN FALSE
    WHEN public.has_admin_permission('members') THEN EXISTS (
      SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id AND t.is_active
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
      JOIN auth.users AS u ON u.id = a.user_id
      WHERE a.team_id = p_team_id
        AND a.user_id = auth.uid()
        AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.team_ledger_can_manage(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_ledger_can_manage(UUID) TO authenticated;
CREATE OR REPLACE FUNCTION public.team_ledger_role_label(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    ELSE COALESCE(
      (SELECT CASE aa.role
                WHEN 'owner' THEN 'المالك'
                WHEN 'admin' THEN 'أدمن'
                ELSE aa.role
              END
       FROM public.admin_accounts AS aa
       WHERE aa.user_id = p_user_id),
      (SELECT CASE a.role
                WHEN 'head' THEN 'هيد تيم'
                WHEN 'monitor' THEN 'مونيتور'
                ELSE a.role
              END
       FROM public.team_admin_assignments AS a
       WHERE a.user_id = p_user_id
       ORDER BY a.created_at
       LIMIT 1),
      'عضو'
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.team_ledger_role_label(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_ledger_role_label(UUID) TO authenticated;
-- ---------------------------------------------------------------------------
-- المستلمين المتاحين: المالك + الأدمن + هيدز ومونيتورز التيم
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_ledger_receivers(p_team_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry ->> 'label', entry ->> 'display_name'), '[]'::JSONB)
  FROM (
    SELECT DISTINCT ON (u.id) jsonb_build_object(
             'user_id', u.id,
             'email', u.email,
             'display_name', COALESCE(NULLIF(btrim(m.full_name), ''), split_part(u.email, '@', 1)),
             'label', public.team_ledger_role_label(u.id)
           ) AS entry
    FROM auth.users AS u
    LEFT JOIN public.member_auth_bindings AS b ON b.auth_user_id = u.id
    LEFT JOIN public.members AS m ON m.id = b.member_id
    WHERE u.email IS NOT NULL
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND (
        EXISTS (
          SELECT 1 FROM public.admin_accounts AS aa
          WHERE aa.user_id = u.id
            AND (
              aa.role = 'owner'
              OR (aa.role = 'admin' AND COALESCE((aa.permissions ->> 'members')::BOOLEAN, FALSE))
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.team_admin_assignments AS ta
          WHERE ta.user_id = u.id AND ta.team_id = p_team_id
        )
      )
    ORDER BY u.id
  ) AS s;
$$;
REVOKE ALL ON FUNCTION public.team_ledger_receivers(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_ledger_receivers(UUID) TO authenticated;
COMMIT;
