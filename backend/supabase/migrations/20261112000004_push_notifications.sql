-- ========================================================
-- Migration 0004: Push Notifications & PWA Support
-- ========================================================

-- إضافة عمود حفظ اشتراك إشعارات المتصفح للعضو
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS push_subscription JSONB DEFAULT NULL;

-- دالة RPC لحفظ اشتراك العضو بأمان (يستدعيها العضو من جهازه)
-- نتحقق من أن العضو موجود باستخدام بريده الإلكتروني للحماية.
CREATE OR REPLACE FUNCTION public.save_push_subscription(
    p_member_id BIGINT,
    p_email TEXT,
    p_subscription JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual_email TEXT;
BEGIN
    SELECT lower(btrim(email)) INTO v_actual_email FROM public.members WHERE id = p_member_id;
    IF v_actual_email IS NULL OR v_actual_email <> lower(btrim(p_email)) THEN
        RAISE EXCEPTION 'UNAUTHORIZED: بيانات المطابقة غير صحيحة.';
    END IF;

    UPDATE public.members
    SET push_subscription = p_subscription
    WHERE id = p_member_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(BIGINT, TEXT, JSONB) TO anon, authenticated;
