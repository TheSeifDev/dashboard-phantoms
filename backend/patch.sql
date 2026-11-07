-- ==========================================================
-- DEPRECATED & QUARANTINED (DO NOT EXECUTE)
-- This file contains obsolete pre-0013 logic that overwrites
-- the multi-device session architecture and breaks member sessions.
-- Use forward migrations in backend/migrations/ (0001 through 0022).
-- ==========================================================
DO $$
BEGIN
  RAISE EXCEPTION 'QUARANTINED: backend/patch.sql is obsolete and must not be executed. Use migrations in backend/migrations/.';
END;
$$;
