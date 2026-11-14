-- ========================================================
-- 0011_rogue_policy_cleanup.sql
-- إسقاط سياستين دخيلتين وُجدتا في الإنتاج (2026-10-08):
-- members_auth / notes_auth كانتا USING(true) WITH CHECK(true)
-- لدور authenticated — أي حساب مسجّل (ولو غير إداري) يملك
-- وصولاً كاملاً للأعضاء والملاحظات متجاوزاً is_admin().
-- الوصول الإداري الشرعي يمر عبر سياسات "Admins full access".
-- الملف idempotent.
-- ========================================================

DROP POLICY IF EXISTS "members_auth" ON public.members;
DROP POLICY IF EXISTS "notes_auth" ON public.notes;
