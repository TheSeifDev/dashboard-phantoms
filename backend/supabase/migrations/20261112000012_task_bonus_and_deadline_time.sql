-- ==========================================================
-- 0012 — بونص لكل مهمة + موعد نهائي بالساعة
-- ----------------------------------------------------------
-- 1) tasks.bonus_points: بونص يُمنح لكل عضو عند اعتماد تسليمه (0-50).
-- 2) tasks.deadline_date (TEXT أصلاً) يقبل الآن صيغتين:
--      "YYYY-MM-DD"                 = نهاية اليوم بالتوقيت المحلي (البيانات القديمة)
--      "YYYY-MM-DDTHH:MM:SS+03:00"  = موعد بالساعة والإزاحة (الجديد)
--    لا تغيير في نوع العمود — الواجهة القديمة والجديدة تقرآن الصيغتين.
-- 3) approve_task_submission:
--      - يمنح max(p_bonus, tasks.bonus_points) ويسجله كملاحظة "[B:+n]"
--        فيدخل مباشرة في الترتيب وإجمالي البونص.
--      - يرفض اعتماد نفس التسليم مرتين (لا نقاط مكررة).
--      - يعيد bonus_awarded و total_bonus للعرض الفوري.
-- التوقيع (BIGINT, BIGINT, INT DEFAULT 0) لم يتغير — متوافق مع العميل الحالي.
-- ==========================================================
BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS bonus_points INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_bonus_points_range' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_bonus_points_range CHECK (bonus_points BETWEEN 0 AND 50);
  END IF;
END $$;

COMMENT ON COLUMN public.tasks.bonus_points IS
  'بونص يُمنح لكل عضو عند اعتماد تسليمه (0-50). يُسجَّل كملاحظة [B:+n] فيدخل الترتيب.';
COMMENT ON COLUMN public.tasks.deadline_date IS
  'YYYY-MM-DD = نهاية اليوم بالتوقيت المحلي، أو ISO 8601 بالساعة والإزاحة (مثال 2026-10-29T18:00:00+03:00).';

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
    v_is_admin BOOLEAN := false;
    v_title TEXT;
    v_task_bonus INT := 0;
    v_bonus INT := 0;
    v_member_name TEXT;
    v_total INT := 0;
BEGIN
    IF current_setting('role', true) = 'anon' THEN
        RAISE EXCEPTION 'ADMIN_APPROVAL_FORBIDDEN: الاعتماد حق إداري حصرياً.';
    END IF;
    BEGIN
      SELECT public.is_admin() INTO v_is_admin;
    EXCEPTION WHEN undefined_function OR undefined_table THEN
      v_is_admin := true;
    END;
    IF NOT coalesce(v_is_admin, false) THEN
        RAISE EXCEPTION 'ADMIN_ONLY: الاعتماد متاح للحسابات الإدارية فقط.';
    END IF;
    IF p_task_id IS NULL OR p_task_id <= 0 OR p_member_id IS NULL OR p_member_id <= 0 THEN
        RAISE EXCEPTION 'INVALID_ID: معرّفات المهمة أو العضو غير صالحة.';
    END IF;
    IF p_bonus IS NULL THEN
        p_bonus := 0;
    END IF;
    IF p_bonus < 0 OR p_bonus > 50 THEN
        RAISE EXCEPTION 'INVALID_BONUS: قيمة المكافأة خارج الحد المسموح (0-50).';
    END IF;

    SELECT tracking, title, COALESCE(bonus_points, 0)
      INTO v_tracking, v_title, v_task_bonus
      FROM public.tasks
     WHERE id = p_task_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TASK_NOT_FOUND: المهمة غير موجودة.';
    END IF;
    v_tracking := coalesce(v_tracking, '{}'::jsonb);

    v_entry := v_tracking -> p_member_id::text;
    IF v_entry IS NULL THEN
        RAISE EXCEPTION 'NOT_ASSIGNED: العضو غير مكلف بهذه المهمة.';
    END IF;
    IF v_entry ->> 'status' = 'approved' THEN
        RAISE EXCEPTION 'ALREADY_APPROVED: هذا التسليم معتمد بالفعل — لم تُمنح نقاط مرة ثانية.';
    END IF;

    -- بونص المهمة المُعلن حد أدنى؛ يجوز للإدارة منح أكثر منه لا أقل
    v_bonus := GREATEST(p_bonus, v_task_bonus);

    UPDATE public.members
       SET completion_rank = LEAST(100, COALESCE(completion_rank, 0) + 5 + v_bonus)
     WHERE id = p_member_id
    RETURNING completion_rank, full_name INTO v_new_rank, v_member_name;

    IF v_new_rank IS NULL THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
    END IF;

    -- البونص يُسجَّل كملاحظة بنفس صيغة الترتيب [B:+n] — نفس المعاملة، لا بونص بلا اعتماد
    IF v_bonus > 0 THEN
        INSERT INTO public.notes (text, author, author_role, date, target_member_id, target_name)
        VALUES (
            format('[B:+%s] مكافأة إنجاز مهمة: %s', v_bonus, v_title),
            'اعتماد المهام',
            'admin',
            to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD'),
            p_member_id,
            v_member_name
        );
    END IF;

    v_entry := v_entry
        || jsonb_build_object('status', 'approved', 'updated_at', now(), 'bonus_awarded', v_bonus);
    v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::text], v_entry, true);

    UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;

    SELECT COALESCE(SUM((substring(n.text FROM '\[B:([+-]?\d+)\]'))::INT), 0)
      INTO v_total
      FROM public.notes n
     WHERE n.target_member_id = p_member_id
       AND n.text ~ '\[B:[+-]?\d+\]';

    RETURN jsonb_build_object(
        'task_id', p_task_id,
        'member_id', p_member_id,
        'status', 'approved',
        'completion_rank', v_new_rank,
        'bonus_awarded', v_bonus,
        'total_bonus', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) TO authenticated;

COMMIT;
