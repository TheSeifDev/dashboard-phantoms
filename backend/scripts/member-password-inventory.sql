-- PHANTOMS member-password operator inventory (read-only)
--
-- This file is an inspection query, not a migration and not an operator write
-- interface. Run only against an explicitly selected disposable/local or
-- separately approved read replica as a role allowed to inspect public and
-- auth schemas. It never returns encrypted_password, token_hash, plaintext
-- tokens, raw Auth metadata, invitation notes, or member_password_audit.details.
--
-- The classifications intentionally overlap. In particular, a member can be
-- member_without_auth_binding and auth_email_candidate_unbound at the same
-- time; the email candidate is not an ownership decision.
--
-- psql overrides (all are safely quoted below):
--   current_operation: all | member | auth | invitation
--   member_limit/member_offset, auth_limit/auth_offset, invitation_limit/invitation_offset
--   selected_member_id, selected_auth_user_id, selected_invitation_id

\set ON_ERROR_STOP on
\if :{?current_operation}
\else
\set current_operation all
\endif
\if :{?member_limit}
\else
\set member_limit 100
\endif
\if :{?member_offset}
\else
\set member_offset 0
\endif
\if :{?auth_limit}
\else
\set auth_limit 100
\endif
\if :{?auth_offset}
\else
\set auth_offset 0
\endif
\if :{?invitation_limit}
\else
\set invitation_limit 100
\endif
\if :{?invitation_offset}
\else
\set invitation_offset 0
\endif
\if :{?selected_member_id}
\else
\set selected_member_id ''
\endif
\if :{?selected_auth_user_id}
\else
\set selected_auth_user_id ''
\endif
\if :{?selected_invitation_id}
\else
\set selected_invitation_id ''
\endif

BEGIN;
SET TRANSACTION READ ONLY;

-- psql does not interpolate variables inside a dollar-quoted DO body. Copy
-- each safely quoted psql value into a transaction-local custom setting first;
-- the guard below reads only those settings and validates before any inventory
-- query. Numeric values are quoted by psql and then cast; IDs must be
-- decimal/UUID-shaped before they are used.
SELECT set_config('phantoms_inventory.current_operation', :'current_operation', true),
       set_config('phantoms_inventory.member_limit', :'member_limit', true),
       set_config('phantoms_inventory.member_offset', :'member_offset', true),
       set_config('phantoms_inventory.auth_limit', :'auth_limit', true),
       set_config('phantoms_inventory.auth_offset', :'auth_offset', true),
       set_config('phantoms_inventory.invitation_limit', :'invitation_limit', true),
       set_config('phantoms_inventory.invitation_offset', :'invitation_offset', true),
       set_config('phantoms_inventory.selected_member_id', :'selected_member_id', true),
       set_config('phantoms_inventory.selected_auth_user_id', :'selected_auth_user_id', true),
       set_config('phantoms_inventory.selected_invitation_id', :'selected_invitation_id', true)
LIMIT 1;

DO $guard$
DECLARE
  v_operation TEXT := current_setting('phantoms_inventory.current_operation');
  v_member_limit INTEGER := NULLIF(current_setting('phantoms_inventory.member_limit'), '')::INTEGER;
  v_member_offset INTEGER := NULLIF(current_setting('phantoms_inventory.member_offset'), '')::INTEGER;
  v_auth_limit INTEGER := NULLIF(current_setting('phantoms_inventory.auth_limit'), '')::INTEGER;
  v_auth_offset INTEGER := NULLIF(current_setting('phantoms_inventory.auth_offset'), '')::INTEGER;
  v_invitation_limit INTEGER := NULLIF(current_setting('phantoms_inventory.invitation_limit'), '')::INTEGER;
  v_invitation_offset INTEGER := NULLIF(current_setting('phantoms_inventory.invitation_offset'), '')::INTEGER;
  v_member_id TEXT := NULLIF(current_setting('phantoms_inventory.selected_member_id'), '');
  v_auth_id TEXT := NULLIF(current_setting('phantoms_inventory.selected_auth_user_id'), '');
  v_invitation_id TEXT := NULLIF(current_setting('phantoms_inventory.selected_invitation_id'), '');
