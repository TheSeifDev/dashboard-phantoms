-- 0024 — Extend the authenticated member projection without changing table or RLS grants.
BEGIN;

GRANT SELECT (
  team_notes,
  residence,
  work_conditions,
  phone,
  gender,
  bonus_infinite,
  custom_fields
) ON public.members TO authenticated;

COMMIT;
