-- ICPC Hub — طبقة الـAPI. كل دالة security definer وبتتحقق من الهوية بنفسها،
-- ومفيش أي جدول متاح للقراءة المباشرة من العميل.

CREATE OR REPLACE FUNCTION public.icpc_member_id(p_user UUID)
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT b.member_id FROM public.member_auth_bindings AS b
    WHERE b.auth_user_id = p_user
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.icpc_role_of(p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF p_user IS NULL THEN
        RETURN 'guest';
    END IF;
    IF public.is_owner_role(p_user) OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = p_user) THEN
        RETURN 'admin';
    END IF;
    SELECT r.role INTO v_role FROM public.icpc_roles AS r WHERE r.user_id = p_user;
    IF v_role IS NOT NULL THEN
        RETURN v_role;
    END IF;
    IF EXISTS (SELECT 1 FROM public.member_auth_bindings AS b WHERE b.auth_user_id = p_user) THEN
        RETURN 'member';
    END IF;
    RETURN 'guest';
END $$;

CREATE OR REPLACE FUNCTION public.icpc_can_manage(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.icpc_role_of(p_user) IN ('admin', 'coach', 'captain')
$$;

CREATE OR REPLACE FUNCTION public.icpc_require_member(p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.icpc_role_of(p_user);
BEGIN
    IF v_role = 'guest' THEN
        RAISE EXCEPTION 'ICPC_FORBIDDEN: لازم تكون عضو في الفريق عشان تدخل ICPC Hub';
    END IF;
    RETURN v_role;
END $$;

CREATE OR REPLACE FUNCTION public.icpc_require_manager(p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.icpc_role_of(p_user);
BEGIN
    IF v_role NOT IN ('admin', 'coach', 'captain') THEN
        RAISE EXCEPTION 'ICPC_FORBIDDEN: التعديل متاح للكوتش أو الكابتن أو الأدمن بس';
    END IF;
    RETURN v_role;
END $$;

CREATE OR REPLACE FUNCTION public.icpc_directory()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', b.auth_user_id,
        'member_id', m.id,
        'full_name', m.full_name,
        'team', (SELECT t.name FROM public.team_memberships AS tm JOIN public.teams AS t ON t.id = tm.team_id WHERE tm.member_id = m.id AND tm.status = 'approved' LIMIT 1),
        'role', public.icpc_role_of(b.auth_user_id)
    ) ORDER BY m.full_name), '[]'::jsonb)
    FROM public.member_auth_bindings AS b
    JOIN public.members AS m ON m.id = b.member_id
    WHERE COALESCE(m.work_status, 'active') <> 'left'
$$;

