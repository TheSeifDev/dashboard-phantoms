-- Append-only task approval/reversal ledger.
-- The existing approval/reversal RPCs remain authoritative: this trigger only
-- observes tracking-state transitions, so ledger writes share their
-- transaction and preserve their signatures, authorization, locks and effects.
BEGIN;

-- Prevent an approval/reversal racing the one-time legacy snapshot while the
-- trigger is being installed. Readers remain available during the migration.
LOCK TABLE public.tasks IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.task_contribution_events (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('approved', 'reversed')),
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_user_id UUID,
  provenance TEXT NOT NULL CHECK (provenance IN ('live_transition', 'legacy_snapshot')),
  CONSTRAINT task_contribution_event_actor_provenance_check CHECK (
    (provenance = 'live_transition' AND actor_user_id IS NOT NULL)
    OR (provenance = 'legacy_snapshot' AND actor_user_id IS NULL)
  )
);

COMMENT ON TABLE public.task_contribution_events IS
  'Append-only, minimal audit of task approval/reversal transitions. Task/member/actor identifiers intentionally have no cascading foreign keys: deleting a task, member, or Auth identity does not silently erase activity history. The retained numeric/UUID identifiers are pseudonymous and contain no names or submission content. Exact-ID synthetic-fixture cleanup in a disposable local database is privileged DBA maintenance only, in an explicit transaction with append-only triggers temporarily disabled and restored; there is no client cleanup RPC or operational cascade. Any privacy-driven purge requires a separately reviewed retention procedure.';
COMMENT ON COLUMN public.task_contribution_events.provenance IS
  'live_transition is captured transactionally from task tracking updates; legacy_snapshot is a one-time migration snapshot of currently approved entries with a valid stored updated_at, not a claim of complete historical activity.';

CREATE INDEX task_contribution_events_approved_time_member_idx
  ON public.task_contribution_events (occurred_at, member_id)
  WHERE event_type = 'approved';
CREATE INDEX task_contribution_events_task_member_idx
  ON public.task_contribution_events (task_id, member_id, event_id);

CREATE TABLE public.task_contribution_ledger_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  tracking_started_at TIMESTAMPTZ NOT NULL,
  history_complete_since TIMESTAMPTZ NOT NULL
);
COMMENT ON TABLE public.task_contribution_ledger_config IS
  'Private one-row metadata for the task contribution ledger. history_complete_since marks the start of reliable transition capture; legacy snapshots before that boundary are explicitly incomplete.';

ALTER TABLE public.task_contribution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_contribution_ledger_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.task_contribution_events, public.task_contribution_ledger_config
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.task_contribution_events_event_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

-- Snapshot only approvals still present in tracking, and only where updated_at
-- is an explicit-offset ISO timestamp which PostgreSQL can parse. Do not infer
-- dates from task/member creation, reversal notes, or other side channels.
DO $$
DECLARE
  v_row RECORD;
  v_approved_at TIMESTAMPTZ;
  v_member_id BIGINT;
