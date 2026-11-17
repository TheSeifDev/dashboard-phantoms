BEGIN;

-- Bound rotating-input limiter storage without recycling an active budget.
-- The global transaction lock makes the cap check and bounded cleanup atomic
-- across concurrent service-role calls. Caller-supplied windows remain bounded
-- by the original validation, but cannot control these storage constants.
CREATE OR REPLACE FUNCTION public.member_password_check_rate_limit(
  p_key_hash TEXT,
  p_max_attempts INTEGER DEFAULT 8,
  p_window_seconds INTEGER DEFAULT 900,
  p_block_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.member_password_rate_limits;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_row_count BIGINT;
  v_storage_cap CONSTANT INTEGER := 10000;
  v_cleanup_batch CONSTANT INTEGER := 100;
  v_limiter_lock CONSTANT BIGINT := 731249318;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_max_attempts IS NULL OR p_window_seconds IS NULL OR p_block_seconds IS NULL
     OR p_max_attempts < 1 OR p_max_attempts > 1000
     OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_block_seconds < 1 OR p_block_seconds > 86400 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_KEY';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(v_limiter_lock);

  -- Retain at least one day of inactivity. Both the fixed retention age and
  -- the expired window are required; an active block is never deleted.
  DELETE FROM public.member_password_rate_limits AS stale
  WHERE stale.key_hash IN (
    SELECT candidate.key_hash
    FROM public.member_password_rate_limits AS candidate
    WHERE candidate.updated_at <= v_now - pg_catalog.make_interval(days => 1)
      AND candidate.window_started_at <= v_now - pg_catalog.make_interval(days => 1)
      AND (candidate.blocked_until IS NULL OR candidate.blocked_until <= v_now)
    ORDER BY candidate.updated_at ASC
    LIMIT v_cleanup_batch
  );

  -- Existing rows continue to work even when the bounded table is full.
  SELECT * INTO v_row
  FROM public.member_password_rate_limits
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT count(*) INTO v_row_count
    FROM (SELECT 1 FROM public.member_password_rate_limits LIMIT v_storage_cap) AS bounded_rows;
    IF v_row_count >= v_storage_cap THEN
      RAISE EXCEPTION 'RATE_LIMIT_STORAGE_FULL';
    END IF;

    INSERT INTO public.member_password_rate_limits (key_hash, window_started_at, attempts, blocked_until, updated_at)
    VALUES (p_key_hash, v_now, 1, NULL, v_now)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.member_password_rate_limits AS current_row
    SET window_started_at = CASE
          WHEN current_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            THEN v_now ELSE current_row.window_started_at END,
        attempts = CASE
          WHEN current_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            THEN 1 ELSE current_row.attempts + 1 END,
        blocked_until = CASE
          WHEN current_row.blocked_until IS NOT NULL AND current_row.blocked_until > v_now
            THEN current_row.blocked_until
          WHEN current_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            THEN NULL
          WHEN current_row.attempts + 1 >= p_max_attempts
            THEN v_now + pg_catalog.make_interval(secs => p_block_seconds)
          ELSE NULL END,
        updated_at = v_now
    WHERE current_row.key_hash = p_key_hash
    RETURNING current_row.* INTO v_row;
  END IF;

  RETURN COALESCE(v_row.blocked_until > v_now, false) AND v_row.attempts >= p_max_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.member_password_check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

COMMIT;