-- نشاط يومي: مسائل محلولة + مساهمات مسابقات.
CREATE OR REPLACE FUNCTION public.icpc_activity(p_user UUID, p_from DATE, p_to DATE)
RETURNS TABLE (day DATE, problems INT, contests INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH solved AS (
        SELECT (a.solved_at AT TIME ZONE 'UTC')::date AS d, count(*)::int AS total
        FROM public.icpc_assignments AS a
        WHERE a.status = 'solved' AND a.solved_at IS NOT NULL
          AND (p_user IS NULL OR a.user_id = p_user)
          AND (a.solved_at AT TIME ZONE 'UTC')::date BETWEEN p_from AND p_to
        GROUP BY 1
    ), played AS (
        SELECT (c.starts_at AT TIME ZONE 'UTC')::date AS d, count(*)::int AS total
        FROM public.icpc_contest_participants AS p
        JOIN public.icpc_contests AS c ON c.id = p.contest_id
        WHERE (p_user IS NULL OR p.user_id = p_user)
          AND (c.starts_at AT TIME ZONE 'UTC')::date BETWEEN p_from AND p_to
        GROUP BY 1
    ), days AS (
        SELECT d FROM solved UNION SELECT d FROM played
    )
    SELECT days.d, COALESCE(solved.total, 0), COALESCE(played.total, 0)
    FROM days
    LEFT JOIN solved ON solved.d = days.d
    LEFT JOIN played ON played.d = days.d
    ORDER BY days.d
$$;

CREATE OR REPLACE FUNCTION public.icpc_context()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_role TEXT;
BEGIN
    v_role := public.icpc_role_of(v_user);
    RETURN jsonb_build_object(
        'role', v_role,
        'can_manage', v_role IN ('admin', 'coach', 'captain'),
        'user_id', v_user,
        'member_id', public.icpc_member_id(v_user),
        'member_name', (SELECT m.full_name FROM public.members AS m WHERE m.id = public.icpc_member_id(v_user))
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_overview(p_days INT DEFAULT 180, p_scope UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_role TEXT;
    v_scope UUID;
    v_from DATE;
    v_heatmap JSONB;
    v_streak INT := 0;
    v_weekly INT := 0;
    v_rating JSONB;
    v_mastery JSONB;
BEGIN
    v_role := public.icpc_require_member(v_user);
    v_scope := CASE WHEN public.icpc_can_manage(v_user) THEN p_scope ELSE v_user END;
    v_from := (now() AT TIME ZONE 'UTC')::date - GREATEST(COALESCE(p_days, 180), 7);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('day', a.day, 'problems', a.problems, 'contests', a.contests) ORDER BY a.day), '[]'::jsonb)
    INTO v_heatmap
    FROM public.icpc_activity(v_scope, v_from, (now() AT TIME ZONE 'UTC')::date) AS a;

    -- الستريك الحالي: أيام متتالية فيها نشاط، بسماحية يوم راحة واحد.
    WITH days AS (
        SELECT a.day FROM public.icpc_activity(v_scope, v_from, (now() AT TIME ZONE 'UTC')::date) AS a
        WHERE a.problems > 0 OR a.contests > 0
    )
    SELECT count(*)::int INTO v_streak
    FROM days
    WHERE days.day > COALESCE((SELECT max(d.day) FROM days AS d WHERE d.day < (now() AT TIME ZONE 'UTC')::date - 1), '1900-01-01'::date);

    SELECT COALESCE(sum(a.problems), 0)::int INTO v_weekly
    FROM public.icpc_activity(v_scope, (now() AT TIME ZONE 'UTC')::date - 6, (now() AT TIME ZONE 'UTC')::date) AS a;

    SELECT COALESCE(jsonb_agg(series ORDER BY series->>'platform'), '[]'::jsonb)
    INTO v_rating
    FROM (
        SELECT jsonb_build_object(
            'platform', q.platform,
            'points', jsonb_agg(jsonb_build_object('date', q.rated_at, 'rating', q.rating) ORDER BY q.rated_at),
            'current', (array_agg(q.rating ORDER BY q.rated_at DESC))[1],
            'peak', max(q.rating),
            'first', (array_agg(q.rating ORDER BY q.rated_at ASC))[1]
        ) AS series
        FROM (
            SELECT pa.platform, rh.rated_at, rh.rating
            FROM public.icpc_rating_history AS rh
            JOIN public.icpc_platform_accounts AS pa ON pa.id = rh.account_id
            WHERE (v_scope IS NULL OR pa.user_id = v_scope)
              AND rh.rated_at >= v_from
        ) AS q
        GROUP BY q.platform
    ) AS grouped;

    SELECT COALESCE(jsonb_agg(topic ORDER BY (topic->>'total')::int DESC), '[]'::jsonb)
    INTO v_mastery
    FROM (
        SELECT jsonb_build_object(
            'topic', t.topic,
            'total', t.total,
            'solved', t.solved,
            'percent', CASE WHEN t.total = 0 THEN 0 ELSE round(100.0 * t.solved / t.total)::int END
        ) AS topic
        FROM (
            SELECT unnest(p.topics) AS topic,
                   count(DISTINCT p.id)::int AS total,
                   count(DISTINCT CASE WHEN a.status = 'solved' THEN p.id END)::int AS solved
            FROM public.icpc_problems AS p
            LEFT JOIN public.icpc_assignments AS a ON a.problem_id = p.id AND (v_scope IS NULL OR a.user_id = v_scope)
            GROUP BY 1
        ) AS t
    ) AS mastery;

    RETURN jsonb_build_object(
        'role', v_role,
        'can_manage', public.icpc_can_manage(v_user),
        'scope', v_scope,
        'kpis', jsonb_build_object(
            'active_members', (SELECT count(DISTINCT a.user_id) FROM public.icpc_assignments AS a WHERE a.updated_at >= now() - interval '30 days'),
            'problems_solved', (SELECT count(*) FROM public.icpc_assignments AS a WHERE a.status = 'solved' AND (v_scope IS NULL OR a.user_id = v_scope) AND a.solved_at >= v_from),
            'contests', (SELECT count(*) FROM public.icpc_contests AS c WHERE c.starts_at >= v_from AND (v_scope IS NULL OR EXISTS (SELECT 1 FROM public.icpc_contest_participants AS p WHERE p.contest_id = c.id AND p.user_id = v_scope))),
            'training_hours', (SELECT COALESCE(round(sum(s.duration_minutes) / 60.0), 0) FROM public.icpc_sessions AS s WHERE s.starts_at >= v_from),
            'streak', v_streak,
            'weekly_solved', v_weekly,
            'weekly_goal', 10
        ),
        'heatmap', v_heatmap,
        'rating', v_rating,
        'mastery', v_mastery,
        'topics_top', (
            SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'count')::int DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object('topic', x.topic, 'count', count(*)::int) AS row_data
                FROM (
                    SELECT unnest(p.topics) AS topic
                    FROM public.icpc_problems AS p
                    JOIN public.icpc_assignments AS a ON a.problem_id = p.id
                    WHERE a.status = 'solved' AND (v_scope IS NULL OR a.user_id = v_scope)
                ) AS x
                GROUP BY x.topic
                ORDER BY count(*) DESC
                LIMIT 10
            ) AS top_rows
        ),
        'recent_contests', (
            SELECT COALESCE(jsonb_agg(item ORDER BY item->>'starts_at' DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'id', c.id, 'name', c.name, 'platform', c.platform, 'kind', c.kind,
                    'starts_at', c.starts_at, 'status', c.status,
                    'solved', COALESCE(p.solved, 0), 'rank', p.rank, 'delta', p.rating_delta
                ) AS item
                FROM public.icpc_contests AS c
                LEFT JOIN public.icpc_contest_participants AS p ON p.contest_id = c.id AND p.user_id = v_scope
                WHERE v_scope IS NULL OR p.id IS NOT NULL
                ORDER BY c.starts_at DESC
                LIMIT 6
            ) AS recent
        ),
        'recent_ac', (
            SELECT COALESCE(jsonb_agg(item ORDER BY item->>'solved_at' DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'problem', p.title, 'platform', p.platform, 'difficulty', p.difficulty,
                    'topics', p.topics, 'url', p.url, 'solved_at', a.solved_at,
                    'member', COALESCE(m.full_name, 'عضو')
                ) AS item
                FROM public.icpc_assignments AS a
                JOIN public.icpc_problems AS p ON p.id = a.problem_id
                LEFT JOIN public.members AS m ON m.id = public.icpc_member_id(a.user_id)
                WHERE a.status = 'solved' AND (v_scope IS NULL OR a.user_id = v_scope)
                ORDER BY a.solved_at DESC NULLS LAST
                LIMIT 8
            ) AS acs
        ),
        'workout', (
            SELECT jsonb_build_object(
                'day', (now() AT TIME ZONE 'UTC')::date,
                'items', COALESCE(jsonb_agg(jsonb_build_object(
                    'assignment_id', a.id, 'problem_id', p.id, 'title', p.title, 'url', p.url,
                    'difficulty', p.difficulty, 'status', a.status, 'topics', p.topics
                ) ORDER BY p.difficulty), '[]'::jsonb)
            )
            FROM public.icpc_assignments AS a
            JOIN public.icpc_problems AS p ON p.id = a.problem_id
            WHERE (v_scope IS NULL OR a.user_id = v_scope)
              AND a.status IN ('todo', 'solving')
              AND (a.due_date IS NULL OR a.due_date <= (now() AT TIME ZONE 'UTC')::date)
        )
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_training()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
BEGIN
    PERFORM public.icpc_require_member(v_user);
    RETURN jsonb_build_object(
        'stages', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'stage', s.stage,
                'topics', s.topics,
                'done', s.done,
                'total', s.total
            ) ORDER BY s.stage), '[]'::jsonb)
            FROM (
                SELECT t.stage,
                       jsonb_agg(jsonb_build_object(
                           'id', t.id, 'slug', t.slug, 'title_ar', t.title_ar, 'title_en', t.title_en,
                           'difficulty', t.difficulty, 'description', t.description,
                           'prerequisites', t.prerequisites, 'resources', t.resources,
                           'status', COALESCE(tp.status, 'todo'),
                           'problems', (SELECT count(*) FROM public.icpc_problems AS p WHERE t.slug = ANY (p.topics))
                       ) ORDER BY t.position) AS topics,
                       count(*) FILTER (WHERE tp.status = 'done')::int AS done,
                       count(*)::int AS total
                FROM public.icpc_topics AS t
                LEFT JOIN public.icpc_topic_progress AS tp ON tp.topic_id = t.id AND tp.user_id = v_user
                GROUP BY t.stage
            ) AS s
        )
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_set_topic(p_topic_id BIGINT, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
BEGIN
    PERFORM public.icpc_require_member(v_user);
    IF p_status NOT IN ('todo', 'learning', 'done') THEN
        RAISE EXCEPTION 'ICPC_INVALID: حالة غير معروفة';
    END IF;
    INSERT INTO public.icpc_topic_progress (user_id, topic_id, status)
    VALUES (v_user, p_topic_id, p_status)
    ON CONFLICT (user_id, topic_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'topic_id', p_topic_id, 'status', p_status);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_problems(p_filters JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_scope UUID;
    v_query TEXT := NULLIF(btrim(COALESCE(p_filters->>'query', '')), '');
    v_platform TEXT := NULLIF(btrim(COALESCE(p_filters->>'platform', '')), '');
    v_difficulty TEXT := NULLIF(btrim(COALESCE(p_filters->>'difficulty', '')), '');
    v_topic TEXT := NULLIF(btrim(COALESCE(p_filters->>'topic', '')), '');
    v_status TEXT := NULLIF(btrim(COALESCE(p_filters->>'status', '')), '');
BEGIN
    PERFORM public.icpc_require_member(v_user);
    v_scope := CASE WHEN public.icpc_can_manage(v_user) THEN NULL ELSE v_user END;

    RETURN jsonb_build_object(
        'problems', (
            SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at' DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'id', p.id, 'title', p.title, 'url', p.url, 'platform', p.platform,
                    'external_id', p.external_id, 'difficulty', p.difficulty, 'topics', p.topics,
                    'description', p.description, 'editorial_url', p.editorial_url,
                    'created_at', p.created_at,
                    'assignments', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', a.id, 'user_id', a.user_id, 'status', a.status,
                            'attempts', a.attempts, 'notes', a.notes, 'due_date', a.due_date,
                            'solved_at', a.solved_at,
                            'member', COALESCE(m.full_name, 'عضو')
                        ) ORDER BY m.full_name)
                        FROM public.icpc_assignments AS a
                        LEFT JOIN public.members AS m ON m.id = public.icpc_member_id(a.user_id)
                        WHERE a.problem_id = p.id AND (v_scope IS NULL OR a.user_id = v_scope)
                    ), '[]'::jsonb)
                ) AS item
                FROM public.icpc_problems AS p
                WHERE (v_query IS NULL OR p.title ILIKE '%' || v_query || '%')
                  AND (v_platform IS NULL OR p.platform = v_platform)
                  AND (v_difficulty IS NULL OR p.difficulty = v_difficulty)
                  AND (v_topic IS NULL OR v_topic = ANY (p.topics))
                  AND (v_status IS NULL OR EXISTS (
                        SELECT 1 FROM public.icpc_assignments AS a
                        WHERE a.problem_id = p.id AND a.status = v_status
                          AND (v_scope IS NULL OR a.user_id = v_scope)))
            ) AS filtered
        ),
        'topics', (SELECT COALESCE(jsonb_agg(DISTINCT x.topic), '[]'::jsonb) FROM (SELECT unnest(p.topics) AS topic FROM public.icpc_problems AS p) AS x),
        'directory', public.icpc_directory()
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_save_problem(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_id BIGINT := NULLIF(p_payload->>'id', '')::bigint;
    v_title TEXT := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
BEGIN
    PERFORM public.icpc_require_manager(v_user);
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: اسم المسألة مطلوب';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.icpc_problems (title, url, platform, external_id, difficulty, topics, description, editorial_url, created_by)
        VALUES (
            v_title,
            NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
            COALESCE(NULLIF(p_payload->>'platform', ''), 'codeforces'),
            NULLIF(btrim(COALESCE(p_payload->>'external_id', '')), ''),
            COALESCE(NULLIF(p_payload->>'difficulty', ''), 'medium'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'topics', '[]'::jsonb))), '{}'),
            NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
            NULLIF(btrim(COALESCE(p_payload->>'editorial_url', '')), ''),
            v_user
        ) RETURNING id INTO v_id;
    ELSE
        UPDATE public.icpc_problems SET
            title = v_title,
            url = NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
            platform = COALESCE(NULLIF(p_payload->>'platform', ''), platform),
            external_id = NULLIF(btrim(COALESCE(p_payload->>'external_id', '')), ''),
            difficulty = COALESCE(NULLIF(p_payload->>'difficulty', ''), difficulty),
            topics = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'topics', to_jsonb(topics)))), '{}'),
            description = NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
            editorial_url = NULLIF(btrim(COALESCE(p_payload->>'editorial_url', '')), ''),
            updated_at = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ICPC_NOT_FOUND: المسألة مش موجودة';
        END IF;
    END IF;
    RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_delete_problem(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.icpc_require_manager(auth.uid());
    DELETE FROM public.icpc_problems WHERE id = p_id;
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_assign_problem(p_problem_id BIGINT, p_user_ids UUID[], p_due DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_count INT := 0;
BEGIN
    PERFORM public.icpc_require_manager(v_user);
    IF NOT EXISTS (SELECT 1 FROM public.icpc_problems WHERE id = p_problem_id) THEN
        RAISE EXCEPTION 'ICPC_NOT_FOUND: المسألة مش موجودة';
    END IF;
    INSERT INTO public.icpc_assignments (problem_id, user_id, due_date)
    SELECT p_problem_id, target, p_due
    FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) AS target
    ON CONFLICT (problem_id, user_id) DO UPDATE SET due_date = COALESCE(EXCLUDED.due_date, public.icpc_assignments.due_date);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'assigned', v_count);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_set_progress(p_assignment_id BIGINT, p_status TEXT, p_attempts INT DEFAULT NULL, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_owner UUID;
BEGIN
    PERFORM public.icpc_require_member(v_user);
    SELECT a.user_id INTO v_owner FROM public.icpc_assignments AS a WHERE a.id = p_assignment_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'ICPC_NOT_FOUND: التكليف مش موجود';
    END IF;
    IF v_owner <> v_user AND NOT public.icpc_can_manage(v_user) THEN
        RAISE EXCEPTION 'ICPC_FORBIDDEN: التكليف ده مش بتاعك';
    END IF;
    IF p_status NOT IN ('todo', 'solving', 'solved', 'upsolving', 'revisit') THEN
        RAISE EXCEPTION 'ICPC_INVALID: حالة غير معروفة';
    END IF;
    UPDATE public.icpc_assignments SET
        status = p_status,
        attempts = GREATEST(COALESCE(p_attempts, attempts), 0),
        notes = COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), notes),
        solved_at = CASE WHEN p_status = 'solved' THEN COALESCE(solved_at, now()) ELSE NULL END,
        updated_at = now()
    WHERE id = p_assignment_id;
    RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_contests()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_manage BOOLEAN;