BEGIN
  IF v_operation NOT IN ('all', 'member', 'auth', 'invitation')
     OR v_member_limit IS NULL OR v_member_limit NOT BETWEEN 1 AND 1000
     OR v_member_offset IS NULL OR v_member_offset < 0
     OR v_auth_limit IS NULL OR v_auth_limit NOT BETWEEN 1 AND 1000
     OR v_auth_offset IS NULL OR v_auth_offset < 0
     OR v_invitation_limit IS NULL OR v_invitation_limit NOT BETWEEN 1 AND 1000
     OR v_invitation_offset IS NULL OR v_invitation_offset < 0 THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_INPUT: operation/limit/offset';
  END IF;
  IF v_member_id IS NOT NULL AND v_member_id !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_INPUT: selected_member_id';
  END IF;
  IF v_auth_id IS NOT NULL AND v_auth_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_INPUT: selected_auth_user_id';
  END IF;
  IF v_invitation_id IS NOT NULL AND v_invitation_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_INPUT: selected_invitation_id';
  END IF;
END
$guard$;

SELECT :'current_operation' AS current_operation,
       current_setting('transaction_read_only') AS transaction_read_only,
       NULLIF(:'selected_member_id', '') AS selected_member_id,
       NULLIF(:'selected_auth_user_id', '') AS selected_auth_user_id,
       NULLIF(:'selected_invitation_id', '') AS selected_invitation_id,
       :'member_limit'::INTEGER AS member_limit,
       :'member_offset'::INTEGER AS member_offset,
       :'auth_limit'::INTEGER AS auth_limit,
       :'auth_offset'::INTEGER AS auth_offset,
       :'invitation_limit'::INTEGER AS invitation_limit,
       :'invitation_offset'::INTEGER AS invitation_offset
LIMIT 1;

