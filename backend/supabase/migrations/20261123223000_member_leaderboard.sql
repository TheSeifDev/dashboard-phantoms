-- Round 25: member-scoped team leaderboard for the portal.
-- Members cannot read public.members / public.notes directly (RLS revoked),
-- so the leaderboard is computed server-side and returned as a single JSONB
-- payload guarded by the member device token. VOLATILE on purpose:
-- assert_member_device() refreshes member_device_sessions.last_seen_at.

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
  v_teams JSONB;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  WITH scored AS (
    SELECT
      m.id AS member_id,
      m.full_name,
      m.completion_rank,
      m.created_at,
      m.bonus_infinite,
      COALESCE((
        SELECT SUM((regexp_match(n.text, '\[B:([+-]?[0-9]{1,9})\]'))[1]::BIGINT)
        FROM public.notes n
        WHERE n.target_member_id = m.id
          AND n.text ~ '\[B:[+-]?[0-9]{1,9}\]'
      ), 0) AS bonus
    FROM public.members m
    WHERE COALESCE(m.work_status, 'active') = 'active'
  ),
  ordered AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (
        ORDER BY
          s.bonus_infinite DESC,
          s.bonus DESC,
          s.completion_rank ASC NULLS LAST,
          s.created_at DESC,
          s.member_id ASC
      ) AS rank
    FROM scored s
  ),
  with_teams AS (
    SELECT
      o.*,
      COALESCE((
        SELECT jsonb_agg(t.name ORDER BY t.name)
        FROM public.team_memberships tm
        JOIN public.teams t ON t.id = tm.team_id
        WHERE tm.member_id = o.member_id
          AND tm.status = 'active'
          AND COALESCE(t.is_active, true)
      ), '[]'::JSONB) AS teams
    FROM ordered o
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'member_id', w.member_id,
        'full_name', w.full_name,
        'bonus', w.bonus,
        'rank', w.rank,
        'bonus_infinite', w.bonus_infinite,
        'is_me', w.member_id = p_member_id,
        'teams', w.teams
      )
      ORDER BY w.rank
    ), '[]'::JSONB),
    COALESCE(MAX(w.rank), 0)
  INTO v_rows, v_roster
  FROM with_teams w;

  SELECT row_to_json(t)::JSONB
  INTO v_me
  FROM (
    SELECT
      (elem->>'member_id')::BIGINT AS member_id,
      elem->>'full_name' AS full_name,
      (elem->>'bonus')::BIGINT AS bonus,
      (elem->>'rank')::INT AS rank,
      (elem->>'bonus_infinite')::BOOLEAN AS bonus_infinite,
      elem->'teams' AS teams
    FROM jsonb_array_elements(v_rows) AS elem
    WHERE (elem->>'is_me')::BOOLEAN
    LIMIT 1
  ) t;

  RETURN jsonb_build_object(
    'roster_size', v_roster,
    'generated_at', now(),
    'me', v_me,
    'rows', v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.get_member_leaderboard(BIGINT, TEXT) IS
  'Member-facing team leaderboard: bonus totals, ranks, and team names for all active members. Guarded by the member device token.';

REVOKE ALL ON FUNCTION public.get_member_leaderboard(BIGINT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_leaderboard(BIGINT, TEXT) TO authenticated;