BEGIN
    PERFORM public.icpc_require_member(v_user);
    v_manage := public.icpc_can_manage(v_user);
    RETURN jsonb_build_object(
        'contests', (
            SELECT COALESCE(jsonb_agg(item ORDER BY item->>'starts_at' DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'id', c.id, 'name', c.name, 'description', c.description, 'platform', c.platform,
                    'kind', c.kind, 'starts_at', c.starts_at, 'duration_minutes', c.duration_minutes,
                    'visibility', c.visibility, 'status', c.status, 'scoring', c.scoring,
                    'problems', (SELECT count(*) FROM public.icpc_contest_problems AS cp WHERE cp.contest_id = c.id),
                    'participants', (SELECT count(*) FROM public.icpc_contest_participants AS p WHERE p.contest_id = c.id),
                    'joined', EXISTS (SELECT 1 FROM public.icpc_contest_participants AS p WHERE p.contest_id = c.id AND p.user_id = v_user)
                ) AS item
                FROM public.icpc_contests AS c
                WHERE v_manage OR c.visibility = 'team'
            ) AS rows
        ),
        'directory', public.icpc_directory()
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_save_contest(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_id BIGINT := NULLIF(p_payload->>'id', '')::bigint;
    v_name TEXT := NULLIF(btrim(COALESCE(p_payload->>'name', '')), '');
BEGIN
    PERFORM public.icpc_require_manager(v_user);
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: اسم المسابقة مطلوب';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.icpc_contests (name, description, platform, kind, starts_at, duration_minutes, visibility, status, scoring, created_by)
        VALUES (
            v_name,
            NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
            COALESCE(NULLIF(p_payload->>'platform', ''), 'internal'),
            COALESCE(NULLIF(p_payload->>'kind', ''), 'internal'),
            COALESCE((p_payload->>'starts_at')::timestamptz, now()),
            COALESCE(NULLIF(p_payload->>'duration_minutes', '')::int, 300),
            COALESCE(NULLIF(p_payload->>'visibility', ''), 'team'),
            COALESCE(NULLIF(p_payload->>'status', ''), 'scheduled'),
            COALESCE(p_payload->'scoring', '{"penalty_minutes": 20, "points_per_problem": 1}'::jsonb),
            v_user
        ) RETURNING id INTO v_id;
    ELSE
        UPDATE public.icpc_contests SET
            name = v_name,
            description = NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
            platform = COALESCE(NULLIF(p_payload->>'platform', ''), platform),
            kind = COALESCE(NULLIF(p_payload->>'kind', ''), kind),
            starts_at = COALESCE((p_payload->>'starts_at')::timestamptz, starts_at),
            duration_minutes = COALESCE(NULLIF(p_payload->>'duration_minutes', '')::int, duration_minutes),
            visibility = COALESCE(NULLIF(p_payload->>'visibility', ''), visibility),
            status = COALESCE(NULLIF(p_payload->>'status', ''), status),
            scoring = COALESCE(p_payload->'scoring', scoring),
            updated_at = now()
        WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_contest_detail(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_manage BOOLEAN;
BEGIN
    PERFORM public.icpc_require_member(v_user);
    v_manage := public.icpc_can_manage(v_user);
    RETURN jsonb_build_object(
        'contest', (SELECT to_jsonb(c) FROM public.icpc_contests AS c WHERE c.id = p_id),
        'problems', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', cp.id, 'label', cp.label, 'points', cp.points,
                'problem_id', p.id, 'title', p.title, 'url', p.url, 'difficulty', p.difficulty, 'topics', p.topics
            ) ORDER BY cp.label), '[]'::jsonb)
            FROM public.icpc_contest_problems AS cp
            JOIN public.icpc_problems AS p ON p.id = cp.problem_id
            WHERE cp.contest_id = p_id
        ),
        'scoreboard', (
            SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'score')::numeric DESC, (item->>'penalty')::int), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'user_id', pt.user_id, 'member', COALESCE(m.full_name, 'عضو'), 'team_name', pt.team_name,
                    'solved', pt.solved, 'penalty', pt.penalty, 'rank', pt.rank,
                    'rating_delta', pt.rating_delta, 'score', pt.score
                ) AS item
                FROM public.icpc_contest_participants AS pt
                LEFT JOIN public.members AS m ON m.id = public.icpc_member_id(pt.user_id)
                WHERE pt.contest_id = p_id
            ) AS rows
        ),
        'can_manage', v_manage
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_contest_join(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
BEGIN
    PERFORM public.icpc_require_member(v_user);
    IF NOT EXISTS (SELECT 1 FROM public.icpc_contests WHERE id = p_id) THEN
        RAISE EXCEPTION 'ICPC_NOT_FOUND: المسابقة مش موجودة';
    END IF;
    INSERT INTO public.icpc_contest_participants (contest_id, user_id)
    VALUES (p_id, v_user)
    ON CONFLICT (contest_id, user_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true);
END $$;

-- الحساب قابل للضبط: النقاط لكل مسألة والعقوبة بالدقايق جايين من إعدادات المسابقة.
CREATE OR REPLACE FUNCTION public.icpc_contest_record(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_contest BIGINT := NULLIF(p_payload->>'contest_id', '')::bigint;
    v_target UUID := COALESCE(NULLIF(p_payload->>'user_id', '')::uuid, auth.uid());
    v_solved INT := COALESCE(NULLIF(p_payload->>'solved', '')::int, 0);
    v_penalty INT := COALESCE(NULLIF(p_payload->>'penalty', '')::int, 0);
    v_rank INT := NULLIF(p_payload->>'rank', '')::int;
    v_delta INT := NULLIF(p_payload->>'rating_delta', '')::int;
    v_scoring JSONB;
    v_points NUMERIC;
BEGIN
    PERFORM public.icpc_require_member(v_user);
    IF v_target <> v_user THEN
        PERFORM public.icpc_require_manager(v_user);
    END IF;
    SELECT c.scoring INTO v_scoring FROM public.icpc_contests AS c WHERE c.id = v_contest;
    IF v_scoring IS NULL THEN
        RAISE EXCEPTION 'ICPC_NOT_FOUND: المسابقة مش موجودة';
    END IF;
    v_points := v_solved * COALESCE((v_scoring->>'points_per_problem')::numeric, 1)
        - (v_penalty / 60.0) * COALESCE((v_scoring->>'penalty_minutes')::numeric, 20) / 20.0;
    INSERT INTO public.icpc_contest_participants (contest_id, user_id, solved, penalty, rank, rating_delta, score)
    VALUES (v_contest, v_target, v_solved, v_penalty, v_rank, v_delta, GREATEST(v_points, 0))
    ON CONFLICT (contest_id, user_id) DO UPDATE SET
        solved = EXCLUDED.solved, penalty = EXCLUDED.penalty, rank = EXCLUDED.rank,
        rating_delta = EXCLUDED.rating_delta, score = EXCLUDED.score, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'score', GREATEST(v_points, 0));
END $$;

CREATE OR REPLACE FUNCTION public.icpc_team(p_days INT DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_from DATE := (now() AT TIME ZONE 'UTC')::date - GREATEST(COALESCE(p_days, 90), 7);
BEGIN
    PERFORM public.icpc_require_member(v_user);
    RETURN jsonb_build_object(
        'members', (
            SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'solved')::int DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'user_id', d.user_id, 'member', d.full_name, 'team', (SELECT t.name FROM public.team_memberships AS tm JOIN public.teams AS t ON t.id = tm.team_id WHERE tm.member_id = d.member_id AND tm.status = 'approved' LIMIT 1), 'role', d.role,
                    'solved', (SELECT count(*) FROM public.icpc_assignments AS a WHERE a.user_id = d.user_id AND a.status = 'solved' AND a.solved_at >= v_from),
                    'contests', (SELECT count(*) FROM public.icpc_contest_participants AS p JOIN public.icpc_contests AS c ON c.id = p.contest_id WHERE p.user_id = d.user_id AND c.starts_at >= v_from),
                    'rating', (SELECT max(pa.current_rating) FROM public.icpc_platform_accounts AS pa WHERE pa.user_id = d.user_id),
                    'topics', COALESCE((
                        SELECT jsonb_object_agg(t.topic, t.total)
                        FROM (
                            SELECT unnest(p.topics) AS topic, count(*)::int AS total
                            FROM public.icpc_assignments AS a
                            JOIN public.icpc_problems AS p ON p.id = a.problem_id
                            WHERE a.user_id = d.user_id AND a.status = 'solved' AND a.solved_at >= v_from
                            GROUP BY 1
                        ) AS t
                    ), '{}'::jsonb)
                ) AS item
                FROM (
                    SELECT b.auth_user_id AS user_id, m.id AS member_id, m.full_name, public.icpc_role_of(b.auth_user_id) AS role
                    FROM public.member_auth_bindings AS b
                    JOIN public.members AS m ON m.id = b.member_id
                    WHERE COALESCE(m.work_status, 'active') <> 'left'
                ) AS d
            ) AS rows
        ),
        'topics', (SELECT COALESCE(jsonb_agg(DISTINCT x.topic), '[]'::jsonb) FROM (SELECT unnest(p.topics) AS topic FROM public.icpc_problems AS p) AS x),
        'can_manage', public.icpc_can_manage(v_user)
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_calendar(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
BEGIN
    PERFORM public.icpc_require_member(v_user);
    RETURN jsonb_build_object(
        'sessions', (
            SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.starts_at), '[]'::jsonb)
            FROM public.icpc_sessions AS s
            WHERE s.starts_at::date BETWEEN p_from AND p_to
        ),
        'contests', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'starts_at', c.starts_at,
                'duration_minutes', c.duration_minutes, 'kind', c.kind, 'platform', c.platform
            ) ORDER BY c.starts_at), '[]'::jsonb)
            FROM public.icpc_contests AS c
            WHERE c.starts_at::date BETWEEN p_from AND p_to
        ),
        'deadlines', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'assignment_id', a.id, 'title', p.title, 'due_date', a.due_date, 'status', a.status
            ) ORDER BY a.due_date), '[]'::jsonb)
            FROM public.icpc_assignments AS a
            JOIN public.icpc_problems AS p ON p.id = a.problem_id
            WHERE a.due_date BETWEEN p_from AND p_to
              AND (public.icpc_can_manage(v_user) OR a.user_id = v_user)
        ),
        'can_manage', public.icpc_can_manage(v_user)
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_save_session(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_id BIGINT := NULLIF(p_payload->>'id', '')::bigint;
    v_title TEXT := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
BEGIN
    PERFORM public.icpc_require_manager(v_user);
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: عنوان الجلسة مطلوب';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.icpc_sessions (title, kind, starts_at, duration_minutes, location, url, topic, created_by)
        VALUES (
            v_title,
            COALESCE(NULLIF(p_payload->>'kind', ''), 'training'),
            COALESCE((p_payload->>'starts_at')::timestamptz, now()),
            COALESCE(NULLIF(p_payload->>'duration_minutes', '')::int, 90),
            NULLIF(btrim(COALESCE(p_payload->>'location', '')), ''),
            NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
            NULLIF(btrim(COALESCE(p_payload->>'topic', '')), ''),
            v_user
        ) RETURNING id INTO v_id;
    ELSE
        UPDATE public.icpc_sessions SET
            title = v_title,
            kind = COALESCE(NULLIF(p_payload->>'kind', ''), kind),
            starts_at = COALESCE((p_payload->>'starts_at')::timestamptz, starts_at),
            duration_minutes = COALESCE(NULLIF(p_payload->>'duration_minutes', '')::int, duration_minutes),
            location = NULLIF(btrim(COALESCE(p_payload->>'location', '')), ''),
            url = NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''),
            topic = NULLIF(btrim(COALESCE(p_payload->>'topic', '')), '')
        WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_delete_session(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.icpc_require_manager(auth.uid());
    DELETE FROM public.icpc_sessions WHERE id = p_id;
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_notes(p_query TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_query TEXT := NULLIF(btrim(COALESCE(p_query, '')), '');
BEGIN
    PERFORM public.icpc_require_member(v_user);
    RETURN jsonb_build_object(
        'notes', (
            SELECT COALESCE(jsonb_agg(item ORDER BY item->>'updated_at' DESC), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'id', n.id, 'title', n.title, 'category', n.category, 'tags', n.tags,
                    'content_md', n.content_md, 'links', n.links, 'status', n.status,
                    'updated_at', n.updated_at, 'created_at', n.created_at,
                    'author', COALESCE(m.full_name, 'عضو'), 'author_id', n.author_id
                ) AS item
                FROM public.icpc_notes AS n
                LEFT JOIN public.members AS m ON m.id = public.icpc_member_id(n.author_id)
                WHERE v_query IS NULL OR n.title ILIKE '%' || v_query || '%'
                   OR n.content_md ILIKE '%' || v_query || '%'
                   OR EXISTS (SELECT 1 FROM unnest(n.tags) AS tag WHERE tag ILIKE '%' || v_query || '%')
            ) AS rows
        ),
        'can_manage', public.icpc_can_manage(v_user)
    );
END $$;

CREATE OR REPLACE FUNCTION public.icpc_save_note(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_role TEXT;
    v_id BIGINT := NULLIF(p_payload->>'id', '')::bigint;
    v_title TEXT := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
BEGIN
    v_role := public.icpc_require_member(v_user);
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: عنوان الملاحظة مطلوب';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.icpc_notes (title, category, tags, content_md, links, author_id, status)
        VALUES (
            v_title,
            COALESCE(NULLIF(p_payload->>'category', ''), 'algorithms'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'tags', '[]'::jsonb))), '{}'),
            COALESCE(p_payload->>'content_md', ''),
            COALESCE(p_payload->'links', '[]'::jsonb),
            v_user,
            CASE WHEN v_role IN ('admin', 'coach', 'captain') THEN 'published' ELSE 'pending' END
        ) RETURNING id INTO v_id;
    ELSE
        UPDATE public.icpc_notes SET
            title = v_title,
            category = COALESCE(NULLIF(p_payload->>'category', ''), category),
            tags = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'tags', to_jsonb(tags)))), '{}'),
            content_md = COALESCE(p_payload->>'content_md', content_md),
            links = COALESCE(p_payload->'links', links),
            status = CASE WHEN v_role IN ('admin', 'coach', 'captain') THEN 'published' ELSE status END,
            updated_at = now()
        WHERE id = v_id AND (author_id = v_user OR v_role IN ('admin', 'coach', 'captain'));
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ICPC_FORBIDDEN: مش مسموح تعدّل الملاحظة دي';
        END IF;
    END IF;
    RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_delete_note(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_role TEXT := public.icpc_require_member(v_user);
BEGIN
    DELETE FROM public.icpc_notes WHERE id = p_id AND (author_id = v_user OR v_role IN ('admin', 'coach', 'captain'));
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_link_platform(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_platform TEXT := NULLIF(btrim(COALESCE(p_payload->>'platform', '')), '');
    v_handle TEXT := NULLIF(btrim(COALESCE(p_payload->>'handle', '')), '');
BEGIN
    PERFORM public.icpc_require_member(v_user);
    IF v_platform IS NULL OR v_handle IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: المنصة والـhandle مطلوبين';
    END IF;
    INSERT INTO public.icpc_platform_accounts (user_id, platform, handle, current_rating, peak_rating, last_sync_at)
    VALUES (v_user, v_platform, v_handle,
            NULLIF(p_payload->>'current_rating', '')::int,
            NULLIF(p_payload->>'peak_rating', '')::int,
            now())
    ON CONFLICT (user_id, platform) DO UPDATE SET
        handle = EXCLUDED.handle,
        current_rating = COALESCE(EXCLUDED.current_rating, public.icpc_platform_accounts.current_rating),
        peak_rating = GREATEST(COALESCE(EXCLUDED.peak_rating, 0), COALESCE(public.icpc_platform_accounts.peak_rating, 0)),
        last_sync_at = now(),
        updated_at = now();
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_add_rating(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_platform TEXT := NULLIF(btrim(COALESCE(p_payload->>'platform', '')), '');
    v_account BIGINT;
    v_rating INT := NULLIF(p_payload->>'rating', '')::int;
BEGIN
    PERFORM public.icpc_require_member(v_user);
    SELECT id INTO v_account FROM public.icpc_platform_accounts WHERE user_id = v_user AND platform = v_platform;
    IF v_account IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: اربط حساب المنصة الأول';
    END IF;
    IF v_rating IS NULL THEN
        RAISE EXCEPTION 'ICPC_INVALID: الرقم مطلوب';
    END IF;
    INSERT INTO public.icpc_rating_history (account_id, contest_name, rating, delta, rated_at)
    VALUES (v_account,
            COALESCE(NULLIF(btrim(COALESCE(p_payload->>'contest_name', '')), ''), 'Contest'),
            v_rating,
            COALESCE(NULLIF(p_payload->>'delta', '')::int, 0),
            COALESCE((p_payload->>'rated_at')::date, (now() AT TIME ZONE 'UTC')::date))
    ON CONFLICT (account_id, contest_name, rated_at) DO UPDATE SET rating = EXCLUDED.rating, delta = EXCLUDED.delta;
    UPDATE public.icpc_platform_accounts SET
        current_rating = v_rating,
        peak_rating = GREATEST(COALESCE(peak_rating, 0), v_rating),
        updated_at = now()
    WHERE id = v_account;
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.icpc_analytics(p_days INT DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_from DATE := (now() AT TIME ZONE 'UTC')::date - GREATEST(COALESCE(p_days, 90), 7);
BEGIN
    PERFORM public.icpc_require_member(v_user);
    RETURN jsonb_build_object(
        'by_platform', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', q.platform, 'solved', q.total) ORDER BY q.total DESC), '[]'::jsonb)
            FROM (
                SELECT p.platform, count(*)::int AS total
                FROM public.icpc_assignments AS a
                JOIN public.icpc_problems AS p ON p.id = a.problem_id
                WHERE a.status = 'solved' AND a.solved_at >= v_from
                GROUP BY 1
            ) AS q
        ),
        'by_difficulty', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('difficulty', q.difficulty, 'solved', q.total)), '[]'::jsonb)
            FROM (
                SELECT p.difficulty, count(*)::int AS total
                FROM public.icpc_assignments AS a
                JOIN public.icpc_problems AS p ON p.id = a.problem_id
                WHERE a.status = 'solved' AND a.solved_at >= v_from
                GROUP BY 1
            ) AS q
        ),
        'weekly', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('week', q.week, 'solved', q.total) ORDER BY q.week), '[]'::jsonb)
            FROM (
                SELECT to_char(date_trunc('week', a.solved_at), 'YYYY-MM-DD') AS week, count(*)::int AS total
                FROM public.icpc_assignments AS a
                WHERE a.status = 'solved' AND a.solved_at >= v_from
                GROUP BY 1
            ) AS q
        ),
        'status_breakdown', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('status', q.status, 'total', q.total)), '[]'::jsonb)
            FROM (SELECT a.status, count(*)::int AS total FROM public.icpc_assignments AS a GROUP BY 1) AS q
        )
    );
END $$;

DO $$
DECLARE
    v_fn RECORD;
BEGIN
    FOR v_fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'icpc\_%'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn.signature);
    END LOOP;
END $$;
