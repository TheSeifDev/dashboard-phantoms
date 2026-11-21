-- 20261121143800 — Exclude Supabase-owned _realtime metadata from the identity lock sweep.
-- This changes only the SECURITY DEFINER function definition and grants; no application rows are read or changed.
DO $repair$
DECLARE
  v_definition TEXT;
  v_old_filter TEXT := 'AND NOT (ns.nspname=''_realtime'' AND rel.relname IN (''extensions'',''feature_flags''))';
  v_new_filter TEXT := 'AND ns.nspname <> ''_realtime''';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.owner_member_erasure_execute_database(uuid,bigint,uuid,jsonb,text,text)'::pg_catalog.regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_old_filter) > 0
     AND pg_catalog.strpos(v_definition, v_new_filter) = 0 THEN
    EXECUTE pg_catalog.replace(v_definition, v_old_filter, v_new_filter);
  ELSIF pg_catalog.strpos(v_definition, v_new_filter) > 0
        AND pg_catalog.strpos(v_definition, v_old_filter) = 0 THEN
    NULL; -- Already repaired: keep migration safe for the corrected local chain.
  ELSE
    RAISE EXCEPTION 'ERASURE_REALTIME_SCHEMA_FILTER_UNEXPECTED';
  END IF;
END
$repair$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) TO authenticated;
