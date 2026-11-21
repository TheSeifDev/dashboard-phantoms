-- Owner-only, non-destructive global Admin -> non-global demotion.
-- This removes only the target admin_accounts row; Auth/member/team/project state is untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_demote_account(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id UUID := auth.uid();
  v_target_role TEXT;
  v_deleted_count INTEGER;
  v_member_linked BOOLEAN;
BEGIN
  -- Lock and freshly verify the actor's current Owner row before reading the target.
  -- This avoids relying on a stale access result during an ownership transition.
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: إزالة الإدارة العامة متاحة للمالك فقط.';
  END IF;
  SELECT a.user_id
  INTO v_actor_user_id
  FROM public.admin_accounts AS a
  WHERE a.user_id = v_actor_user_id AND a.role = 'owner'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_ONLY: إزالة الإدارة العامة متاحة للمالك فقط.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.';
  END IF;
  IF p_user_id = v_actor_user_id THEN
    RAISE EXCEPTION 'SELF_DEMOTION_FORBIDDEN: المالك لا يمكنه إزالة إدارته بنفسه.';
  END IF;

  -- Re-read and lock the current target row so a concurrent role change cannot be
  -- mistaken for an Admin -> non-global transition.
  SELECT a.role
  INTO v_target_role
  FROM public.admin_accounts AS a
  WHERE a.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'OWNER_IMMUTABLE: مينفعش إزالة مالك النظام.';
  END IF;
  IF v_target_role <> 'admin' THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND: الحساب المستهدف مش مشرف عام.';
  END IF;

  DELETE FROM public.admin_accounts AS a
  WHERE a.user_id = p_user_id AND a.role = 'admin';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'ADMIN_DEMOTION_FAILED: لم تتم إزالة صف الإدارة العامة.';
  END IF;

  -- Only report an exact existing binding. Do not infer from email or create one.
  SELECT EXISTS (
    SELECT 1
    FROM public.member_auth_bindings AS b
    WHERE b.auth_user_id = p_user_id
  )
  INTO v_member_linked;

  RETURN jsonb_build_object(
    'target_uuid', p_user_id,
    'demoted', TRUE,
    'member_linked', v_member_linked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_demote_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_demote_account(UUID) TO authenticated;

COMMIT;
