-- ========================================================
-- Migration 0003 — إغلاق تسريب بيانات الأعضاء + اعتماد ذرّي
--
-- المشكلتان:
--  1) سياسة "Anon members login lookup" تسمح بـ SELECT USING (true)
--     لكل الصفوف على members — أي حد عنده anon key يسحب قائمة
--     كل الأعضاء بأسمائهم وإيميلاتهم وفرقهم. الحل: منع SELECT
--     المباشر تماماً على anon، واستبداله بدالة SECURITY DEFINER
--     تُرجع صفاً واحداً بعد مطابقة بريد دقيق.
--  2) الاعتماد (approved + منح نقاط) كان عمليتين منفصلتين في
--     الـ Frontend (tasks ثم members) — فشل الثانية يترك العضو
--     بدون نقاط رغم اعتماد مهمته. الحل: RPC واحدة ذرّية.
--
-- ملاحظة مزامنة: هذه النسخة مطابقة للمنفَّذ فعلياً على الإنتاج عبر
-- Supabase MCP (secure_member_lookup_and_atomic_approval + harden_approval_member_guard)
-- مع خطوة محاذاة سكيما idempotent للقواعد القديمة.
-- ========================================================

-- ----------------------------------------------------------
-- 0) محاذاة السكيما مع كود v2 (idempotent)
-- ----------------------------------------------------------
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS meeting_attendance TEXT;

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
);
INSERT INTO public.whatsapp_settings (id, enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_settings TO service_role;

-- ----------------------------------------------------------
-- 1) دالة تسجيل دخول العضو — بدل SELECT المباشر
--    تُرجع الأعمدة العامة فقط، لصف واحد، بمطابقة بريد تامة.
--    REVOKE من PUBLIC ثم GRANT لـ anon + authenticated.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_member_by_email(p_email text)
RETURNS TABLE (
    id BIGINT,
    created_at TIMESTAMPTZ,
    email TEXT,
    full_name TEXT,
    team TEXT,
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
    SELECT m.id, m.created_at, m.email, m.full_name, m.team,
           m.completion_rank, m.bio, m.device, m.meeting_attendance,
           m.work_status, m.can_go_alexandria
    FROM public.members m
    WHERE m.email = lower(btrim(p_email))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(text) TO anon, authenticated;

-- ----------------------------------------------------------
-- 2) إغلاق SELECT المباشر على members عن anon
--    (بوابة الأعضاء ستستخدم الدالة أعلاه فقط)
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "Anon members login lookup" ON public.members;
DROP POLICY IF EXISTS "Anon read members by email" ON public.members;

REVOKE ALL ON public.members FROM anon;
-- ملاحظة: authenticated يحتفظ بـ SELECT الكامل عبر سياسة الإدارة.

-- ----------------------------------------------------------
-- 2.5) سياسات بوابة الأعضاء (tasks/notes) + إصلاح سياسة الإدارة
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "Full access to tasks for authenticated users" ON public.tasks;
DROP POLICY IF EXISTS "Admins full access to tasks" ON public.tasks;
CREATE POLICY "Admins full access to tasks"
ON public.tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon read tasks" ON public.tasks;
CREATE POLICY "Anon read tasks"
ON public.tasks FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon update task tracking" ON public.tasks;
DROP POLICY IF EXISTS "Anon update own task tracking" ON public.tasks;
CREATE POLICY "Anon update own task tracking"
ON public.tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon read notes" ON public.notes;
CREATE POLICY "Anon read notes"
ON public.notes FOR SELECT TO anon USING (true);

-- ----------------------------------------------------------
-- 2.6) صلاحيات الأعمدة (الحزام الثاني بعد RLS)
-- ----------------------------------------------------------
REVOKE ALL ON public.tasks, public.notes FROM anon;
GRANT SELECT ON public.tasks TO anon;
GRANT UPDATE (tracking) ON public.tasks TO anon;
GRANT SELECT ON public.notes TO anon;

-- ----------------------------------------------------------
-- 2.7) Trigger: منع الاعتماد الذاتي للعضو على مستوى القاعدة
-- ----------------------------------------------------------
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

-- ----------------------------------------------------------
-- 3) اعتماد ذرّي: تحديث tracking + منح نقاط في معاملة واحدة
--    service: الاعتماد بلا نقاط إضافية.
--    منع anon من استدعائها (الاعتماد حق إداري فقط).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_task_submission(
    p_task_id BIGINT,
    p_member_id BIGINT,
    p_bonus INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_tracking JSONB;
    v_entry JSONB;
    v_new_rank INT;
BEGIN
    -- الاعتماد حق إداري: anon ممنوع نهائياً
    IF current_setting('role', true) = 'anon' THEN
        RAISE EXCEPTION 'ADMIN_APPROVAL_FORBIDDEN: الاعتماد حق إداري حصرياً.';
    END IF;

    SELECT tracking INTO v_tracking FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF v_tracking IS NULL THEN
        RAISE EXCEPTION 'TASK_NOT_FOUND: المهمة غير موجودة.';
    END IF;

    v_entry := v_tracking -> p_member_id::text;
    IF v_entry IS NULL THEN
        RAISE EXCEPTION 'NOT_ASSIGNED: العضو غير مكلف بهذه المهمة.';
    END IF;

    -- العضو لازم يكون موجود فعلاً — بدل نجاح كاذب بـ completion_rank = NULL
    UPDATE public.members
    SET completion_rank = LEAST(100, COALESCE(completion_rank, 0) + 5 + GREATEST(0, p_bonus))
    WHERE id = p_member_id
    RETURNING completion_rank INTO v_new_rank;

    IF v_new_rank IS NULL THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
    END IF;

    -- الآن — وبعد ضمان صلاحية كل الطرفين — نحدث التتبع (نفس المعاملة)
    v_entry := coalesce(v_entry, '{}'::jsonb)
        || jsonb_build_object('status', 'approved', 'updated_at', now());
    v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::text], v_entry);

    UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;

    RETURN jsonb_build_object(
        'task_id', p_task_id,
        'member_id', p_member_id,
        'status', 'approved',
        'completion_rank', v_new_rank
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) TO authenticated;
