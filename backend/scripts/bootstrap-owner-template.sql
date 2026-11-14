-- =========================================================================
-- PHANTOMS — Initial Owner Bootstrap SQL Template
-- =========================================================================
-- Run this template in Supabase SQL Editor AFTER all migrations are applied.
--
-- Security Rules:
-- 1. Replace the placeholder UUID with your confirmed administrator Auth UUID.
-- 2. Never commit actual production UUIDs or credentials to version control.
-- 3. The script verifies that the user exists in auth.users and is email-confirmed.
-- 4. The script is idempotent if run again with the same owner UUID.
-- 5. The script terminates safely if a different owner already exists.
-- =========================================================================

DO $$
DECLARE
  -- REPLACE WITH YOUR REAL AUTH UUID (e.g. from Supabase Dashboard -> Authentication -> Users)
  v_owner_id UUID := '00000000-0000-0000-0000-000000000000'::uuid;

  v_email TEXT;
  v_confirmed_at TIMESTAMPTZ;
  v_existing_owner UUID;
  v_all_permissions CONSTANT JSONB := '{
    "dashboard": true,
    "members": true,
    "tasks": true,
    "ranking": true,
    "notes": true,
    "announcements": true,
    "whatsapp": true,
    "ai_assistant": true
  }'::jsonb;
BEGIN
  -- 1. Validation of input placeholder
  IF v_owner_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'CONFIG_ERROR: Please replace v_owner_id with your real administrator Auth UUID.';
  END IF;

  -- 2. Verify target user existence in auth.users
  SELECT email, email_confirmed_at INTO v_email, v_confirmed_at
  FROM auth.users
  WHERE id = v_owner_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_FOUND: The specified UUID does not exist in auth.users.';
  END IF;

  -- 3. Verify that the email is confirmed
  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_UNCONFIRMED: The specified account email (%) has not been confirmed yet.', v_email;
  END IF;

  -- 4. Verify admin_accounts table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_accounts'
  ) THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND: public.admin_accounts does not exist. Apply all migrations first.';
  END IF;

  -- 5. Check if an Owner is already registered
  SELECT user_id INTO v_existing_owner
  FROM public.admin_accounts
  WHERE role = 'owner';

  IF v_existing_owner IS NOT NULL THEN
    IF v_existing_owner = v_owner_id THEN
      RAISE NOTICE 'IDEMPOTENT: Account (UUID %) is already registered as the system Owner.', v_owner_id;
      RETURN;
    ELSE
      RAISE EXCEPTION 'CONFLICTING_OWNER_EXISTS: A different Owner is already registered. Aborting.';
    END IF;
  END IF;

  -- 6. Insert initial Owner record
  INSERT INTO public.admin_accounts (user_id, role, created_by, permissions)
  VALUES (v_owner_id, 'owner', NULL, v_all_permissions)
  ON CONFLICT (user_id) DO UPDATE
  SET role = 'owner', permissions = v_all_permissions;

  RAISE NOTICE 'SUCCESS: Account (UUID %) successfully linked to public.admin_accounts as Owner.', v_owner_id;
END $$;
