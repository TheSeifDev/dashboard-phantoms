-- 20261121144600 — Exclude only Supabase-owned storage.vector_indexes from the dynamic lock sweep.
-- storage.objects remains in the explicit lock list; this migration changes no application rows.
DO $repair$
DECLARE
  v_definition TEXT;
  v_old_filter TEXT := 'AND ns.nspname <> ''_realtime''';
  v_new_filter TEXT := 'AND ns.nspname <> ''_realtime'' AND NOT (ns.nspname=''storage'' AND rel.relname=''vector_indexes'')';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.owner_member_erasure_execute_database(uuid,bigint,uuid,jsonb,text,text)'::pg_catalog.regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_new_filter) > 0 THEN
    NULL; -- Already repaired: keep migration safe for the corrected local chain.
  ELSIF pg_catalog.strpos(v_definition, v_old_filter) > 0 THEN
    EXECUTE pg_catalog.replace(v_definition, v_old_filter, v_new_filter);
  ELSE
    RAISE EXCEPTION 'ERASURE_STORAGE_VECTOR_FILTER_UNEXPECTED';
  END IF;
END
$repair$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) TO authenticated;
