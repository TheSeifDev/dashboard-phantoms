-- 0018 — إلغاء اعتماد المهمة بأمان، وإصلاح صلاحية تسجيل التقييمات.
BEGIN;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS source_task_id BIGINT REFERENCES public.tasks (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_member_id BIGINT REFERENCES public.members (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notes_task_approval_source_idx
  ON public.notes (source_task_id, source_member_id)
  WHERE source_task_id IS NOT NULL;

-- الرصيد في completion_rank مصدره اعتماد المهام. أعد بناء فرق النقاط لكل اعتماد
-- قديم حتى يمكن عكسه لاحقاً بدقة حتى لو كان العضو وصل سقف 100 نقطة.
WITH approvals AS (
  SELECT
    t.id AS task_id,
    CASE WHEN entry.key ~ '^[0-9]{1,18}$' THEN (entry.key)::BIGINT END AS member_id,
    entry.value AS tracking_entry,
    COALESCE(NULLIF(entry.value ->> 'bonus_awarded', '')::INT, 0) AS bonus_awarded,
    COALESCE(NULLIF(entry.value ->> 'updated_at', '')::TIMESTAMPTZ, t.created_at, 'epoch'::TIMESTAMPTZ) AS approved_at
  FROM public.tasks AS t
  CROSS JOIN LATERAL jsonb_each(COALESCE(t.tracking, '{}'::jsonb)) AS entry
  WHERE entry.value ->> 'status' = 'approved'
    AND entry.key ~ '^[0-9]{1,18}$'
), scored AS (
  SELECT *,
    SUM(5 + GREATEST(0, bonus_awarded)) OVER (
      PARTITION BY member_id ORDER BY approved_at, task_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS points_total
  FROM approvals
)
UPDATE public.tasks AS t
SET tracking = jsonb_set(
  COALESCE(t.tracking, '{}'::jsonb),
  ARRAY[scored.member_id::TEXT],
  scored.tracking_entry || jsonb_build_object(
    'bonus_awarded', scored.bonus_awarded,
    'rank_awarded', LEAST(100, scored.points_total) - LEAST(100, scored.points_total - 5 - GREATEST(0, scored.bonus_awarded))
  ),
  true
)
FROM scored
WHERE t.id = scored.task_id;

CREATE OR REPLACE FUNCTION public.approve_task_submission(
  p_task_id BIGINT,
  p_member_id BIGINT,
  p_bonus INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tracking JSONB;
  v_entry JSONB;
  v_old_rank INT;
  v_new_rank INT;
  v_rank_awarded INT;
  v_task_bonus INT := 0;
  v_bonus INT := 0;
  v_title TEXT;
  v_member_name TEXT;
  v_note_id BIGINT;
  v_total BIGINT := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('tasks') THEN
    RAISE EXCEPTION 'TASKS_PERMISSION_REQUIRED: يلزم امتلاك صلاحية المهام لاعتماد التسليم.';
  END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 OR p_member_id IS NULL OR p_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_ID: معرّفات المهمة أو العضو غير صالحة.';
  END IF;
  IF p_bonus IS NULL OR p_bonus < 0 OR p_bonus > 50 THEN
    RAISE EXCEPTION 'INVALID_BONUS: قيمة المكافأة خارج الحد المسموح (0-50).';
  END IF;

  SELECT t.tracking, t.title, COALESCE(t.bonus_points, 0)
    INTO v_tracking, v_title, v_task_bonus
  FROM public.tasks AS t
  WHERE t.id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND: المهمة غير موجودة.';
  END IF;

  v_tracking := COALESCE(v_tracking, '{}'::jsonb);
  v_entry := v_tracking -> p_member_id::text;
  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'NOT_ASSIGNED: العضو غير مكلف بهذه المهمة.';
  END IF;
  IF v_entry ->> 'status' = 'approved' THEN
    RAISE EXCEPTION 'ALREADY_APPROVED: هذا التسليم معتمد بالفعل.';
  END IF;

  v_bonus := GREATEST(p_bonus, v_task_bonus);
  SELECT COALESCE(m.completion_rank, 0), m.full_name
    INTO v_old_rank, v_member_name
  FROM public.members AS m
  WHERE m.id = p_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
  END IF;

  v_new_rank := LEAST(100, v_old_rank + 5 + v_bonus);
  v_rank_awarded := v_new_rank - v_old_rank;
  UPDATE public.members SET completion_rank = v_new_rank WHERE id = p_member_id;

  IF v_bonus > 0 THEN
    INSERT INTO public.notes (text, author, author_role, date, target_member_id, target_name, source_task_id, source_member_id)
    VALUES (
      format('[B:+%s] مكافأة إنجاز مهمة: %s', v_bonus, pg_catalog.regexp_replace(v_title, '\[B:[+-]?[0-9]{1,9}\]', '', 'gi')),
      'اعتماد المهام', 'admin', to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD'),
      p_member_id, v_member_name, p_task_id, p_member_id
    )
    RETURNING id INTO v_note_id;
  END IF;

  v_entry := v_entry || jsonb_build_object(
    'status', 'approved',
    'updated_at', now(),
    'bonus_awarded', v_bonus,
    'rank_awarded', v_rank_awarded,
    'bonus_note_id', v_note_id,
    'approval_reversal_reason', NULL,
    'approval_reversed_at', NULL,
    'approval_reversed_by', NULL
  );
  v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::text], v_entry, true);
  UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;

  SELECT COALESCE(SUM(((pg_catalog.regexp_match(n.text, '\[B:([+-]?[0-9]{1,9})\]'))[1])::BIGINT), 0)
    INTO v_total
  FROM public.notes AS n
  WHERE n.target_member_id = p_member_id;

  RETURN jsonb_build_object(
    'task_id', p_task_id, 'member_id', p_member_id, 'status', 'approved',
    'completion_rank', v_new_rank, 'bonus_awarded', v_bonus,
    'rank_awarded', v_rank_awarded, 'bonus_note_id', v_note_id, 'total_bonus', v_total
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_task_approval(
  p_task_id BIGINT,
  p_member_id BIGINT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tracking JSONB;
  v_entry JSONB;
  v_task_title TEXT;
  v_member_name TEXT;
  v_bonus INT;
  v_rank_awarded INT;
  v_old_note_id BIGINT;
  v_legacy_note_id BIGINT;
  v_new_rank INT;
  v_reason TEXT := pg_catalog.btrim(COALESCE(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('tasks') THEN
    RAISE EXCEPTION 'TASKS_PERMISSION_REQUIRED: يلزم امتلاك صلاحية المهام لإلغاء الاعتماد.';
  END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 OR p_member_id IS NULL OR p_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_ID: معرّفات المهمة أو العضو غير صالحة.';
  END IF;
  -- سبب الإلغاء يظهر في سجل النقاط؛ احذف أي وسم قد يغيّر مجموع البونص بالخطأ.
  v_reason := pg_catalog.btrim(pg_catalog.regexp_replace(v_reason, '\[B:[+-]?[0-9]{1,9}\]', '', 'gi'));
  IF pg_catalog.char_length(v_reason) < 3 OR pg_catalog.char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'REVOCATION_REASON_REQUIRED: اكتب سبباً من 3 إلى 1000 حرف.';
  END IF;

  SELECT t.tracking, t.title INTO v_tracking, v_task_title
  FROM public.tasks AS t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND: المهمة غير موجودة.'; END IF;
  v_tracking := COALESCE(v_tracking, '{}'::jsonb);
  v_entry := v_tracking -> p_member_id::text;
  IF v_entry IS NULL THEN RAISE EXCEPTION 'NOT_ASSIGNED: العضو غير مكلف بهذه المهمة.'; END IF;
  IF v_entry ->> 'status' IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'NOT_APPROVED: لا يوجد اعتماد قائم لإلغائه.';
  END IF;

  v_bonus := LEAST(50, GREATEST(0, COALESCE((v_entry ->> 'bonus_awarded')::INT, 0)));
  v_rank_awarded := LEAST(100, GREATEST(0, COALESCE((v_entry ->> 'rank_awarded')::INT, 5 + v_bonus)));
  v_old_note_id := NULLIF(v_entry ->> 'bonus_note_id', '')::BIGINT;

  SELECT m.full_name INTO v_member_name FROM public.members AS m WHERE m.id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.'; END IF;

  IF v_bonus > 0 THEN
    IF v_old_note_id IS NOT NULL THEN
      DELETE FROM public.notes AS n
      WHERE n.id = v_old_note_id
        AND n.source_task_id = p_task_id
        AND n.source_member_id = p_member_id
        AND n.target_member_id = p_member_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_BONUS_NOTE_MISSING: سجل بونص الاعتماد غير موجود.'; END IF;
    ELSE
      -- ربط سجلات الاعتماد القديمة بأقرب ملاحظة أصلية سابقة لوقت الاعتماد.
      SELECT n.id INTO v_legacy_note_id
      FROM public.notes AS n
      WHERE n.target_member_id = p_member_id
        AND n.author = 'اعتماد المهام'
        AND n.author_role = 'admin'
        AND n.source_task_id IS NULL
        AND n.text = format(
          '[B:+%s] مكافأة إنجاز مهمة: %s', v_bonus,
          pg_catalog.regexp_replace(v_task_title, '\[B:[+-]?[0-9]{1,9}\]', '', 'gi')
        )
        AND n.created_at <= COALESCE((v_entry ->> 'updated_at')::timestamptz, now())
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 1
      FOR UPDATE;
      IF v_legacy_note_id IS NULL THEN
        RAISE EXCEPTION 'APPROVAL_BONUS_NOTE_MISSING: لم نعثر على سجل البونص المرتبط بهذا الاعتماد.';
      END IF;
      DELETE FROM public.notes WHERE id = v_legacy_note_id;
    END IF;
  END IF;

  UPDATE public.members
  SET completion_rank = GREATEST(0, COALESCE(completion_rank, 0) - v_rank_awarded)
  WHERE id = p_member_id
  RETURNING completion_rank INTO v_new_rank;

  v_entry := v_entry || jsonb_build_object(
    'status', 'revision_requested',
    'note', format('تم إلغاء الاعتماد. السبب: %s', v_reason),
    'updated_at', now(),
    'bonus_awarded', 0,
    'rank_awarded', 0,
    'bonus_note_id', NULL,
    'approval_reversal_reason', v_reason,
    'approval_reversed_at', now(),
    'approval_reversed_by', auth.uid()
  );
  v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::text], v_entry, true);
  UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;

  INSERT INTO public.notes (text, author, author_role, date, target_member_id, target_name, source_task_id, source_member_id)
  VALUES (
    format('تم إلغاء اعتماد مهمة «%s». السبب: %s', pg_catalog.regexp_replace(v_task_title, '\[B:[+-]?[0-9]{1,9}\]', '', 'gi'), v_reason),
    COALESCE(NULLIF(pg_catalog.btrim(auth.jwt() ->> 'email'), ''), 'إدارة المهام'),
    'admin', to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD'),
    p_member_id, v_member_name, p_task_id, p_member_id
  );

  RETURN jsonb_build_object(
    'task_id', p_task_id, 'member_id', p_member_id, 'status', 'revision_requested',
    'completion_rank', v_new_rank, 'rank_reversed', v_rank_awarded, 'bonus_reversed', v_bonus
  );
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_task_approval(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_task_approval(BIGINT, BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_member_rating(
  p_member_id BIGINT,
  p_points INT,
  p_reason TEXT,
  p_author TEXT DEFAULT 'إدارة وصلة'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
  v_reason TEXT := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_author TEXT := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_author, '')), ''), 'إدارة وصلة');
  v_text TEXT;
  v_note_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('ranking') THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED: يلزم امتلاك صلاحية ترتيب الفريق لتسجيل تقييم.';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 OR p_points IS NULL OR p_points < -5 OR p_points > 5 THEN
    RAISE EXCEPTION 'INVALID_RATING: بيانات التقييم غير صالحة.';
  END IF;
  -- لا تسمح لسبب التقييم بإضافة نقاط خارج قيمة p_points عبر وسم بونص مكتوب يدوياً.
  v_reason := pg_catalog.btrim(pg_catalog.regexp_replace(v_reason, '\[B:[+-]?[0-9]{1,9}\]', '', 'gi'));
  IF pg_catalog.char_length(v_reason) < 1 OR pg_catalog.char_length(v_reason) > 1000
     OR pg_catalog.char_length(v_author) > 100 THEN
    RAISE EXCEPTION 'RATING_REASON_REQUIRED: اكتب سبباً صحيحاً للتقييم.';
  END IF;
  SELECT m.full_name INTO v_name FROM public.members AS m WHERE m.id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود.'; END IF;

  v_text := CASE WHEN p_points > 0 THEN format('%s [B:+%s]', v_reason, p_points)
                 WHEN p_points < 0 THEN format('%s [B:%s]', v_reason, p_points)
                 ELSE v_reason END;
  INSERT INTO public.notes (text, author, author_role, date, target_member_id, target_name)
  VALUES (v_text, v_author, 'Admin', to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD'), p_member_id, v_name)
  RETURNING id INTO v_note_id;
  RETURN v_note_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_member_rating(BIGINT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_member_rating(BIGINT, INT, TEXT, TEXT) TO authenticated;

COMMIT;
