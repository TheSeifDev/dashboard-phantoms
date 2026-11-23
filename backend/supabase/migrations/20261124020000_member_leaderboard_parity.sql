-- Round 25 audit fixes: leaderboard parity with the admin board + device-session write throttling.
--
-- 1) get_member_leaderboard now mirrors /admin/ranking exactly:
--    * ranks every member (the admin board never filtered work_status),
--    * treats completion_rank = 0/NULL as "unranked" and sorts it after ranked
--      members, then falls back to created_at DESC — the same branch order as
--      compareMemberBonusRank()/compareTieBreakers() in the frontend,
--    * accepts the same [B:±n] marker as calculateBonus() (up to 18 digits),
--    * aggregates notes and teams once instead of one correlated subquery per
--      member, and caps the payload at the top 500 while still reporting the
--      real roster size and the caller's own row.
--
-- 2) assert_member_device only refreshes last_seen_at when it is older than five
--    minutes, so read RPCs stop writing WAL on every focus/refetch. Validity is
--    now checked before the write, so a non-stale session still passes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_member_leaderboard(
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows JSONB;
  v_me JSONB;
  v_roster INT;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  WITH bonus_totals AS (
    SELECT n.target_member_id AS member_id,
           SUM((regexp_match(n.text, '\[B:([+-]?[0-9]{1,18})\]'))[1]::BIGINT) AS bonus
    FROM public.notes n
    WHERE n.target_member_id IS NOT NULL
      AND n.text ~ '\[B:[+-]?[0-9]{1,18}\]'
    GROUP BY n.target_member_id
  ),
  team_totals AS (
    SELECT tm.member_id,
           jsonb_agg(t.name ORDER BY t.name) AS teams
    FROM public.team_memberships tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.status = 'active'
      AND COALESCE(t.is_active, true)
    GROUP BY tm.member_id
  ),
  scored AS (
    SELECT
      m.id AS member_id,
      m.full_name,
      m.completion_rank,
      m.created_at,
      m.bonus_infinite,
      COALESCE(b.bonus, 0) AS bonus,
      COALESCE(tt.teams, '[]'::JSONB) AS teams
    FROM public.members m
    LEFT JOIN bonus_totals b ON b.member_id = m.id
    LEFT JOIN team_totals tt ON tt.member_id = m.id
  ),
  ranked AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (
        ORDER BY
          s.bonus_infinite DESC,
          -- compareMemberBonusRank() skips the bonus comparison for unlimited
          -- members and goes straight to the tie-breakers, so the bonus key has
          -- to be NULL (ignored) for them or two unlimited members would rank
          -- differently in the portal and in the admin board.
          (CASE WHEN s.bonus_infinite THEN NULL ELSE s.bonus END) DESC NULLS LAST,
          (COALESCE(s.completion_rank, 0) = 0) ASC,
          s.completion_rank ASC,
          s.created_at DESC,
          s.member_id ASC
      ) AS rank,
      (s.member_id = p_member_id) AS is_me
    FROM scored s
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'member_id', page.member_id,
          'full_name', page.full_name,
          'bonus', page.bonus,
          'rank', page.rank,
          'bonus_infinite', page.bonus_infinite,
          'is_me', page.is_me,
          'teams', page.teams
        )
        ORDER BY page.rank
      )
      FROM (SELECT * FROM ranked ORDER BY rank LIMIT 500) AS page
    ), '[]'::JSONB),
    COALESCE((SELECT MAX(rank) FROM ranked), 0),
    (
      SELECT jsonb_build_object(
        'member_id', mine.member_id,
        'full_name', mine.full_name,
        'bonus', mine.bonus,
        'rank', mine.rank,
        'bonus_infinite', mine.bonus_infinite,
        'teams', mine.teams
      )
      FROM ranked mine
      WHERE mine.is_me
      LIMIT 1
    )
  INTO v_rows, v_roster, v_me;

  RETURN jsonb_build_object(
    'roster_size', v_roster,
    'generated_at', now(),
    'me', v_me,
    'rows', v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.get_member_leaderboard(BIGINT, TEXT) IS
  'Member-facing team leaderboard. Mirrors the admin ranking (every member, completion_rank 0 = unranked, infinite bonus first) and is guarded by the member device token. Payload is capped at the top 500 rows; roster_size reports the full count.';

-- anon is intentional: the device token is the real gate, matching every other
-- member RPC. service_role stays revoked because the guard needs a member
-- session or an admin identity, so a service-role call would always fail closed.
REVOKE ALL ON FUNCTION public.get_member_leaderboard(BIGINT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_leaderboard(BIGINT, TEXT) TO anon, authenticated;

-- Device sessions: validity first, then a throttled last_seen_at refresh.
CREATE OR REPLACE FUNCTION public.assert_member_device(p_member_id BIGINT, p_device_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token_hash TEXT;
  v_auth_user_id UUID;
  v_ready BOOLEAN;
  v_status TEXT;
BEGIN
  IF p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  IF p_device_token IS NULL OR pg_catalog.btrim(p_device_token) = '' OR pg_catalog.char_length(p_device_token) > 128 THEN RAISE EXCEPTION 'DEVICE_REQUIRED'; END IF;
  IF NOT public.is_admin() THEN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_member_live_auth_session(); END IF;
    SELECT b.auth_user_id, b.password_ready, m.work_status INTO v_auth_user_id, v_ready, v_status
    FROM public.member_auth_bindings AS b JOIN public.members AS m ON m.id = b.member_id
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE b.member_id = p_member_id
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
      AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
      AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email';
    IF v_auth_user_id IS NULL OR v_auth_user_id IS DISTINCT FROM auth.uid() OR NOT COALESCE(v_ready, false)
       OR COALESCE(v_status, '') <> 'active'
       OR EXISTS (SELECT 1 FROM public.member_password_invitations WHERE member_id = p_member_id AND status IN ('reserved', 'review_required')) THEN
      RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED';
    END IF;
  END IF;
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
  IF NOT EXISTS (
    SELECT 1 FROM public.member_device_sessions AS s
    WHERE s.member_id = p_member_id
      AND s.token_hash = v_token_hash
      AND s.last_seen_at >= pg_catalog.now() - INTERVAL '90 days'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id) THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
    RAISE EXCEPTION 'DEVICE_REQUIRED';
  END IF;
  -- Throttled touch: at most one write per session every five minutes.
  UPDATE public.member_device_sessions AS s
  SET last_seen_at = pg_catalog.now()
  WHERE s.member_id = p_member_id
    AND s.token_hash = v_token_hash
    AND s.last_seen_at < pg_catalog.now() - INTERVAL '5 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_member_device(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

COMMIT;
