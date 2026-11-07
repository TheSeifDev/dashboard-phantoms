-- 0014 — صلاحيات المالك وإدارة حسابات الإدارة
-- حساب AHMEDROMU4 هو المالك الثابت، والمشرفون الآخرون لهم صلاحيات التطبيق كاملة.
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_single_owner
  ON public.admin_accounts (role)
  WHERE role = 'owner';

ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_accounts FROM PUBLIC, anon, authenticated;

-- نقل الحسابات القائمة التي لها مستخدم Auth فعلي فقط.
INSERT INTO public.admin_accounts (user_id, role)
SELECT u.id, 'admin'
FROM public.admin_emails AS old
JOIN auth.users AS u ON lower(u.email) = lower(trim(old.email))
WHERE u.id <> '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid
ON CONFLICT (user_id) DO NOTHING;

-- تثبيت مالك النظام بمعرّف Auth، لا بالبريد الذي يمكن تغييره.
INSERT INTO public.admin_accounts (user_id, role, created_by)
VALUES ('8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid, 'owner', NULL)
ON CONFLICT (user_id) DO UPDATE
SET role = 'owner', created_by = NULL;

-- is_admin هي بوابة كل سياسات RLS الحالية؛ تعتمد الآن على UUID موثوق.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(auth.uid() = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid, false)
      OR EXISTS (
        SELECT 1
        FROM public.admin_accounts AS a
        WHERE a.user_id = auth.uid()
          AND a.role IN ('owner', 'admin')
      );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_access()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_role TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'is_owner', false, 'role', NULL, 'email', NULL);
  END IF;

  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;
  IF v_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    v_role := 'owner';
  ELSE
    SELECT a.role INTO v_role FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'is_admin', coalesce(v_role IN ('owner', 'admin'), false),
    'is_owner', coalesce(v_role = 'owner', false),
    'role', v_role,
    'email', v_email
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_accounts()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  created_at TIMESTAMPTZ,
  created_by UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: إدارة الحسابات متاحة للمالك فقط.';
  END IF;

  RETURN QUERY
  SELECT a.user_id, u.email::text, a.role, a.created_at, a.created_by
  FROM public.admin_accounts AS a
  JOIN auth.users AS u ON u.id = a.user_id
  ORDER BY CASE WHEN a.role = 'owner' THEN 0 ELSE 1 END, lower(u.email);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_account(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_user_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: إضافة المشرفين متاحة للمالك فقط.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: اكتب بريد إلكتروني صحيح.';
  END IF;

  SELECT u.id INTO v_user_id FROM auth.users AS u WHERE lower(u.email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_USER_NOT_FOUND: لازم الحساب يسجل في النظام أولاً قبل إضافته كمشرف.';
  END IF;
  IF v_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid
     OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user_id) THEN
    RAISE EXCEPTION 'ALREADY_ADMIN: الحساب مضاف للإدارة بالفعل.';
  END IF;

  INSERT INTO public.admin_accounts (user_id, role, created_by)
  VALUES (v_user_id, 'admin', auth.uid())
  RETURNING created_at INTO v_created_at;

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'role', 'admin',
    'created_at', v_created_at,
    'created_by', auth.uid()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_account(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_remove_account(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted UUID;
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: حذف المشرفين متاح للمالك فقط.';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_IMMUTABLE: مينفعش حذف مالك النظام.';
  END IF;

  DELETE FROM public.admin_accounts AS a
  WHERE a.user_id = p_user_id AND a.role = 'admin'
  RETURNING a.user_id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_remove_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_account(UUID) TO authenticated;

-- الجدول القديم لم يعد مصدراً للصلاحية؛ أغلق قراءته المباشرة بالكامل.
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_emails FROM PUBLIC, anon, authenticated;

COMMIT;
