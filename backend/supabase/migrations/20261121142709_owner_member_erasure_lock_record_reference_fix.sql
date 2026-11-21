-- 20261121142709 — Repair the exact relation-name record reference in the erasure lock sweep.
-- This changes a function definition only; it reads/writes no application rows.
DO $repair$
DECLARE
  v_definition TEXT;
  v_has_bad_reference BOOLEAN;
  v_has_good_reference BOOLEAN;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.owner_member_erasure_execute_database(uuid,bigint,uuid,jsonb,text,text)'::pg_catalog.regprocedure
  ) INTO v_definition;
  v_has_bad_reference := pg_catalog.strpos(v_definition, 'r.nspname,rel.relname') > 0;
  v_has_good_reference := pg_catalog.strpos(v_definition, 'r.nspname,r.relname') > 0;

  IF v_has_bad_reference AND NOT v_has_good_reference THEN
    EXECUTE pg_catalog.replace(v_definition, 'r.nspname,rel.relname', 'r.nspname,r.relname');
  ELSIF v_has_good_reference AND NOT v_has_bad_reference THEN
    NULL; -- The disposable migration chain already has the corrected source form.
  ELSE
    RAISE EXCEPTION 'ERASURE_LOCK_ROW_ALIAS_UNEXPECTED';
  END IF;
END
$repair$;

REVOKE ALL ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) TO authenticated;