BEGIN
  FOR v_row IN
    SELECT t.id AS task_id,
           entry.key AS member_key,
           entry.value ->> 'updated_at' AS updated_at
    FROM public.tasks AS t
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(t.tracking) = 'object' THEN t.tracking ELSE '{}'::jsonb END
    ) AS entry
    WHERE entry.value ->> 'status' = 'approved'
      AND entry.key ~ '^[1-9][0-9]{0,18}$'
  LOOP
    BEGIN
      v_member_id := v_row.member_key::BIGINT;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      CONTINUE;
    END;
    IF v_member_id <= 0 OR v_row.updated_at IS NULL
       OR v_row.updated_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      CONTINUE;
    END IF;

    BEGIN
      v_approved_at := v_row.updated_at::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    INSERT INTO public.task_contribution_events (
      task_id, member_id, event_type, occurred_at, actor_user_id, provenance
    ) VALUES (
      v_row.task_id, v_member_id, 'approved', v_approved_at, NULL, 'legacy_snapshot'
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.prevent_task_contribution_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'TASK_CONTRIBUTION_LEDGER_APPEND_ONLY'
    USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_task_contribution_event_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_contribution_events_append_only
BEFORE UPDATE OR DELETE ON public.task_contribution_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_task_contribution_event_mutation();

CREATE TRIGGER task_contribution_events_no_truncate
BEFORE TRUNCATE ON public.task_contribution_events
FOR EACH STATEMENT
EXECUTE FUNCTION public.prevent_task_contribution_event_mutation();

CREATE FUNCTION public.capture_task_contribution_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_tracking JSONB := CASE
    WHEN jsonb_typeof(OLD.tracking) = 'object' THEN OLD.tracking ELSE '{}'::jsonb END;
  v_new_tracking JSONB := CASE
    WHEN jsonb_typeof(NEW.tracking) = 'object' THEN NEW.tracking ELSE '{}'::jsonb END;
  v_member_key TEXT;
  v_member_id BIGINT;
  v_old_entry JSONB;
  v_new_entry JSONB;
  v_event_type TEXT;
  v_actor UUID := auth.uid();
BEGIN
  IF v_old_tracking IS NOT DISTINCT FROM v_new_tracking THEN
    RETURN NEW;
  END IF;

  FOR v_member_key IN
    SELECT member_key
    FROM (
      SELECT jsonb_object_keys(v_old_tracking) AS member_key
      UNION
      SELECT jsonb_object_keys(v_new_tracking) AS member_key
    ) AS changed_keys
    ORDER BY member_key
  LOOP
    v_old_entry := v_old_tracking -> v_member_key;
    v_new_entry := v_new_tracking -> v_member_key;
    v_event_type := NULL;

    IF v_old_entry ->> 'status' IS DISTINCT FROM 'approved'
       AND v_new_entry ->> 'status' = 'approved' THEN
      v_event_type := 'approved';
    ELSIF v_old_entry ->> 'status' = 'approved'
       AND v_new_entry ->> 'status' IS DISTINCT FROM 'approved' THEN
      v_event_type := 'reversed';
    END IF;

    IF v_event_type IS NOT NULL THEN
      IF v_member_key !~ '^[1-9][0-9]{0,18}$' THEN
        RAISE EXCEPTION 'INVALID_TRACKING_MEMBER_KEY: task approval transition has an invalid member key.';
      END IF;
      BEGIN
        v_member_id := v_member_key::BIGINT;
      EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'INVALID_TRACKING_MEMBER_KEY: task approval transition has an invalid member key.';
      END;

      IF v_actor IS NULL OR NOT public.has_admin_permission('tasks') THEN
        RAISE EXCEPTION 'TASKS_PERMISSION_REQUIRED: task approval transitions require the task permission.';
      END IF;

      INSERT INTO public.task_contribution_events (
        task_id, member_id, event_type, occurred_at, actor_user_id, provenance
      ) VALUES (
        NEW.id, v_member_id, v_event_type, clock_timestamp(), v_actor, 'live_transition'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_task_contribution_transition() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tasks_capture_contribution_transitions
AFTER UPDATE OF tracking ON public.tasks
FOR EACH ROW
WHEN (OLD.tracking IS DISTINCT FROM NEW.tracking)
EXECUTE FUNCTION public.capture_task_contribution_transition();

-- The completion boundary is written after the snapshot and transition trigger
-- are in place. The table lock keeps the handoff gap-free until commit.
INSERT INTO public.task_contribution_ledger_config (
  singleton, tracking_started_at, history_complete_since
)
SELECT TRUE, started.boundary_ts, started.boundary_ts
FROM (SELECT clock_timestamp() AS boundary_ts) AS started;

CREATE FUNCTION public.get_task_contributions(
  p_year INTEGER,
  p_member_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (timezone('Africa/Cairo', statement_timestamp()))::DATE;
  v_current_year INTEGER;
  v_year_start TIMESTAMPTZ;
  v_year_end TIMESTAMPTZ;
  v_tracking_started_at TIMESTAMPTZ;
  v_history_complete_since TIMESTAMPTZ;
  v_days JSONB;
  v_total_approvals BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('dashboard') THEN
    RAISE EXCEPTION 'DASHBOARD_PERMISSION_REQUIRED: يلزم امتلاك صلاحية لوحة التحكم لقراءة ملخص الإنجاز.';
  END IF;

  v_current_year := EXTRACT(YEAR FROM v_today)::INTEGER;
  IF p_year IS NULL OR p_year < 2000 OR p_year > v_current_year THEN
    RAISE EXCEPTION 'INVALID_YEAR: السنة المطلوبة خارج النطاق المسموح.';
  END IF;
  IF p_member_id IS NOT NULL AND p_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ID: معرّف العضو غير صالح.';
  END IF;

  v_year_start := make_date(p_year, 1, 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
  v_year_end := make_date(p_year + 1, 1, 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';

  SELECT c.tracking_started_at, c.history_complete_since
    INTO v_tracking_started_at, v_history_complete_since
  FROM public.task_contribution_ledger_config AS c
  WHERE c.singleton = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_CONTRIBUTION_LEDGER_UNAVAILABLE';
  END IF;

  -- Heatmap activity counts approval events only. Reversal rows remain in the
  -- private audit ledger but never erase the historical approval contribution.
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('date', daily.activity_date, 'count', daily.approval_count)
                     ORDER BY daily.activity_date),
           '[]'::jsonb
         ),
         COALESCE(SUM(daily.approval_count), 0)::BIGINT
    INTO v_days, v_total_approvals
  FROM (
    SELECT timezone('Africa/Cairo', e.occurred_at)::DATE AS activity_date,
           COUNT(*)::BIGINT AS approval_count
    FROM public.task_contribution_events AS e
    WHERE e.event_type = 'approved'
      AND e.occurred_at >= v_year_start
      AND e.occurred_at < v_year_end
      AND e.occurred_at <= statement_timestamp()
      AND (p_member_id IS NULL OR e.member_id = p_member_id)
    GROUP BY timezone('Africa/Cairo', e.occurred_at)::DATE
    ORDER BY timezone('Africa/Cairo', e.occurred_at)::DATE
    LIMIT 366
  ) AS daily;

  RETURN jsonb_build_object(
    'timezone', 'Africa/Cairo',
    'tracking_started_at', v_tracking_started_at,
    'today', v_today,
    'year', p_year,
    'history_complete_since', v_history_complete_since,
    'days', v_days,
    'total_approvals', v_total_approvals
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_task_contributions(INTEGER, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_task_contributions(INTEGER, BIGINT) TO authenticated;

COMMIT;