-- 1. Member-centric inventory. The email-only Auth candidate columns are
-- deliberately separate from the exact binding columns and never assert
-- ownership. Password state is boolean only.
WITH params AS (
  SELECT :'current_operation'::TEXT AS operation,
         :'member_limit'::INTEGER AS row_limit,
         :'member_offset'::INTEGER AS row_offset,
         NULLIF(:'selected_member_id', '')::BIGINT AS selected_member_id
),
member_page AS (
  SELECT m.id, m.email, m.full_name, m.work_status
  FROM public.members AS m
  CROSS JOIN params AS p
  WHERE p.operation IN ('all', 'member')
    AND (p.selected_member_id IS NULL OR m.id = p.selected_member_id)
),
auth_email_counts AS (
  SELECT lower(btrim(u.email)) AS normalized_email, count(*)::INTEGER AS auth_email_count
  FROM auth.users AS u
  WHERE u.email IS NOT NULL
  GROUP BY lower(btrim(u.email))
),
binding_view AS (
  SELECT b.member_id, b.auth_user_id, b.normalized_email AS binding_email,
         (b.normalized_email = lower(btrim(m.email))) AS binding_email_matches_member,
         (u.id IS NOT NULL) AS exact_auth_row_exists,
         (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
         (coalesce(u.encrypted_password, '') <> '') AS has_password,
         (u.banned_until IS NOT NULL) AS auth_banned,
         (u.deleted_at IS NOT NULL) AS auth_deleted,
         coalesce(u.is_sso_user, false) AS auth_sso,
         (coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') AS has_email_provider,
         EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = b.auth_user_id) AS admin_overlap
  FROM public.member_auth_bindings AS b
  JOIN member_page AS m ON m.id = b.member_id
  LEFT JOIN auth.users AS u ON u.id = b.auth_user_id
),invitation_flags AS (
  SELECT i.member_id,
         bool_or(i.status IN ('reserved', 'review_required')) AS has_reserved_or_review,
         bool_or(i.status = 'reserved') AS has_reserved,
         bool_or(i.status = 'review_required') AS has_review_required
  FROM public.member_password_invitations AS i
  JOIN member_page AS m ON m.id = i.member_id
  GROUP BY i.member_id
)
SELECT m.id AS member_id,
       lower(btrim(m.email)) AS normalized_member_email,
       m.full_name,
       m.work_status,
       (b.member_id IS NOT NULL) AS member_with_auth_binding,
       (b.member_id IS NULL) AS member_without_auth_binding,
       b.auth_user_id AS exact_bound_auth_user_id,
       b.binding_email AS exact_binding_email,
       coalesce(b.binding_email_matches_member, false) AS binding_email_matches_member,
       coalesce(b.exact_auth_row_exists, false) AS exact_bound_auth_row_exists,
       coalesce(b.email_confirmed, false) AS bound_email_confirmed,
       coalesce(b.has_password, false) AS bound_has_password,
       coalesce(b.auth_banned, false) AS bound_auth_banned,
       coalesce(b.auth_deleted, false) AS bound_auth_deleted,
       coalesce(b.auth_sso, false) AS bound_auth_sso,
       coalesce(b.has_email_provider, false) AS bound_has_email_provider,
       coalesce(b.admin_overlap, false) AS admin_member_overlap_excluded,
       coalesce(aec.auth_email_count, 0) AS case_insensitive_auth_email_count,
       (coalesce(aec.auth_email_count, 0) > 0 AND b.member_id IS NULL) AS auth_email_candidate_unbound,
       (coalesce(aec.auth_email_count, 0) > 1) AS duplicate_or_ambiguous_email,
       (m.work_status IS DISTINCT FROM 'active') AS disabled_or_revoked_member,
       (b.member_id IS NOT NULL AND b.email_confirmed IS FALSE) AS unconfirmed_bound_identity,
       (b.member_id IS NOT NULL AND b.email_confirmed AND b.has_password IS FALSE) AS confirmed_passwordless_bound_identity,
       (b.member_id IS NOT NULL AND b.has_password) AS passworded_bound_identity,
       coalesce(invf.has_reserved_or_review, false) AS reserved_or_review_required,
       coalesce(invf.has_reserved, false) AS reserved_operation_present,
       coalesce(invf.has_review_required, false) AS review_required_operation_present,
       (b.member_id IS NOT NULL
        AND b.binding_email_matches_member
        AND b.exact_auth_row_exists
        AND b.email_confirmed
        AND b.has_password
        AND NOT b.auth_banned
        AND NOT b.auth_deleted
        AND NOT b.auth_sso
        AND b.has_email_provider
        AND NOT b.admin_overlap
        AND m.work_status = 'active'
        AND NOT coalesce(invf.has_reserved_or_review, false)) AS current_member_password_access_candidate
FROM member_page AS m
LEFT JOIN binding_view AS b ON b.member_id = m.id
LEFT JOIN auth_email_counts AS aec ON aec.normalized_email = lower(btrim(m.email))
LEFT JOIN invitation_flags AS invf ON invf.member_id = m.id
ORDER BY m.id
LIMIT (SELECT row_limit FROM params)
OFFSET (SELECT row_offset FROM params);

-- 2. Auth-centric inventory. This is the source for unassociated identities,
-- duplicate normalized emails, and Admin/Member overlap. No email match alone
-- creates a binding or an ownership claim.
WITH params AS (
  SELECT :'current_operation'::TEXT AS operation,
         :'auth_limit'::INTEGER AS row_limit,
         :'auth_offset'::INTEGER AS row_offset,
         NULLIF(:'selected_auth_user_id', '')::UUID AS selected_auth_user_id
),
auth_page AS (
  SELECT u.id, u.email,
         (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
         (coalesce(u.encrypted_password, '') <> '') AS has_password,
         (u.banned_until IS NOT NULL) AS auth_banned,
         (u.deleted_at IS NOT NULL) AS auth_deleted,
         coalesce(u.is_sso_user, false) AS auth_sso,
         (coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') AS has_email_provider
  FROM auth.users AS u
  CROSS JOIN params AS p
  WHERE p.operation IN ('all', 'auth')
    AND (p.selected_auth_user_id IS NULL OR u.id = p.selected_auth_user_id)
),
auth_email_counts AS (
  SELECT lower(btrim(u.email)) AS normalized_email, count(*)::INTEGER AS auth_email_count
  FROM auth.users AS u
  WHERE u.email IS NOT NULL
  GROUP BY lower(btrim(u.email))
),
binding_view AS (
  SELECT b.auth_user_id, b.member_id, b.normalized_email AS binding_email,
         m.email AS member_email, m.work_status AS member_work_status,
         (b.normalized_email = lower(btrim(coalesce(m.email, '')))) AS binding_email_matches_member,
         (lower(btrim(coalesce(u.email, ''))) = b.normalized_email) AS binding_email_matches_auth
  FROM public.member_auth_bindings AS b
  LEFT JOIN public.members AS m ON m.id = b.member_id
  LEFT JOIN auth.users AS u ON u.id = b.auth_user_id
)
SELECT u.id AS auth_user_id,
       lower(btrim(u.email)) AS normalized_auth_email,
       u.email_confirmed,
       u.has_password,
       u.auth_banned,
       u.auth_deleted,
       u.auth_sso AS is_sso_user,
       u.has_email_provider,
       coalesce(aec.auth_email_count, 0) AS case_insensitive_auth_email_count,
       (coalesce(aec.auth_email_count, 0) > 1) AS duplicate_or_ambiguous_email,
       (b.auth_user_id IS NOT NULL) AS has_exact_member_binding,
       b.member_id AS exact_bound_member_id,
       b.binding_email AS exact_binding_email,
       coalesce(b.binding_email_matches_member, false) AS binding_email_matches_member,
       coalesce(b.binding_email_matches_auth, false) AS binding_email_matches_auth,
       (b.auth_user_id IS NULL) AS auth_identity_unassociated,
       EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = u.id) AS admin_identity,
       (EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = u.id)
        AND b.auth_user_id IS NOT NULL) AS admin_member_overlap_excluded,
       (NOT u.email_confirmed) AS unconfirmed_identity,
       (u.email_confirmed AND NOT u.has_password) AS confirmed_passwordless_identity,
       u.has_password AS passworded_identity,
       (b.member_id IS NOT NULL AND b.member_work_status IS DISTINCT FROM 'active') AS disabled_or_revoked_bound_member,
       (coalesce(aec.auth_email_count, 0) > 1
        OR (b.auth_user_id IS NOT NULL AND (NOT coalesce(b.binding_email_matches_member, false)
                                           OR NOT coalesce(b.binding_email_matches_auth, false)))) AS duplicate_or_ambiguous_binding,
       (b.auth_user_id IS NOT NULL
        AND b.binding_email_matches_member
        AND b.binding_email_matches_auth
        AND u.email_confirmed
        AND u.has_password
        AND NOT u.auth_banned
        AND NOT u.auth_deleted
        AND NOT u.auth_sso
        AND u.has_email_provider
        AND b.member_work_status = 'active'
        AND NOT EXISTS (SELECT 1 FROM public.member_password_invitations AS i
                        WHERE i.member_id = b.member_id
                          AND i.status IN ('reserved', 'review_required'))
        AND NOT EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = u.id)) AS current_member_password_access_candidate
