-- ========================================================
-- 0008_admin_email_rls.sql
-- تأمين صلاحيات الإدارة على مستوى قاعدة البيانات
--
-- الجذر: سياسات RLS الحالية تمنح "authenticated" (أي مستخدم مسجّل)
-- وصولاً كاملاً للجداول الإدارية (members/tasks/notes/announcements).
-- هذا يسمح لأي حساب authenticated (حتى لو ليس مسؤولاً فعلياً)
-- بتجاوز حماية الواجهة.
--
-- الحل: إنشاء قائمة admin_emails داخل قاعدة البيانات + دالة is_admin()
-- ثم إعادة تعريف سياسات الإدارة لتسمح فقط لحسابات البريد المسموح.
-- ========================================================

-- 1) جدول السماح
CREATE TABLE IF NOT EXISTS public.admin_emails (
  email TEXT PRIMARY KEY
);

-- 2) بذار آمن (توافق مع قيم افتراضية موجودة في المشروع)
INSERT INTO public.admin_emails (email) VALUES
  ('admin@wasla.com'),
  ('admin@wasla.local'),
  ('admin@example.com')
ON CONFLICT (email) DO NOTHING;

-- 3) دالة فحص
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_emails a
    WHERE lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- نسمح لـ authenticated باستدعاء is_admin()
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 4) إعادة تعريف سياسات الإدارة على الجداول الرئيسية
DROP POLICY IF EXISTS "Admins full access to members" ON public.members;
CREATE POLICY "Admins full access to members"
ON public.members FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins full access to tasks" ON public.tasks;
CREATE POLICY "Admins full access to tasks"
ON public.tasks FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins full access to notes" ON public.notes;
CREATE POLICY "Admins full access to notes"
ON public.notes FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- announcements سياسة الإدارة اسمها في migration 0005
DROP POLICY IF EXISTS "Admins full access to announcements" ON public.announcements;
CREATE POLICY "Admins full access to announcements"
ON public.announcements FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
