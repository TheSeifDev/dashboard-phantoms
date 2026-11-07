-- ========================================================
-- 0006_remove_team_concept.sql
-- إزالة مفهوم الفرق نهائياً — النظام كله وصلة واحدة.
-- الواجهة الأمامية لم تعد تقرأ/تكتب هذه الأعمدة (v2 UX cleanup).
--
-- الترتيب مهم: حدّث الكائنات المعتمدة أولاً (RPC + GRANT)
-- ثم احذف الأعمدة. الملف آمن لإعادة التشغيل (IF EXISTS).
-- ========================================================

-- 1) دالة دخول العضو بدون عمود team -----------------------
CREATE OR REPLACE FUNCTION public.lookup_member_by_email(p_email text)
RETURNS TABLE (
    id BIGINT,
    created_at TIMESTAMPTZ,
    email TEXT,
    full_name TEXT,
    completion_rank INT,
    bio TEXT,
    device TEXT,
    meeting_attendance TEXT,
    work_status TEXT,
    can_go_alexandria BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT m.id, m.created_at, m.email, m.full_name,
           m.completion_rank, m.bio, m.device, m.meeting_attendance,
           m.work_status, m.can_go_alexandria
    FROM public.members m
    WHERE m.email = lower(btrim(p_email))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(text) TO anon, authenticated;

-- 2) تحديث قائمة أعمدة anon (إسقاط team من GRANT) -----------
REVOKE ALL ON public.members FROM anon;
GRANT SELECT (id, created_at, email, full_name, bio, device, meeting_attendance, work_status, completion_rank, can_go_alexandria)
    ON public.members TO anon;

-- 3) حذف عمود team من الأعضاء ------------------------------
DROP INDEX IF EXISTS public.idx_members_team;
ALTER TABLE public.members DROP COLUMN IF EXISTS team;

-- 4) حذف عمودي team/target_team من الملاحظات ----------------
-- ملاحظة: team_notes في members شيء مختلف (ملاحظات الإدارة
-- الخاصة بالعضو) وهو باقٍ ولم يُمس.
ALTER TABLE public.notes DROP COLUMN IF EXISTS team;
ALTER TABLE public.notes DROP COLUMN IF EXISTS target_team;
