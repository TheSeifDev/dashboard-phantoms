-- ========================================================
-- PATCH: تحصين أمني عاجل (P0) لقاعدة بيانات موجودة بالفعل
-- ملف: 0001_security_hardening.sql
--
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor إن كان
-- المشروع قد رُكّب بالنسخة القديمة من supabase_setup.sql.
-- الملف متسامح مع الإعادة (idempotent) — تشغيله مرتين لا يفسد شيئاً.
--
-- ماذا يصلح؟
--   1) يسدّ سياسات anon المفتوحة (كانت تسمح لأي زائر بتعديل/حذف المهام
--      وقراءة بيانات الأعضاء الشخصية كاملة).
--   2) يقيد anon على مستوى الأعمدة: قراءة أعمدة عامة فقط من members،
--      وتحديث عمود tracking فقط في tasks.
--   3) يمنع العضو من اعتماد مهمته بنفسه (Trigger) — الاعتماد إداري.
--   4) يغلق باب تسريب مفتاح Groq من الـ Vault: دواله لم تعد متاحة
--      لأي مستخدم عبر PostgREST — service_role فقط (الـ Edge Function).
-- ========================================================

-- 0) إسقاط السياسات القديمة الخطرة (بأسمائها في النسخة السابقة) ----

DROP POLICY IF EXISTS "Full access to members for authenticated users" ON public.members;
DROP POLICY IF EXISTS "Full access to notes for authenticated users"   ON public.notes;
DROP POLICY IF EXISTS "Full access to tasks for authenticated users"    ON public.tasks;
DROP POLICY IF EXISTS "Anon read members by email" ON public.members;
DROP POLICY IF EXISTS "Anon update task tracking"   ON public.tasks;
DROP POLICY IF EXISTS "Anon read notes"            ON public.notes;

-- 1) السياسات الجديدة ------------------------------------------

-- الإدارة: صلاحيات كاملة
CREATE POLICY "Admins full access to members"
ON public.members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins full access to notes"
ON public.notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins full access to tasks"
ON public.tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- بوابة الأعضاء: قراءة فقط + تحديث tracking فقط
CREATE POLICY "Anon members login lookup"
ON public.members FOR SELECT TO anon USING (true);

CREATE POLICY "Anon read tasks"
ON public.tasks FOR SELECT TO anon USING (true);

CREATE POLICY "Anon update own task tracking"
ON public.tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon read notes"
ON public.notes FOR SELECT TO anon USING (true);

-- 2) تقييد الأعمدة (الحزام الثاني بعد RLS) --------------------

REVOKE ALL ON public.members, public.tasks, public.notes FROM anon;

GRANT SELECT (id, created_at, email, full_name, team, bio, device, meeting_attendance, work_status, completion_rank, can_go_alexandria)
    ON public.members TO anon;

GRANT SELECT ON public.tasks TO anon;
GRANT UPDATE (tracking) ON public.tasks TO anon;
GRANT SELECT ON public.notes TO anon;

-- 3) منع الاعتماد الذاتي (Trigger) ------------------------------

CREATE OR REPLACE FUNCTION public.guard_anon_tracking_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_key text;
    v_val jsonb;
BEGIN
    IF current_setting('role', true) = 'anon' THEN
        FOR v_key, v_val IN
            SELECT key, value FROM jsonb_each(coalesce(NEW.tracking, '{}'::jsonb))
        LOOP
            IF v_val->>'status' = 'approved'
               AND coalesce(OLD.tracking, '{}'::jsonb) -> v_key ->> 'status'
                   IS DISTINCT FROM 'approved'
            THEN
                RAISE EXCEPTION
                    'ADMIN_APPROVAL_FORBIDDEN: لا يمكن للأعضاء اعتماد مهامهم بأنفسهم — الاعتماد حق إداري فقط.';
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_guard_anon ON public.tasks;
CREATE TRIGGER trg_tasks_guard_anon
BEFORE UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.guard_anon_tracking_update();

-- 4) إغلاق دوال الـ Vault على service_role ---------------------
-- (الصياغة القديمة كانت SECURITY DEFINER بلا REVOKE = أي زائر يستطيع
--  استدعاء /rpc/get_groq_key_from_vault ويستلم المفتاح خاماً،
--  وset_groq_key كانت أيضاً SQL مكسورة أصلاً — تُستبدل بصيغة Vault سليمة.)

CREATE OR REPLACE FUNCTION public.set_groq_key(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM vault.decrypted_secrets WHERE name = 'groq_api_key';
    IF v_id IS NOT NULL THEN
        PERFORM vault.delete_secret(v_id);
    END IF;
    PERFORM vault.create_secret(p_key, 'groq_api_key');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_groq_key_from_vault()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_secret text;
BEGIN
    SELECT secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'groq_api_key';
    RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.set_groq_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_groq_key_from_vault() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_groq_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_groq_key_from_vault() TO service_role;

-- 5) اكتمل الترقيع — للنشر:
--    a) اعادة نشر الـ Edge Function بعد تعديلها (تقرأ المفتاح بهوية service_role).
--    b) لا تحتاج لإعادة إدخال المفتاح إن كان Vault يحويه سابقاً بنفس الاسم ('groq_api_key').
--    c) للتأكد: SELECT public.get_groq_key_from_vault(); من SQL Editor يجب أن تعيد المفتاح.