FROM auth_page AS u
LEFT JOIN auth_email_counts AS aec ON aec.normalized_email = lower(btrim(u.email))
LEFT JOIN binding_view AS b ON b.auth_user_id = u.id
ORDER BY u.id
LIMIT (SELECT row_limit FROM params)
OFFSET (SELECT row_offset FROM params);

-- 3. Invitation/reconciliation inventory. It exposes exact IDs and safe
-- booleans only. A reserved or review_required row is never a browser action,
-- retry instruction, release candidate, or automatic completion decision.
WITH params AS (
  SELECT :'current_operation'::TEXT AS operation,
         :'invitation_limit'::INTEGER AS row_limit,
         :'invitation_offset'::INTEGER AS row_offset,
         NULLIF(:'selected_member_id', '')::BIGINT AS selected_member_id,
         NULLIF(:'selected_invitation_id', '')::UUID AS selected_invitation_id
),
invitation_page AS (
  SELECT i.id, i.member_id, i.normalized_email, i.purpose, i.status,
         i.expected_auth_user_id, i.auth_user_id, i.auth_write_completed_at,
         i.auth_write_user_id, i.claim_id, i.claimed_at, i.created_at,
         i.completed_at, i.review_required_at, i.revoked_at, i.expired_at, i.used_at
  FROM public.member_password_invitations AS i
  CROSS JOIN params AS p
  WHERE p.operation IN ('all', 'invitation')
    AND (p.selected_member_id IS NULL OR i.member_id = p.selected_member_id)
    AND (p.selected_invitation_id IS NULL OR i.id = p.selected_invitation_id)
),
marker_state AS (
  SELECT i.*,
         m.email AS member_email,
         m.work_status AS member_work_status,
         b.auth_user_id AS binding_auth_user_id,
         (u.id IS NOT NULL) AS marker_auth_exists,
         (lower(btrim(coalesce(u.email, ''))) = i.normalized_email) AS marker_email_matches,
         (coalesce(u.encrypted_password, '') <> '') AS marker_auth_has_password,
         (u.email_confirmed_at IS NOT NULL) AS marker_auth_confirmed,
         (u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_sso_user, false)
          AND (coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email')) AS marker_auth_usable,
         (i.expected_auth_user_id IS NULL OR i.expected_auth_user_id = i.auth_write_user_id) AS marker_matches_expected
  FROM invitation_page AS i
  LEFT JOIN public.members AS m ON m.id = i.member_id
  LEFT JOIN public.member_auth_bindings AS b ON b.member_id = i.member_id
  LEFT JOIN auth.users AS u ON u.id = i.auth_write_user_id
),
with_audit AS (
  SELECT ms.*,
         EXISTS (SELECT 1 FROM public.member_password_audit AS a WHERE a.invitation_id = ms.id) AS audit_event_present,
         (SELECT a.action
          FROM public.member_password_audit AS a
          WHERE a.invitation_id = ms.id
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 1) AS latest_audit_action
  FROM marker_state AS ms
)
SELECT id AS invitation_id,
       member_id,
       normalized_email,
       purpose,
       status,
       expected_auth_user_id,
       auth_user_id AS completed_auth_user_id,
       claim_id,
       claimed_at,
       auth_write_completed_at,
       auth_write_user_id AS marker_auth_user_id,
       (auth_write_completed_at IS NULL OR auth_write_user_id IS NULL) AS marker_missing,
       (auth_write_completed_at IS NOT NULL AND auth_write_user_id IS NOT NULL
        AND marker_auth_exists
        AND marker_email_matches
        AND marker_auth_has_password
        AND marker_auth_confirmed
        AND marker_auth_usable
        AND marker_matches_expected) AS marker_verified,
       (auth_write_completed_at IS NOT NULL AND auth_write_user_id IS NOT NULL
        AND NOT (marker_auth_exists
                 AND marker_email_matches
                 AND marker_auth_has_password
                 AND marker_auth_confirmed
                 AND marker_auth_usable
                 AND marker_matches_expected)) AS marker_wrong_or_auth_missing,
       marker_auth_exists,
       marker_email_matches,
       marker_auth_has_password,
       marker_auth_confirmed,
       marker_auth_usable,
       marker_matches_expected,
       member_work_status,
       binding_auth_user_id,
       (binding_auth_user_id IS NOT NULL AND binding_auth_user_id = coalesce(auth_user_id, auth_write_user_id)) AS exact_binding_matches_operation,
       audit_event_present,
       latest_audit_action,
       (status IN ('reserved', 'review_required')) AS reserved_or_review_required,
       (status = 'complete') AS complete_terminal,
       (status IN ('revoked', 'expired')) AS revoked_or_expired_terminal,
       CASE
         WHEN status = 'review_required' THEN 'quarantine_review_required'
         WHEN status = 'reserved' THEN 'reserved_no_automatic_retry_or_release'
         WHEN status = 'complete' THEN 'complete_verify_current_access_separately'
         WHEN status IN ('revoked', 'expired') THEN 'terminal_denied'
         ELSE 'pending_or_other'
       END AS operator_state
FROM with_audit
ORDER BY created_at, id
LIMIT (SELECT row_limit FROM params)
OFFSET (SELECT row_offset FROM params);

COMMIT;
