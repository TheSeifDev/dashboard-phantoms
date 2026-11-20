-- Web Projects: isolated project-development domain over canonical PHANTOMS identities.
-- This migration is additive. It does not modify Internal Teams, public.tasks,
-- authentication bindings, or contribution-ledger records.
BEGIN;

-- The new feature bit is deliberately false for every existing non-owner admin.
-- Owner authorization remains implicit in the helper below; no Team permission
-- participates in Web Projects authorization.
ALTER TABLE public.admin_accounts
  ALTER COLUMN permissions SET DEFAULT
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":false}'::jsonb;
UPDATE public.admin_accounts
SET permissions = permissions || '{"web_projects":false}'::jsonb
WHERE NOT (permissions ? 'web_projects');
ALTER TABLE public.admin_accounts
  DROP CONSTRAINT IF EXISTS admin_accounts_permissions_valid;
ALTER TABLE public.admin_accounts
  ADD CONSTRAINT admin_accounts_permissions_valid CHECK (
    jsonb_typeof(permissions) = 'object'
    AND jsonb_typeof(permissions -> 'dashboard') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'members') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'tasks') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'ranking') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'notes') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'announcements') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'whatsapp') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'ai_assistant') IS NOT DISTINCT FROM 'boolean'
    AND COALESCE(jsonb_typeof(permissions -> 'web_projects') = 'boolean', TRUE)
    AND permissions - ARRAY[
      'dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant','web_projects'
    ]::text[] = '{}'::jsonb
  );

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_permission = ANY (ARRAY[
      'dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant','web_projects'
    ]::text[])
    THEN EXISTS (
      SELECT 1
      FROM public.admin_accounts AS a
      WHERE a.user_id = auth.uid()
        AND (a.role = 'owner' OR (a.role = 'admin' AND a.permissions @> jsonb_build_object(p_permission, true)))
    )
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.has_admin_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(TEXT) TO authenticated;

-- Keep the established eight-key admin editor compatible while allowing an
-- explicit ninth key. Omitting the new key preserves its existing value.
CREATE OR REPLACE FUNCTION public.admin_update_permissions(p_user_id UUID, p_permissions JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed UUID;
  v_keys CONSTANT TEXT[] := ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant'];
  v_web_projects BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'OWNER_ONLY: تعديل الصلاحيات متاح للمالك فقط.';
  END IF;
  IF p_user_id IS NULL OR EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = p_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'OWNER_IMMUTABLE: صلاحيات مالك النظام ثابتة.';
  END IF;
  IF p_permissions IS NULL
     OR jsonb_typeof(p_permissions) <> 'object'
     OR NOT (p_permissions ?& v_keys)
     OR p_permissions - v_keys - ARRAY['web_projects']::text[] <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM unnest(v_keys) AS k WHERE jsonb_typeof(p_permissions -> k) <> 'boolean')
     OR (p_permissions ? 'web_projects' AND jsonb_typeof(p_permissions -> 'web_projects') <> 'boolean') THEN
    RAISE EXCEPTION 'INVALID_PERMISSIONS: اختر صلاحية صحيحة لكل قسم.';
  END IF;
  SELECT COALESCE((a.permissions ->> 'web_projects')::boolean, false)
  INTO v_web_projects
  FROM public.admin_accounts AS a
  WHERE a.user_id = p_user_id AND a.role = 'admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.'; END IF;
  IF p_permissions ? 'web_projects' THEN
    v_web_projects := (p_permissions ->> 'web_projects')::boolean;
  END IF;
  UPDATE public.admin_accounts AS a
  SET permissions = p_permissions || jsonb_build_object('web_projects', v_web_projects)
  WHERE a.user_id = p_user_id AND a.role = 'admin'
  RETURNING a.user_id INTO v_changed;
  IF v_changed IS NULL THEN RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_permissions(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_permissions(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_account(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_user_id UUID;
  v_created_at TIMESTAMPTZ;
  v_permissions CONSTANT JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":false}'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'OWNER_ONLY: إضافة المشرفين متاحة للمالك فقط.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: اكتب بريد إلكتروني صحيح.';
  END IF;
  SELECT u.id INTO v_user_id FROM auth.users AS u WHERE lower(u.email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'ADMIN_USER_NOT_FOUND: لازم الحساب يسجل في النظام أولاً قبل إضافته كمشرف.'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user_id) THEN
    RAISE EXCEPTION 'ALREADY_ADMIN: الحساب مضاف للإدارة بالفعل.';
  END IF;
  INSERT INTO public.admin_accounts (user_id, role, created_by, permissions)
  VALUES (v_user_id, 'admin', auth.uid(), v_permissions)
  RETURNING created_at INTO v_created_at;
  RETURN jsonb_build_object(
    'user_id', v_user_id, 'email', v_email, 'role', 'admin', 'created_at', v_created_at,
    'created_by', auth.uid(), 'permissions', v_permissions
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_account(TEXT) TO authenticated;

-- Expose the Owner's implicit Web Projects access while retaining the existing
-- Internal Teams projection shape and all prior global permission semantics.
CREATE OR REPLACE FUNCTION public.get_admin_access()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_role TEXT;
  v_permissions JSONB;
  v_all_permissions CONSTANT JSONB :=
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb;
  v_teams JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'is_owner', false, 'is_team_admin', false,
      'role', NULL, 'email', NULL, 'permissions', '{}'::jsonb, 'teams', '[]'::jsonb);
  END IF;
  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;
  SELECT a.role, a.permissions INTO v_role, v_permissions
  FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;
  IF v_role = 'owner' THEN
    v_permissions := v_all_permissions;
  ELSIF v_role = 'admin' THEN
    v_permissions := COALESCE(v_permissions, '{}'::jsonb) ||
      jsonb_build_object('web_projects', COALESCE((v_permissions ->> 'web_projects')::boolean, false));
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'role', NULL, 'permissions', v_permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams FROM public.teams AS t WHERE t.is_active;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'role', a.role, 'permissions', a.permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams
    FROM public.team_admin_assignments AS a
    JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
    JOIN auth.users AS u ON u.id = a.user_id AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
    WHERE a.user_id = v_user_id;
  END IF;
  RETURN jsonb_build_object(
    'is_admin', COALESCE(v_role IN ('owner','admin'), false),
    'is_owner', COALESCE(v_role = 'owner', false),
    'is_team_admin', EXISTS (
      SELECT 1 FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
      JOIN auth.users AS u ON u.id = a.user_id
      WHERE a.user_id = v_user_id AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
    ),
    'role', v_role, 'email', v_email, 'permissions', COALESCE(v_permissions, '{}'::jsonb), 'teams', v_teams
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

CREATE TABLE public.web_program_admin_audit (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_auth_user_id UUID NOT NULL,
  target_auth_user_id UUID,
  action TEXT NOT NULL CHECK (action IN ('permission_granted','permission_revoked','idea_created','idea_reviewed','idea_conversion')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX web_program_admin_audit_time_idx ON public.web_program_admin_audit (occurred_at DESC, id);

CREATE FUNCTION public.web_prevent_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'WEB_PROJECT_APPEND_ONLY';
END;
$$;
REVOKE ALL ON FUNCTION public.web_prevent_append_only_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_program_admin_audit_no_mutation
  BEFORE UPDATE OR DELETE ON public.web_program_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.web_prevent_append_only_mutation();
CREATE TRIGGER web_program_admin_audit_no_truncate
  BEFORE TRUNCATE ON public.web_program_admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.web_prevent_append_only_mutation();

CREATE TABLE public.web_ideas (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 180),
  short_description TEXT NOT NULL CHECK (char_length(btrim(short_description)) BETWEEN 1 AND 800),
  problem_statement TEXT NOT NULL DEFAULT '',
  proposed_solution TEXT NOT NULL DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT '',
  phantoms_benefit TEXT NOT NULL DEFAULT '',
  potential_use_cases JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(potential_use_cases) = 'array'),
  suggested_tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggested_tech_stack) = 'array'),
  required_skills JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_skills) = 'array'),
  estimated_complexity TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (estimated_complexity IN ('unspecified','small','medium','large','research')),
  suggested_leader_member_id BIGINT REFERENCES public.members(id) ON DELETE RESTRICT,
  graduation_project BOOLEAN NOT NULL DEFAULT FALSE,
  supporting_documents JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supporting_documents) = 'array'),
  submitted_by_member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (review_status IN ('proposed','under_review','approved','rejected')),
  review_notes TEXT,
  reviewed_by_auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  converted_project_id UUID,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((reviewed_by_auth_user_id IS NULL) = (reviewed_at IS NULL)),
  CHECK ((converted_project_id IS NULL) = (converted_at IS NULL)),
  CHECK (review_status = 'approved' OR converted_project_id IS NULL)
);
CREATE INDEX web_ideas_submitter_idx ON public.web_ideas (submitted_by_member_id, submitted_at DESC);
CREATE INDEX web_ideas_review_idx ON public.web_ideas (review_status, submitted_at DESC);

CREATE TABLE public.web_idea_contributors (
  idea_id UUID NOT NULL REFERENCES public.web_ideas(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  responsibility TEXT NOT NULL DEFAULT '' CHECK (char_length(responsibility) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, member_id)
);

CREATE TABLE public.web_idea_reviews (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES public.web_ideas(id) ON DELETE RESTRICT,
  reviewer_auth_user_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('under_review','approved','rejected')),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX web_idea_reviews_idea_idx ON public.web_idea_reviews (idea_id, created_at DESC);

CREATE TABLE public.web_projects (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 180),
  logo_url TEXT,
  cover_image_url TEXT,
  short_description TEXT NOT NULL DEFAULT '' CHECK (char_length(short_description) <= 800),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other' CHECK (char_length(category) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','reviewing','approved','planning','active','on_hold','completed','archived','rejected')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_delivery_date DATE,
  owner_member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  lead_member_id BIGINT REFERENCES public.members(id) ON DELETE RESTRICT,
  origin_submitter_member_id BIGINT REFERENCES public.members(id) ON DELETE RESTRICT,
  source_idea_id UUID UNIQUE REFERENCES public.web_ideas(id) ON DELETE RESTRICT,
  problem_statement TEXT NOT NULL DEFAULT '',
  proposed_solution TEXT NOT NULL DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT '',
  phantoms_benefit TEXT NOT NULL DEFAULT '',
  graduation_project BOOLEAN NOT NULL DEFAULT FALSE,
  potential_use_cases JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(potential_use_cases) = 'array'),
  required_skills JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_skills) = 'array'),
  estimated_complexity TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (estimated_complexity IN ('unspecified','small','medium','large','research')),
  tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tech_stack) = 'array'),
  supporting_documents JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supporting_documents) = 'array'),
  repository_url TEXT,
  live_demo_url TEXT,
  figma_url TEXT,
  documentation_url TEXT,
  ownership_model TEXT NOT NULL DEFAULT 'undetermined'
    CHECK (ownership_model IN ('undetermined','creator_owned','joint','licensed_to_phantoms','licensed_from_phantoms','other')),
  ownership_notes TEXT NOT NULL DEFAULT '',
  license_name TEXT NOT NULL DEFAULT 'undetermined',
  attribution_notes TEXT NOT NULL DEFAULT '',
  phantoms_assets_used BOOLEAN NOT NULL DEFAULT FALSE,
  phantoms_brand_permission BOOLEAN NOT NULL DEFAULT FALSE,
  public_showcase_permission BOOLEAN NOT NULL DEFAULT FALSE,
  expected_phantoms_contribution TEXT NOT NULL DEFAULT '',
  technical_support_arrangement TEXT NOT NULL DEFAULT '',
  phantoms_integration_status TEXT NOT NULL DEFAULT 'not_integrated'
    CHECK (phantoms_integration_status IN ('not_integrated','metadata_only','planned','integrated')),
  current_agreement_version INTEGER NOT NULL DEFAULT 1 CHECK (current_agreement_version > 0),
  created_by_auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expected_delivery_date IS NULL OR expected_delivery_date >= created_at::date),
  UNIQUE (id, current_agreement_version)
);
CREATE INDEX web_projects_status_delivery_idx ON public.web_projects (status, expected_delivery_date);
CREATE INDEX web_projects_created_idx ON public.web_projects (created_at DESC, id);
CREATE INDEX web_projects_lead_idx ON public.web_projects (lead_member_id) WHERE lead_member_id IS NOT NULL;

CREATE TABLE public.web_project_agreements (
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  ownership_model TEXT NOT NULL
    CHECK (ownership_model IN ('undetermined','creator_owned','joint','licensed_to_phantoms','licensed_from_phantoms','other')),
  ownership_notes TEXT NOT NULL DEFAULT '',
  license_name TEXT NOT NULL,
  attribution_notes TEXT NOT NULL DEFAULT '',
  terms JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terms) = 'object'),
  created_by_auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version)
);
ALTER TABLE public.web_projects
  ADD CONSTRAINT web_projects_current_agreement_fk
  FOREIGN KEY (id, current_agreement_version)
  REFERENCES public.web_project_agreements(project_id, version)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX web_project_agreements_project_idx ON public.web_project_agreements (project_id, version DESC);
CREATE TRIGGER web_project_agreements_no_mutation
  BEFORE UPDATE OR DELETE ON public.web_project_agreements
  FOR EACH ROW EXECUTE FUNCTION public.web_prevent_append_only_mutation();
CREATE TRIGGER web_project_agreements_no_truncate
  BEFORE TRUNCATE ON public.web_project_agreements
  FOR EACH STATEMENT EXECUTE FUNCTION public.web_prevent_append_only_mutation();

CREATE TABLE public.web_project_members (
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('lead','contributor','viewer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','removed')),
  responsibility TEXT NOT NULL DEFAULT '' CHECK (char_length(responsibility) <= 4000),
  accepted_agreement_version INTEGER,
  agreement_accepted_at TIMESTAMPTZ,
  added_by_auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, member_id),
  CHECK ((accepted_agreement_version IS NULL) = (agreement_accepted_at IS NULL)),
  CHECK (status <> 'active' OR accepted_agreement_version IS NOT NULL),
  FOREIGN KEY (project_id, accepted_agreement_version)
    REFERENCES public.web_project_agreements(project_id, version)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX web_project_single_pending_or_active_lead_idx
  ON public.web_project_members (project_id)
  WHERE role = 'lead' AND status IN ('pending','active');
CREATE INDEX web_project_members_member_status_idx ON public.web_project_members (member_id, status, project_id);
CREATE INDEX web_project_members_project_status_idx ON public.web_project_members (project_id, status, role, member_id);
ALTER TABLE public.web_projects
  ADD CONSTRAINT web_projects_lead_membership_fk
  FOREIGN KEY (id, lead_member_id)
  REFERENCES public.web_project_members(project_id, member_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.web_project_agreement_acceptances (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  agreement_version INTEGER NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, member_id, agreement_version),
  FOREIGN KEY (project_id, member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, agreement_version) REFERENCES public.web_project_agreements(project_id, version) ON DELETE RESTRICT
);
CREATE INDEX web_project_agreement_acceptances_member_idx
  ON public.web_project_agreement_acceptances (member_id, project_id, accepted_at DESC);
CREATE TRIGGER web_project_acceptances_no_mutation
  BEFORE UPDATE OR DELETE ON public.web_project_agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.web_prevent_append_only_mutation();
CREATE TRIGGER web_project_acceptances_no_truncate
  BEFORE TRUNCATE ON public.web_project_agreement_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION public.web_prevent_append_only_mutation();

CREATE TABLE public.web_project_consents (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  agreement_version INTEGER NOT NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('phantoms_brand_assets','public_showcase')),
  granted BOOLEAN NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, agreement_version) REFERENCES public.web_project_agreements(project_id, version) ON DELETE RESTRICT
);
CREATE INDEX web_project_consents_latest_idx
  ON public.web_project_consents (project_id, member_id, agreement_version, consent_type, recorded_at DESC, id DESC);
CREATE TRIGGER web_project_consents_no_mutation
  BEFORE UPDATE OR DELETE ON public.web_project_consents
  FOR EACH ROW EXECUTE FUNCTION public.web_prevent_append_only_mutation();
CREATE TRIGGER web_project_consents_no_truncate
  BEFORE TRUNCATE ON public.web_project_consents
  FOR EACH STATEMENT EXECUTE FUNCTION public.web_prevent_append_only_mutation();

CREATE TABLE public.web_project_milestones (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 180),
  description TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '' CHECK (char_length(phase) <= 120),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','completed','cancelled')),
  start_date DATE,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_by_auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
  CHECK (completed_at IS NULL OR status = 'completed'),
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_milestones_project_date_idx
  ON public.web_project_milestones (project_id, start_date, due_date, status);

CREATE TABLE public.web_project_milestone_dependencies (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  milestone_id UUID NOT NULL,
  depends_on_milestone_id UUID NOT NULL,
  created_by_auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (milestone_id <> depends_on_milestone_id),
  UNIQUE (project_id, milestone_id, depends_on_milestone_id),
  FOREIGN KEY (project_id, milestone_id) REFERENCES public.web_project_milestones(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, depends_on_milestone_id) REFERENCES public.web_project_milestones(project_id, id) ON DELETE RESTRICT
);
CREATE INDEX web_project_milestone_dependencies_source_idx
  ON public.web_project_milestone_dependencies (project_id, milestone_id);
CREATE INDEX web_project_milestone_dependencies_target_idx
  ON public.web_project_milestone_dependencies (project_id, depends_on_milestone_id);

CREATE FUNCTION public.web_check_milestone_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.milestone_id = NEW.depends_on_milestone_id THEN
    RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_SELF_DEPENDENCY';
  END IF;
  IF EXISTS (
    WITH RECURSIVE reachable(id) AS (
      SELECT NEW.depends_on_milestone_id
      UNION
      SELECT d.depends_on_milestone_id
      FROM public.web_project_milestone_dependencies AS d
      JOIN reachable AS r ON r.id = d.milestone_id
      WHERE d.project_id = NEW.project_id
        AND (TG_OP <> 'UPDATE' OR d.id <> OLD.id)
    )
    SELECT 1 FROM reachable WHERE id = NEW.milestone_id
  ) THEN
    RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_DEPENDENCY_CYCLE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_check_milestone_dependency_cycle() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_milestone_dependency_cycle_guard
  BEFORE INSERT OR UPDATE ON public.web_project_milestone_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.web_check_milestone_dependency_cycle();

CREATE TABLE public.web_project_deliverables (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  milestone_id UUID,
  task_id UUID,
  submitted_by_member_id BIGINT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 180),
  description TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','accepted','revision_requested','rejected')),
  submitted_at TIMESTAMPTZ,
  reviewed_by_auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'draft') OR submitted_at IS NOT NULL),
  CHECK ((reviewed_by_auth_user_id IS NULL) = (reviewed_at IS NULL)),
  FOREIGN KEY (project_id, milestone_id) REFERENCES public.web_project_milestones(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, submitted_by_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_deliverables_project_status_idx ON public.web_project_deliverables (project_id, status, due_date);
CREATE INDEX web_project_deliverables_submitter_idx ON public.web_project_deliverables (project_id, submitted_by_member_id, created_at DESC);

CREATE TABLE public.web_project_sprints (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  retrospective_notes TEXT NOT NULL DEFAULT '',
  created_by_auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_on <= ends_on),
  CHECK (completed_at IS NULL OR status = 'completed'),
  UNIQUE (project_id, name),
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_sprints_project_status_dates_idx
  ON public.web_project_sprints (project_id, status, starts_on, ends_on);

CREATE TABLE public.web_project_tasks (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  parent_task_id UUID,
  milestone_id UUID,
  sprint_id UUID,
  reporter_member_id BIGINT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog','todo','in_progress','in_review','blocked','done','cancelled')),
  start_date DATE,
  due_date DATE,
  estimated_effort NUMERIC(9,2) CHECK (estimated_effort IS NULL OR estimated_effort >= 0),
  actual_effort NUMERIC(9,2) CHECK (actual_effort IS NULL OR actual_effort >= 0),
  labels TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_by_auth_user_id UUID NOT NULL,
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
  CHECK (completed_at IS NULL OR status = 'done'),
  FOREIGN KEY (project_id, parent_task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, milestone_id) REFERENCES public.web_project_milestones(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, sprint_id) REFERENCES public.web_project_sprints(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, reporter_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_tasks_project_status_due_idx
  ON public.web_project_tasks (project_id, status, due_date, priority);
CREATE INDEX web_project_tasks_project_sprint_status_idx
  ON public.web_project_tasks (project_id, sprint_id, status) WHERE sprint_id IS NOT NULL;
CREATE INDEX web_project_tasks_project_milestone_idx
  ON public.web_project_tasks (project_id, milestone_id, status) WHERE milestone_id IS NOT NULL;
CREATE INDEX web_project_tasks_reporter_idx ON public.web_project_tasks (project_id, reporter_member_id, created_at DESC);
CREATE INDEX web_project_tasks_labels_idx ON public.web_project_tasks USING GIN (labels);

CREATE TABLE public.web_project_task_assignees (
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by_auth_user_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, task_id, member_id),
  FOREIGN KEY (project_id, task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX web_project_task_one_primary_assignee_idx
  ON public.web_project_task_assignees (project_id, task_id) WHERE is_primary;
CREATE INDEX web_project_task_assignees_member_idx
  ON public.web_project_task_assignees (member_id, project_id, task_id);

CREATE TABLE public.web_project_task_comments (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  author_member_id BIGINT,
  author_auth_user_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, author_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_task_comments_task_idx ON public.web_project_task_comments (project_id, task_id, created_at);

CREATE TABLE public.web_project_task_checklist_items (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by_member_id BIGINT NOT NULL,
  updated_by_member_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, created_by_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, updated_by_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_task_checklist_task_order_idx ON public.web_project_task_checklist_items (project_id, task_id, sort_order);

CREATE TABLE public.web_project_task_attachments (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  uploaded_by_member_id BIGINT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  external_url TEXT,
  storage_object_path TEXT,
  media_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (external_url IS NOT NULL OR storage_object_path IS NOT NULL),
  CHECK (external_url IS NULL OR external_url ~* '^https?://[^[:space:]]+$'),
  FOREIGN KEY (project_id, task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, uploaded_by_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_task_attachments_task_idx ON public.web_project_task_attachments (project_id, task_id, created_at DESC);

CREATE TABLE public.web_project_updates (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  author_member_id BIGINT NOT NULL,
  update_type TEXT NOT NULL CHECK (update_type IN ('progress','blocker','support_request')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  blocker_status TEXT NOT NULL DEFAULT 'open' CHECK (blocker_status IN ('open','escalated','resolved')),
  related_task_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, author_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, related_task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  UNIQUE (project_id, id),
  CHECK ((update_type = 'blocker') OR blocker_status = 'open'),
  CHECK ((blocker_status <> 'resolved') OR resolved_at IS NOT NULL)
);
CREATE INDEX web_project_updates_project_type_time_idx ON public.web_project_updates (project_id, update_type, created_at DESC);
CREATE INDEX web_project_updates_blockers_idx ON public.web_project_updates (project_id, blocker_status, created_at DESC)
  WHERE update_type = 'blocker';

CREATE TABLE public.web_project_member_reports (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  completed_this_week TEXT NOT NULL DEFAULT '',
  working_on TEXT NOT NULL DEFAULT '',
  next_week_plan TEXT NOT NULL DEFAULT '',
  deliverables_complete BOOLEAN NOT NULL DEFAULT FALSE,
  blockers TEXT NOT NULL DEFAULT '',
  support_needed BOOLEAN NOT NULL DEFAULT FALSE,
  references_and_attachments JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(references_and_attachments) = 'array'),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','needs_clarification','reviewed')),
  reviewed_by_auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(review_notes) <= 10000),
  blocker_escalated BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  CHECK ((reviewed_by_auth_user_id IS NULL) = (reviewed_at IS NULL)),
  FOREIGN KEY (project_id, member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, member_id, period_start),
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_member_reports_period_idx
  ON public.web_project_member_reports (project_id, period_start DESC, status);
CREATE INDEX web_project_member_reports_author_idx
  ON public.web_project_member_reports (member_id, period_start DESC);

CREATE TABLE public.web_resources (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  scope_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  project_id UUID REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 180),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN (
    'brand_logo','brand_guidelines','design_system','ui_components','documents_templates',
    'approved_fonts','illustrations_media','technical_standards','development_resources','other'
  )),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  preview_url TEXT,
  external_url TEXT,
  storage_object_path TEXT,
  version_label TEXT,
  access_status TEXT NOT NULL DEFAULT 'pending' CHECK (access_status IN ('pending','approved','rejected','archived')),
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scope_id = COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  CHECK (external_url IS NOT NULL OR storage_object_path IS NOT NULL),
  CHECK (NOT is_approved OR access_status = 'approved'),
  UNIQUE (id, scope_id)
);
CREATE INDEX web_resources_shared_approved_idx ON public.web_resources (category, title) WHERE project_id IS NULL AND is_approved;
CREATE INDEX web_resources_project_idx ON public.web_resources (project_id, category, access_status) WHERE project_id IS NOT NULL;

CREATE TABLE public.web_project_resource_refs (
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL,
  resource_scope_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  added_by_auth_user_id UUID NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, resource_id),
  CHECK (resource_scope_id = '00000000-0000-0000-0000-000000000000'::uuid OR resource_scope_id = project_id),
  FOREIGN KEY (resource_id, resource_scope_id) REFERENCES public.web_resources(id, scope_id) ON DELETE RESTRICT
);
CREATE INDEX web_project_resource_refs_resource_idx ON public.web_project_resource_refs (resource_id, project_id);

CREATE TABLE public.web_project_integrations (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  integration_type TEXT NOT NULL CHECK (integration_type IN (
    'repository','github','figma','design','product','live_demo','documentation','ledger','sentinel','forge','nexus','pulse','other'
  )),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 160),
  link_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  connection_state TEXT NOT NULL DEFAULT 'metadata_only' CHECK (connection_state = 'metadata_only'),
  created_by_auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_integrations_project_idx ON public.web_project_integrations (project_id, integration_type, created_at DESC);

CREATE TABLE public.web_project_activity_logs (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.web_projects(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_auth_user_id UUID,
  actor_member_id BIGINT,
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 180),
  entity_type TEXT NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 100),
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  FOREIGN KEY (project_id, actor_member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT
);
CREATE INDEX web_project_activity_project_time_idx ON public.web_project_activity_logs (project_id, occurred_at DESC, id DESC);
CREATE INDEX web_project_activity_actor_idx ON public.web_project_activity_logs (actor_member_id, occurred_at DESC) WHERE actor_member_id IS NOT NULL;
CREATE TRIGGER web_project_activity_no_mutation
  BEFORE UPDATE OR DELETE ON public.web_project_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.web_prevent_append_only_mutation();
CREATE TRIGGER web_project_activity_no_truncate
  BEFORE TRUNCATE ON public.web_project_activity_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.web_prevent_append_only_mutation();

-- Complete circular / project-scoped constraints only after task relations exist.
ALTER TABLE public.web_project_deliverables
  ADD CONSTRAINT web_project_deliverables_task_same_project_fk
  FOREIGN KEY (project_id, task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT;

-- Authorization helpers use the current Auth subject and canonical binding only.
-- An argument such as project_id selects the resource; it never proves access.
CREATE FUNCTION public.web_is_program_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.admin_accounts AS a
    WHERE a.user_id = auth.uid()
      AND (a.role = 'owner' OR (a.role = 'admin' AND a.permissions @> '{"web_projects":true}'::jsonb))
  );
$$;
REVOKE ALL ON FUNCTION public.web_is_program_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_is_program_admin() TO authenticated;

CREATE FUNCTION public.web_current_member_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.member_id
  FROM public.member_auth_bindings AS b
  JOIN public.members AS m ON m.id = b.member_id AND m.work_status = 'active'
  JOIN auth.users AS u ON u.id = b.auth_user_id
  WHERE auth.uid() IS NOT NULL
    AND b.auth_user_id = auth.uid()
    AND b.password_ready IS TRUE
    AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now())
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.web_current_member_id() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_current_member_id() TO authenticated;

CREATE FUNCTION public.web_can_read_agreement(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND (
    public.web_is_program_admin()
    OR EXISTS (
      SELECT 1 FROM public.web_project_members AS m
      WHERE m.project_id = p_project_id
        AND m.member_id = public.web_current_member_id()
        AND m.status IN ('pending','active')
    )
  );
$$;
REVOKE ALL ON FUNCTION public.web_can_read_agreement(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_can_read_agreement(UUID) TO authenticated;

CREATE FUNCTION public.web_can_access_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND (
    public.web_is_program_admin()
    OR EXISTS (
      SELECT 1
      FROM public.web_projects AS p
      JOIN public.web_project_members AS m ON m.project_id = p.id
      WHERE p.id = p_project_id
        AND m.member_id = public.web_current_member_id()
        AND m.status = 'active'
        AND m.accepted_agreement_version = p.current_agreement_version
        AND m.agreement_accepted_at IS NOT NULL
    )
  );
$$;
REVOKE ALL ON FUNCTION public.web_can_access_project(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_can_access_project(UUID) TO authenticated;

CREATE FUNCTION public.web_is_project_lead(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND (
    public.web_is_program_admin()
    OR EXISTS (
      SELECT 1 FROM public.web_projects AS p
      JOIN public.web_project_members AS m
        ON m.project_id = p.id AND m.member_id = p.lead_member_id
      WHERE p.id = p_project_id
        AND m.role = 'lead'
        AND m.status = 'active'
        AND m.accepted_agreement_version = p.current_agreement_version
        AND m.agreement_accepted_at IS NOT NULL
        AND m.member_id = public.web_current_member_id()
    )
  );
$$;
REVOKE ALL ON FUNCTION public.web_is_project_lead(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_is_project_lead(UUID) TO authenticated;

CREATE FUNCTION public.web_can_manage_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.web_is_project_lead(p_project_id) $$;
REVOKE ALL ON FUNCTION public.web_can_manage_project(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_can_manage_project(UUID) TO authenticated;

CREATE FUNCTION public.web_is_project_contributor(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND (
    public.web_is_program_admin()
    OR EXISTS (
      SELECT 1 FROM public.web_projects AS p
      JOIN public.web_project_members AS m ON m.project_id = p.id
      WHERE p.id = p_project_id
        AND m.member_id = public.web_current_member_id()
        AND m.role IN ('lead','contributor')
        AND m.status = 'active'
        AND m.accepted_agreement_version = p.current_agreement_version
    )
  );
$$;
REVOKE ALL ON FUNCTION public.web_is_project_contributor(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_is_project_contributor(UUID) TO authenticated;

CREATE FUNCTION public.web_can_view_report(p_project_id UUID, p_member_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND p_member_id IS NOT NULL AND (
    public.web_is_program_admin()
    OR public.web_is_project_lead(p_project_id)
    OR public.web_current_member_id() = p_member_id
  );
$$;
REVOKE ALL ON FUNCTION public.web_can_view_report(UUID, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_can_view_report(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.web_is_task_assignee(p_project_id UUID, p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND p_task_id IS NOT NULL
    AND public.web_current_member_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.web_project_task_assignees AS a
      WHERE a.project_id = p_project_id AND a.task_id = p_task_id
        AND a.member_id = public.web_current_member_id()
    )
    AND public.web_can_access_project(p_project_id);
$$;
REVOKE ALL ON FUNCTION public.web_is_task_assignee(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_is_task_assignee(UUID, UUID) TO authenticated;

CREATE FUNCTION public.web_all_contributors_consented(p_project_id UUID, p_consent_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL AND p_consent_type IN ('phantoms_brand_assets','public_showcase')
    AND EXISTS (SELECT 1 FROM public.web_projects AS p WHERE p.id = p_project_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.web_projects AS p
      JOIN public.web_project_members AS m ON m.project_id = p.id
      LEFT JOIN LATERAL (
        SELECT c.granted
        FROM public.web_project_consents AS c
        WHERE c.project_id = m.project_id AND c.member_id = m.member_id
          AND c.agreement_version = p.current_agreement_version
          AND c.consent_type = p_consent_type
        ORDER BY c.recorded_at DESC, c.id DESC
        LIMIT 1
      ) AS latest ON TRUE
      WHERE p.id = p_project_id
        AND m.status = 'active'
        AND m.role IN ('lead','contributor')
        AND latest.granted IS DISTINCT FROM TRUE
    );
$$;
REVOKE ALL ON FUNCTION public.web_all_contributors_consented(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.web_validate_project_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.lead_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.web_project_members AS m
    WHERE m.project_id = NEW.id AND m.member_id = NEW.lead_member_id
      AND m.role = 'lead' AND m.status IN ('pending','active')
  ) THEN
    RAISE EXCEPTION 'WEB_PROJECT_LEAD_MEMBERSHIP_REQUIRED';
  END IF;
  IF NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.web_project_members AS m
    WHERE m.project_id = NEW.id AND m.member_id = NEW.lead_member_id
      AND m.role = 'lead' AND m.status = 'active'
      AND m.accepted_agreement_version = NEW.current_agreement_version
      AND m.agreement_accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'WEB_PROJECT_ACTIVE_LEAD_ACCEPTANCE_REQUIRED';
  END IF;
  IF NEW.phantoms_brand_permission AND NOT public.web_all_contributors_consented(NEW.id, 'phantoms_brand_assets') THEN
    RAISE EXCEPTION 'WEB_PROJECT_BRAND_CONSENT_REQUIRED';
  END IF;
  IF NEW.public_showcase_permission AND NOT public.web_all_contributors_consented(NEW.id, 'public_showcase') THEN
    RAISE EXCEPTION 'WEB_PROJECT_SHOWCASE_CONSENT_REQUIRED';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_project_row() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_projects_invariant_guard
  BEFORE INSERT OR UPDATE ON public.web_projects
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_project_row();

CREATE FUNCTION public.web_validate_project_member_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_version INTEGER;
BEGIN
  SELECT p.current_agreement_version INTO v_current_version
  FROM public.web_projects AS p WHERE p.id = NEW.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND'; END IF;
  IF NEW.status = 'active' AND (
    NEW.accepted_agreement_version IS DISTINCT FROM v_current_version
    OR NEW.agreement_accepted_at IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.web_project_agreement_acceptances AS a
      WHERE a.project_id = NEW.project_id AND a.member_id = NEW.member_id
        AND a.agreement_version = v_current_version
    )
  ) THEN
    RAISE EXCEPTION 'WEB_PROJECT_AGREEMENT_ACCEPTANCE_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.web_projects AS p
    WHERE p.id = NEW.project_id AND p.lead_member_id = NEW.member_id
  ) AND (NEW.role <> 'lead' OR NEW.status = 'removed') THEN
    RAISE EXCEPTION 'WEB_PROJECT_PRIMARY_LEAD_MEMBERSHIP_REQUIRED';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_project_member_row() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_members_invariant_guard
  BEFORE INSERT OR UPDATE ON public.web_project_members
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_project_member_row();

CREATE FUNCTION public.web_check_milestone_date_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.start_date IS NOT NULL AND NEW.due_date IS NOT NULL AND NEW.start_date > NEW.due_date THEN
    RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_DATE_RANGE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_check_milestone_date_consistency() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.web_capture_project_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new JSONB;
  v_old JSONB;
  v_source JSONB;
  v_project_id UUID;
  v_entity_id UUID;
  v_actor_member_id BIGINT;
  v_changed TEXT[];
  v_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_source := to_jsonb(OLD);
    v_old := v_source;
    v_new := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_source := to_jsonb(NEW);
    v_new := v_source;
    v_old := to_jsonb(OLD);
  ELSE
    v_source := to_jsonb(NEW);
    v_new := v_source;
    v_old := NULL;
  END IF;
  v_project_id := COALESCE(NULLIF(v_source ->> 'project_id',''), NULLIF(v_source ->> 'id',''))::uuid;
  -- Shared-library resources have no project scope and must not be coerced to
  -- their own row UUID (which is not a valid web_projects foreign key).
  IF TG_TABLE_NAME = 'web_resources' AND NULLIF(v_source ->> 'project_id','') IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_project_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  BEGIN
    v_entity_id := COALESCE(NULLIF(v_source ->> 'id',''), NULLIF(v_source ->> 'task_id',''), NULLIF(v_source ->> 'resource_id',''))::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_entity_id := NULL;
  END;
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT k FROM jsonb_object_keys(v_new) AS k
    LOOP
      IF v_new -> v_key IS DISTINCT FROM v_old -> v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
  ELSE
    SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_changed
    FROM jsonb_object_keys(v_source) AS k;
  END IF;
  SELECT m.member_id INTO v_actor_member_id
  FROM public.web_project_members AS m
  WHERE m.project_id = v_project_id AND m.member_id = public.web_current_member_id();
  INSERT INTO public.web_project_activity_logs (
    project_id, actor_auth_user_id, actor_member_id, action, entity_type, entity_id, details
  ) VALUES (
    v_project_id, auth.uid(), v_actor_member_id,
    'web_' || TG_TABLE_NAME || '_' || lower(TG_OP), TG_TABLE_NAME, v_entity_id,
    jsonb_build_object('changed_columns', COALESCE(to_jsonb(v_changed), '[]'::jsonb))
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_capture_project_activity() FROM PUBLIC, anon, authenticated, service_role;

-- Audit snapshots contain changed column names only; user-authored content,
-- report answers, URLs, and other sensitive values are never copied to activity.
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'web_projects','web_project_agreements','web_project_members','web_project_agreement_acceptances',
    'web_project_consents','web_project_milestones','web_project_milestone_dependencies',
    'web_project_deliverables','web_project_sprints','web_project_tasks','web_project_task_assignees',
    'web_project_task_comments','web_project_task_checklist_items','web_project_task_attachments',
    'web_project_updates','web_project_member_reports','web_resources','web_project_resource_refs',
    'web_project_integrations'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.web_capture_project_activity()',
      v_table || '_activity_capture', v_table
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.web_validate_resource_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resource_project UUID;
  v_scope UUID;
  v_approved BOOLEAN;
BEGIN
  SELECT r.project_id, r.scope_id, r.is_approved
  INTO v_resource_project, v_scope, v_approved
  FROM public.web_resources AS r WHERE r.id = NEW.resource_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_RESOURCE_NOT_FOUND'; END IF;
  IF v_resource_project IS NOT NULL AND v_resource_project <> NEW.project_id THEN
    RAISE EXCEPTION 'WEB_PROJECT_RESOURCE_SCOPE_MISMATCH';
  END IF;
  IF v_resource_project IS NULL AND NOT v_approved THEN
    RAISE EXCEPTION 'WEB_SHARED_RESOURCE_NOT_APPROVED';
  END IF;
  NEW.resource_scope_id := v_scope;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_resource_reference() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_resource_reference_guard
  BEFORE INSERT OR UPDATE ON public.web_project_resource_refs
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_resource_reference();

CREATE FUNCTION public.web_member_has_auth_binding(p_member_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_member_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.members AS m
    JOIN public.member_auth_bindings AS b ON b.member_id = m.id AND b.password_ready IS TRUE
    JOIN auth.users AS u ON u.id = b.auth_user_id AND u.email_confirmed_at IS NOT NULL
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
    WHERE m.id = p_member_id AND m.work_status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.web_member_has_auth_binding(BIGINT) FROM PUBLIC, anon, authenticated, service_role;

-- Owner-only, explicit feature-bit management. Team seats and their JSON contract
-- remain unchanged and are not consulted here.
CREATE FUNCTION public.web_set_program_admin_access(p_user_id UUID, p_enabled BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_user_id IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_WEB_PROJECTS_ADMIN_INPUT'; END IF;
  SELECT COALESCE((a.permissions ->> 'web_projects')::boolean, false)
  INTO v_old FROM public.admin_accounts AS a
  WHERE a.user_id = p_user_id AND a.role = 'admin' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECTS_ADMIN_NOT_FOUND'; END IF;
  IF v_old IS DISTINCT FROM p_enabled THEN
    UPDATE public.admin_accounts
    SET permissions = permissions || jsonb_build_object('web_projects', p_enabled)
    WHERE user_id = p_user_id AND role = 'admin';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.web_set_program_admin_access(UUID, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_set_program_admin_access(UUID, BOOLEAN) TO authenticated;

CREATE FUNCTION public.web_audit_program_permission_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before BOOLEAN := COALESCE((OLD.permissions ->> 'web_projects')::boolean, false);
  v_after BOOLEAN := COALESCE((NEW.permissions ->> 'web_projects')::boolean, false);
BEGIN
  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.web_program_admin_audit (actor_auth_user_id, target_auth_user_id, action, details)
    VALUES (auth.uid(), NEW.user_id, CASE WHEN v_after THEN 'permission_granted' ELSE 'permission_revoked' END,
      jsonb_build_object('permission', 'web_projects', 'enabled', v_after));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_audit_program_permission_change() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_projects_admin_permission_audit
  AFTER UPDATE OF permissions ON public.admin_accounts
  FOR EACH ROW EXECUTE FUNCTION public.web_audit_program_permission_change();

CREATE FUNCTION public.web_list_member_candidates(p_project_id UUID DEFAULT NULL)
RETURNS TABLE (member_id BIGINT, full_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_project_id IS NULL THEN
    IF NOT public.web_is_program_admin() THEN RAISE EXCEPTION 'WEB_PROJECTS_PERMISSION_REQUIRED'; END IF;
  ELSIF NOT (public.web_is_program_admin() OR public.web_is_project_lead(p_project_id)) THEN
    RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT m.id, m.full_name
  FROM public.members AS m
  WHERE m.work_status = 'active' AND public.web_member_has_auth_binding(m.id)
    AND (p_project_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.web_project_members AS pm
      WHERE pm.project_id = p_project_id AND pm.member_id = m.id
        AND pm.status IN ('pending','active')
    ))
  ORDER BY m.full_name, m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_list_member_candidates(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_list_member_candidates(UUID) TO authenticated;

CREATE FUNCTION public.web_list_project_roster(p_project_id UUID)
RETURNS TABLE (
  project_id UUID, member_id BIGINT, role TEXT, status TEXT, responsibility TEXT,
  accepted_agreement_version INTEGER, agreement_accepted_at TIMESTAMPTZ,
  added_by_auth_user_id UUID, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, full_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_member_id BIGINT := public.web_current_member_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_project_id IS NULL OR NOT (
    public.web_is_program_admin() OR public.web_can_access_project(p_project_id)
    OR EXISTS (SELECT 1 FROM public.web_project_members AS own
               WHERE own.project_id = p_project_id AND own.member_id = v_current_member_id
                 AND own.status = 'pending')
  ) THEN RAISE EXCEPTION 'WEB_PROJECT_ACCESS_REQUIRED'; END IF;
  RETURN QUERY
  SELECT pm.project_id, pm.member_id, pm.role, pm.status, pm.responsibility,
         pm.accepted_agreement_version, pm.agreement_accepted_at,
         pm.added_by_auth_user_id, pm.created_at, pm.updated_at, m.full_name
  FROM public.web_project_members AS pm
  JOIN public.members AS m ON m.id = pm.member_id
  WHERE pm.project_id = p_project_id
    AND (public.web_can_access_project(p_project_id) OR pm.member_id = v_current_member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.web_list_project_roster(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_list_project_roster(UUID) TO authenticated;

CREATE FUNCTION public.web_list_my_project_invitations()
RETURNS TABLE (
  project_id UUID, project_name TEXT, role TEXT, status TEXT,
  current_agreement_version INTEGER, ownership_model TEXT, ownership_notes TEXT,
  license_name TEXT, attribution_notes TEXT, terms JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
BEGIN
  IF auth.uid() IS NULL OR v_member_id IS NULL THEN RAISE EXCEPTION 'CANONICAL_MEMBER_BINDING_REQUIRED'; END IF;
  RETURN QUERY
  SELECT p.id, p.name, pm.role, pm.status, a.version, a.ownership_model,
         a.ownership_notes, a.license_name, a.attribution_notes, a.terms
  FROM public.web_project_members AS pm
  JOIN public.web_projects AS p ON p.id = pm.project_id
  JOIN public.web_project_agreements AS a
    ON a.project_id = p.id AND a.version = p.current_agreement_version
  WHERE pm.member_id = v_member_id AND pm.status = 'pending'
  ORDER BY pm.created_at DESC, p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_list_my_project_invitations() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_list_my_project_invitations() TO authenticated;

CREATE FUNCTION public.web_create_project(
  p_name TEXT, p_slug TEXT, p_owner_member_id BIGINT, p_lead_member_id BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id UUID := extensions.gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_program_admin() THEN RAISE EXCEPTION 'WEB_PROJECTS_PERMISSION_REQUIRED'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 180
     OR p_slug IS NULL OR p_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
     OR p_owner_member_id IS NULL OR p_owner_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_WEB_PROJECT';
  END IF;
  IF NOT public.web_member_has_auth_binding(p_owner_member_id)
     OR (p_lead_member_id IS NOT NULL AND NOT public.web_member_has_auth_binding(p_lead_member_id)) THEN RAISE EXCEPTION 'WEB_PROJECT_MEMBER_NOT_ACTIVE'; END IF;
  INSERT INTO public.web_projects (id, slug, name, owner_member_id, lead_member_id, created_by_auth_user_id)
  VALUES (v_project_id, lower(btrim(p_slug)), btrim(p_name), p_owner_member_id, NULL, auth.uid());
  INSERT INTO public.web_project_agreements (
    project_id, version, ownership_model, ownership_notes, license_name, attribution_notes,
    terms, created_by_auth_user_id
  ) VALUES (
    v_project_id, 1, 'undetermined', 'Not yet agreed; no ownership is presumed.',
    'undetermined', 'Attribution must be explicitly agreed by contributors.',
    '{"ownership_is_not_assumed":true,"brand_permission_default":false,"showcase_permission_default":false}'::jsonb,
    auth.uid()
  );
  IF p_lead_member_id IS NULL THEN
    INSERT INTO public.web_project_members (project_id, member_id, role, status, added_by_auth_user_id)
    VALUES (v_project_id, p_owner_member_id, 'contributor', 'pending', auth.uid());
  ELSIF p_lead_member_id = p_owner_member_id THEN
    INSERT INTO public.web_project_members (project_id, member_id, role, status, added_by_auth_user_id)
    VALUES (v_project_id, p_owner_member_id, 'lead', 'pending', auth.uid());
  ELSE
    INSERT INTO public.web_project_members (project_id, member_id, role, status, added_by_auth_user_id)
    VALUES (v_project_id, p_owner_member_id, 'contributor', 'pending', auth.uid());
    INSERT INTO public.web_project_members (project_id, member_id, role, status, added_by_auth_user_id)
    VALUES (v_project_id, p_lead_member_id, 'lead', 'pending', auth.uid());
  END IF;
  IF p_lead_member_id IS NOT NULL THEN
    UPDATE public.web_projects SET lead_member_id = p_lead_member_id WHERE id = v_project_id;
  END IF;
  RETURN v_project_id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_create_project(TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_create_project(TEXT, TEXT, BIGINT, BIGINT) TO authenticated;

CREATE FUNCTION public.web_review_idea(p_idea_id UUID, p_decision TEXT, p_notes TEXT DEFAULT '')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_old_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_program_admin() THEN RAISE EXCEPTION 'WEB_PROJECTS_PERMISSION_REQUIRED'; END IF;
  IF p_idea_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('under_review','approved','rejected')
     OR p_notes IS NULL OR char_length(p_notes) > 10000 THEN RAISE EXCEPTION 'INVALID_WEB_IDEA_REVIEW'; END IF;
  SELECT i.review_status INTO v_old_status FROM public.web_ideas AS i WHERE i.id = p_idea_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_IDEA_NOT_FOUND'; END IF;
  IF (p_decision = 'under_review' AND v_old_status <> 'proposed')
     OR (p_decision IN ('approved','rejected') AND v_old_status <> 'under_review') THEN
    RAISE EXCEPTION 'WEB_IDEA_INVALID_REVIEW_TRANSITION';
  END IF;
  UPDATE public.web_ideas
  SET review_status = p_decision,
      review_notes = p_notes,
      reviewed_by_auth_user_id = auth.uid(),
      reviewed_at = now()
  WHERE id = p_idea_id
  RETURNING review_status INTO v_status;
  INSERT INTO public.web_idea_reviews (idea_id, reviewer_auth_user_id, decision, notes)
  VALUES (p_idea_id, auth.uid(), p_decision, p_notes);
  INSERT INTO public.web_program_admin_audit (actor_auth_user_id, action, details)
  VALUES (auth.uid(), 'idea_reviewed', jsonb_build_object('idea_id', p_idea_id, 'decision', p_decision));
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.web_review_idea(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_review_idea(UUID, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public.web_convert_idea_to_project(
  p_idea_id UUID, p_project_slug TEXT, p_lead_member_id BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_idea public.web_ideas%ROWTYPE;
  v_project_id UUID;
  v_lead BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_program_admin() THEN RAISE EXCEPTION 'WEB_PROJECTS_PERMISSION_REQUIRED'; END IF;
  IF p_idea_id IS NULL OR p_project_slug IS NULL THEN RAISE EXCEPTION 'INVALID_WEB_IDEA_CONVERSION'; END IF;
  SELECT * INTO v_idea FROM public.web_ideas AS i WHERE i.id = p_idea_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_IDEA_NOT_FOUND'; END IF;
  IF v_idea.converted_project_id IS NOT NULL THEN RETURN v_idea.converted_project_id; END IF;
  IF v_idea.review_status <> 'approved' THEN RAISE EXCEPTION 'WEB_IDEA_APPROVAL_REQUIRED'; END IF;
  v_lead := COALESCE(p_lead_member_id, v_idea.suggested_leader_member_id);
  v_project_id := public.web_create_project(v_idea.title, p_project_slug, v_idea.submitted_by_member_id, v_lead);
  UPDATE public.web_projects AS p
  SET source_idea_id = v_idea.id,
      origin_submitter_member_id = v_idea.submitted_by_member_id,
      short_description = v_idea.short_description,
      problem_statement = v_idea.problem_statement,
      proposed_solution = v_idea.proposed_solution,
      target_audience = v_idea.target_audience,
      phantoms_benefit = v_idea.phantoms_benefit,
      graduation_project = v_idea.graduation_project,
      potential_use_cases = v_idea.potential_use_cases,
      required_skills = v_idea.required_skills,
      estimated_complexity = v_idea.estimated_complexity,
      tech_stack = v_idea.suggested_tech_stack,
      supporting_documents = v_idea.supporting_documents
  WHERE p.id = v_project_id;
  INSERT INTO public.web_project_members (project_id, member_id, role, status, responsibility, added_by_auth_user_id)
  SELECT v_project_id, c.member_id, 'contributor', 'pending', c.responsibility, auth.uid()
  FROM public.web_idea_contributors AS c
  WHERE c.idea_id = p_idea_id
    AND c.member_id NOT IN (v_idea.submitted_by_member_id, COALESCE(v_lead, -1))
  ON CONFLICT (project_id, member_id) DO NOTHING;
  UPDATE public.web_ideas SET converted_project_id = v_project_id, converted_at = now() WHERE id = p_idea_id;
  INSERT INTO public.web_program_admin_audit (actor_auth_user_id, action, details)
  VALUES (auth.uid(), 'idea_conversion', jsonb_build_object('idea_id', p_idea_id, 'project_id', v_project_id));
  RETURN v_project_id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_convert_idea_to_project(UUID, TEXT, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_convert_idea_to_project(UUID, TEXT, BIGINT) TO authenticated;

CREATE FUNCTION public.web_add_project_member(
  p_project_id UUID, p_member_id BIGINT, p_role TEXT, p_responsibility TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_project_lead(p_project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_member_id IS NULL OR p_member_id <= 0
     OR p_role IS NULL OR p_role NOT IN ('contributor','viewer')
     OR p_responsibility IS NULL OR char_length(p_responsibility) > 4000 THEN
    RAISE EXCEPTION 'INVALID_WEB_PROJECT_MEMBER';
  END IF;
  IF NOT public.web_member_has_auth_binding(p_member_id) THEN
    RAISE EXCEPTION 'WEB_PROJECT_MEMBER_NOT_ACTIVE_OR_BOUND';
  END IF;
  PERFORM 1 FROM public.web_projects WHERE id = p_project_id AND status NOT IN ('archived','rejected') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND_OR_CLOSED'; END IF;
  SELECT m.status INTO v_status FROM public.web_project_members AS m
  WHERE m.project_id = p_project_id AND m.member_id = p_member_id FOR UPDATE;
  IF FOUND THEN
    IF v_status NOT IN ('removed','suspended') THEN RAISE EXCEPTION 'WEB_PROJECT_MEMBER_ALREADY_PRESENT'; END IF;
    UPDATE public.web_project_members
    SET role = p_role, status = 'pending', responsibility = p_responsibility,
        accepted_agreement_version = NULL, agreement_accepted_at = NULL,
        added_by_auth_user_id = auth.uid(), updated_at = now()
    WHERE project_id = p_project_id AND member_id = p_member_id;
  ELSE
    INSERT INTO public.web_project_members (project_id, member_id, role, status, responsibility, added_by_auth_user_id)
    VALUES (p_project_id, p_member_id, p_role, 'pending', p_responsibility, auth.uid());
  END IF;
  RETURN 'pending';
END;
$$;
REVOKE ALL ON FUNCTION public.web_add_project_member(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_add_project_member(UUID, BIGINT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public.web_set_project_leader(p_project_id UUID, p_member_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_member BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_project_lead(p_project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_LEADER'; END IF;
  IF NOT public.web_member_has_auth_binding(p_member_id) THEN
    RAISE EXCEPTION 'WEB_PROJECT_MEMBER_NOT_ACTIVE_OR_BOUND';
  END IF;
  SELECT lead_member_id INTO v_old_member FROM public.web_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND'; END IF;
  IF v_old_member = p_member_id THEN RETURN TRUE; END IF;
  UPDATE public.web_projects SET status = CASE WHEN status = 'active' THEN 'on_hold' ELSE status END,
    lead_member_id = NULL WHERE id = p_project_id;
  IF v_old_member IS NOT NULL THEN
    UPDATE public.web_project_members
    SET role = 'contributor', status = 'pending', accepted_agreement_version = NULL,
        agreement_accepted_at = NULL, updated_at = now()
    WHERE project_id = p_project_id AND member_id = v_old_member;
  END IF;
  INSERT INTO public.web_project_members (
    project_id, member_id, role, status, responsibility, added_by_auth_user_id
  ) VALUES (p_project_id, p_member_id, 'lead', 'pending', '', auth.uid())
  ON CONFLICT (project_id, member_id) DO UPDATE
  SET role = 'lead', status = 'pending', accepted_agreement_version = NULL,
      agreement_accepted_at = NULL, added_by_auth_user_id = auth.uid(), updated_at = now();
  UPDATE public.web_projects SET lead_member_id = p_member_id WHERE id = p_project_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.web_set_project_leader(UUID, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_set_project_leader(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.web_set_project_member_status(p_project_id UUID, p_member_id BIGINT, p_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT;
  v_old_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_project_lead(p_project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_member_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('suspended','removed') THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_MEMBER_STATUS'; END IF;
  SELECT role, status INTO v_role, v_old_status
  FROM public.web_project_members
  WHERE project_id = p_project_id AND member_id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_MEMBER_NOT_FOUND'; END IF;
  IF v_old_status = p_status THEN RETURN p_status; END IF;
  IF v_role = 'lead' AND EXISTS (
    SELECT 1 FROM public.web_projects WHERE id = p_project_id AND lead_member_id = p_member_id
  ) THEN
    UPDATE public.web_projects
    SET status = CASE WHEN status = 'active' THEN 'on_hold' ELSE status END, lead_member_id = NULL
    WHERE id = p_project_id;
  END IF;
  UPDATE public.web_project_members SET status = p_status, updated_at = now()
  WHERE project_id = p_project_id AND member_id = p_member_id;
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.web_set_project_member_status(UUID, BIGINT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_set_project_member_status(UUID, BIGINT, TEXT) TO authenticated;

CREATE FUNCTION public.web_accept_project_agreement(p_project_id UUID, p_version INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_current_version INTEGER;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_member_id IS NULL THEN RAISE EXCEPTION 'CANONICAL_MEMBER_BINDING_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_version IS NULL OR p_version <= 0 THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_AGREEMENT'; END IF;
  SELECT p.current_agreement_version INTO v_current_version
  FROM public.web_projects AS p WHERE p.id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND'; END IF;
  IF p_version <> v_current_version THEN RAISE EXCEPTION 'WEB_PROJECT_AGREEMENT_VERSION_STALE'; END IF;
  SELECT m.status INTO v_status FROM public.web_project_members AS m
  WHERE m.project_id = p_project_id AND m.member_id = v_member_id FOR UPDATE;
  IF NOT FOUND OR v_status IN ('removed','suspended') THEN RAISE EXCEPTION 'WEB_PROJECT_INVITATION_NOT_FOUND'; END IF;
  IF v_status = 'pending' THEN
    UPDATE public.web_projects
    SET phantoms_brand_permission = FALSE, public_showcase_permission = FALSE
    WHERE id = p_project_id AND (phantoms_brand_permission OR public_showcase_permission);
  END IF;
  INSERT INTO public.web_project_agreement_acceptances (project_id, member_id, agreement_version, actor_auth_user_id)
  VALUES (p_project_id, v_member_id, p_version, auth.uid())
  ON CONFLICT (project_id, member_id, agreement_version) DO NOTHING;
  UPDATE public.web_project_members
  SET status = 'active', accepted_agreement_version = p_version,
      agreement_accepted_at = COALESCE(agreement_accepted_at, now()), updated_at = now()
  WHERE project_id = p_project_id AND member_id = v_member_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.web_accept_project_agreement(UUID, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_accept_project_agreement(UUID, INTEGER) TO authenticated;

CREATE FUNCTION public.web_amend_project_agreement(
  p_project_id UUID, p_ownership_model TEXT, p_ownership_notes TEXT,
  p_license_name TEXT, p_attribution_notes TEXT, p_terms JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.web_projects%ROWTYPE;
  v_version INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_project_lead(p_project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_ownership_model IS NULL OR p_ownership_model NOT IN (
       'undetermined','creator_owned','joint','licensed_to_phantoms','licensed_from_phantoms','other')
     OR p_ownership_notes IS NULL OR char_length(p_ownership_notes) > 10000
     OR p_license_name IS NULL OR char_length(btrim(p_license_name)) NOT BETWEEN 1 AND 180
     OR p_attribution_notes IS NULL OR char_length(p_attribution_notes) > 10000
     OR p_terms IS NULL OR jsonb_typeof(p_terms) <> 'object' THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_AGREEMENT'; END IF;
  SELECT * INTO v_project FROM public.web_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND'; END IF;
  v_version := v_project.current_agreement_version + 1;
  INSERT INTO public.web_project_agreements (
    project_id, version, ownership_model, ownership_notes, license_name,
    attribution_notes, terms, created_by_auth_user_id
  ) VALUES (
    p_project_id, v_version, p_ownership_model, p_ownership_notes, p_license_name,
    p_attribution_notes, p_terms, auth.uid()
  );
  UPDATE public.web_projects
  SET status = CASE WHEN status = 'active' THEN 'on_hold' ELSE status END,
      current_agreement_version = v_version,
      ownership_model = p_ownership_model,
      ownership_notes = p_ownership_notes,
      license_name = p_license_name,
      attribution_notes = p_attribution_notes,
      phantoms_brand_permission = FALSE,
      public_showcase_permission = FALSE
  WHERE id = p_project_id;
  UPDATE public.web_project_members
  SET status = CASE WHEN status IN ('removed','suspended') THEN status ELSE 'pending' END,
      accepted_agreement_version = NULL, agreement_accepted_at = NULL, updated_at = now()
  WHERE project_id = p_project_id;
  RETURN v_version;
END;
$$;
REVOKE ALL ON FUNCTION public.web_amend_project_agreement(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_amend_project_agreement(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

CREATE FUNCTION public.web_record_project_consent(p_project_id UUID, p_consent_type TEXT, p_granted BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_version INTEGER;
  v_consent_id UUID;
BEGIN
  IF auth.uid() IS NULL OR v_member_id IS NULL THEN RAISE EXCEPTION 'CANONICAL_MEMBER_BINDING_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_consent_type IS NULL OR p_consent_type NOT IN ('phantoms_brand_assets','public_showcase')
     OR p_granted IS NULL THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_CONSENT'; END IF;
  SELECT p.current_agreement_version INTO v_version
  FROM public.web_projects AS p
  JOIN public.web_project_members AS m ON m.project_id = p.id
  WHERE p.id = p_project_id AND m.member_id = v_member_id AND m.status = 'active'
    AND m.accepted_agreement_version = p.current_agreement_version
    AND m.role IN ('lead','contributor')
  FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_CONTRIBUTOR_ACCESS_REQUIRED'; END IF;
  INSERT INTO public.web_project_consents (
    project_id, member_id, agreement_version, consent_type, granted, actor_auth_user_id
  ) VALUES (p_project_id, v_member_id, v_version, p_consent_type, p_granted, auth.uid())
  RETURNING id INTO v_consent_id;
  IF NOT p_granted THEN
    IF p_consent_type = 'phantoms_brand_assets' THEN
      UPDATE public.web_projects SET phantoms_brand_permission = FALSE WHERE id = p_project_id;
    ELSE
      UPDATE public.web_projects SET public_showcase_permission = FALSE WHERE id = p_project_id;
    END IF;
  END IF;
  RETURN v_consent_id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_record_project_consent(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_record_project_consent(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE FUNCTION public.web_set_project_permissions(p_project_id UUID, p_brand_use BOOLEAN, p_public_showcase BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_project_lead(p_project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_brand_use IS NULL OR p_public_showcase IS NULL THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_PERMISSION'; END IF;
  IF p_brand_use AND NOT public.web_all_contributors_consented(p_project_id, 'phantoms_brand_assets') THEN
    RAISE EXCEPTION 'WEB_PROJECT_BRAND_CONSENT_REQUIRED';
  END IF;
  IF p_public_showcase AND NOT public.web_all_contributors_consented(p_project_id, 'public_showcase') THEN
    RAISE EXCEPTION 'WEB_PROJECT_SHOWCASE_CONSENT_REQUIRED';
  END IF;
  UPDATE public.web_projects SET phantoms_brand_permission = p_brand_use,
    public_showcase_permission = p_public_showcase WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND'; END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.web_set_project_permissions(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_set_project_permissions(UUID, BOOLEAN, BOOLEAN) TO authenticated;

CREATE FUNCTION public.web_set_project_status(p_project_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old TEXT;
  v_allowed BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT public.web_is_project_lead(p_project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_status IS NULL OR p_status NOT IN (
    'proposed','reviewing','approved','planning','active','on_hold','completed','archived','rejected'
  ) THEN RAISE EXCEPTION 'INVALID_WEB_PROJECT_STATUS'; END IF;
  SELECT status INTO v_old FROM public.web_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_NOT_FOUND'; END IF;
  v_allowed := CASE v_old
    WHEN 'proposed' THEN p_status IN ('reviewing','approved','rejected')
    WHEN 'reviewing' THEN p_status IN ('approved','rejected')
    WHEN 'approved' THEN p_status IN ('planning','on_hold','archived')
    WHEN 'planning' THEN p_status IN ('active','on_hold','completed','archived')
    WHEN 'active' THEN p_status IN ('on_hold','completed')
    WHEN 'on_hold' THEN p_status IN ('planning','active','completed','archived')
    WHEN 'completed' THEN p_status = 'archived'
    WHEN 'rejected' THEN p_status = 'archived'
    ELSE FALSE
  END;
  IF NOT v_allowed AND p_status <> v_old THEN RAISE EXCEPTION 'WEB_PROJECT_INVALID_STATUS_TRANSITION'; END IF;
  UPDATE public.web_projects SET status = p_status WHERE id = p_project_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.web_set_project_status(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_set_project_status(UUID, TEXT) TO authenticated;

CREATE FUNCTION public.web_transition_project_task(p_task_id UUID, p_to_status TEXT, p_comment TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.web_project_tasks%ROWTYPE;
  v_member_id BIGINT := public.web_current_member_id();
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_task_id IS NULL OR p_to_status IS NULL OR p_to_status NOT IN (
    'backlog','todo','in_progress','in_review','blocked','done','cancelled'
  ) OR (p_comment IS NOT NULL AND char_length(p_comment) > 10000) THEN
    RAISE EXCEPTION 'INVALID_WEB_PROJECT_TASK_TRANSITION';
  END IF;
  SELECT * INTO v_task FROM public.web_project_tasks AS t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_NOT_FOUND'; END IF;
  IF NOT (public.web_is_program_admin() OR public.web_is_project_lead(v_task.project_id)) THEN
    IF v_member_id IS NULL OR NOT public.web_is_project_contributor(v_task.project_id)
       OR NOT public.web_is_task_assignee(v_task.project_id, v_task.id) THEN
      RAISE EXCEPTION 'WEB_PROJECT_TASK_ASSIGNEE_OR_LEAD_REQUIRED';
    END IF;
  END IF;
  v_allowed := CASE v_task.status
    WHEN 'backlog' THEN p_to_status IN ('todo','cancelled')
    WHEN 'todo' THEN p_to_status IN ('backlog','in_progress','blocked','cancelled')
    WHEN 'in_progress' THEN p_to_status IN ('todo','in_review','blocked','cancelled')
    WHEN 'in_review' THEN p_to_status IN ('in_progress','done','blocked')
    WHEN 'blocked' THEN p_to_status IN ('in_progress','cancelled')
    WHEN 'done' THEN (p_to_status = 'in_progress' AND (public.web_is_program_admin() OR public.web_is_project_lead(v_task.project_id)))
    WHEN 'cancelled' THEN (p_to_status = 'backlog' AND (public.web_is_program_admin() OR public.web_is_project_lead(v_task.project_id)))
    ELSE FALSE
  END;
  IF NOT v_allowed AND p_to_status <> v_task.status THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_INVALID_STATUS_TRANSITION'; END IF;
  UPDATE public.web_project_tasks
  SET status = p_to_status,
      completed_at = CASE WHEN p_to_status = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE id = p_task_id;
  IF p_comment IS NOT NULL AND char_length(btrim(p_comment)) > 0 THEN
    INSERT INTO public.web_project_task_comments (
      project_id, task_id, author_member_id, author_auth_user_id, body
    ) VALUES (v_task.project_id, p_task_id, v_member_id, auth.uid(), btrim(p_comment));
  END IF;
  RETURN p_to_status;
END;
$$;
REVOKE ALL ON FUNCTION public.web_transition_project_task(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_transition_project_task(UUID, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public.web_submit_member_report(
  p_project_id UUID, p_period_start DATE, p_period_end DATE,
  p_completed_this_week TEXT, p_working_on TEXT, p_next_week_plan TEXT,
  p_deliverables_complete BOOLEAN, p_blockers TEXT, p_support_needed BOOLEAN,
  p_references_and_attachments JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR v_member_id IS NULL THEN RAISE EXCEPTION 'CANONICAL_MEMBER_BINDING_REQUIRED'; END IF;
  IF p_project_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_start > p_period_end
     OR p_completed_this_week IS NULL OR p_working_on IS NULL OR p_next_week_plan IS NULL
     OR p_deliverables_complete IS NULL OR p_blockers IS NULL OR p_support_needed IS NULL
     OR p_references_and_attachments IS NULL OR jsonb_typeof(p_references_and_attachments) <> 'array'
     OR char_length(p_completed_this_week) > 10000 OR char_length(p_working_on) > 10000
     OR char_length(p_next_week_plan) > 10000 OR char_length(p_blockers) > 10000 THEN
    RAISE EXCEPTION 'INVALID_WEB_PROJECT_REPORT';
  END IF;
  IF NOT public.web_is_project_contributor(p_project_id) OR NOT EXISTS (
    SELECT 1 FROM public.web_project_members AS m
    JOIN public.web_projects AS p ON p.id = m.project_id
    WHERE m.project_id = p_project_id AND m.member_id = v_member_id
      AND m.status = 'active' AND m.role IN ('lead','contributor')
      AND m.accepted_agreement_version = p.current_agreement_version
  ) THEN RAISE EXCEPTION 'WEB_PROJECT_CONTRIBUTOR_ACCESS_REQUIRED'; END IF;
  INSERT INTO public.web_project_member_reports (
    project_id, member_id, period_start, period_end, completed_this_week, working_on,
    next_week_plan, deliverables_complete, blockers, support_needed, references_and_attachments
  ) VALUES (
    p_project_id, v_member_id, p_period_start, p_period_end, p_completed_this_week,
    p_working_on, p_next_week_plan, p_deliverables_complete, p_blockers,
    p_support_needed, p_references_and_attachments
  )
  ON CONFLICT (project_id, member_id, period_start) DO UPDATE
  SET period_end = EXCLUDED.period_end,
      completed_this_week = EXCLUDED.completed_this_week,
      working_on = EXCLUDED.working_on,
      next_week_plan = EXCLUDED.next_week_plan,
      deliverables_complete = EXCLUDED.deliverables_complete,
      blockers = EXCLUDED.blockers,
      support_needed = EXCLUDED.support_needed,
      references_and_attachments = EXCLUDED.references_and_attachments,
      status = 'submitted', reviewed_by_auth_user_id = NULL, reviewed_at = NULL,
      review_notes = '', blocker_escalated = FALSE, submitted_at = now(), updated_at = now()
  WHERE public.web_project_member_reports.status IN ('submitted','needs_clarification')
  RETURNING id INTO v_report_id;
  IF v_report_id IS NULL THEN RAISE EXCEPTION 'WEB_PROJECT_REPORT_ALREADY_REVIEWED'; END IF;
  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_submit_member_report(UUID, DATE, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, JSONB)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_submit_member_report(UUID, DATE, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, JSONB)
  TO authenticated;

CREATE FUNCTION public.web_review_member_report(
  p_report_id UUID, p_status TEXT, p_review_notes TEXT, p_blocker_escalated BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id UUID;
  v_member_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR p_report_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('needs_clarification','reviewed')
     OR p_review_notes IS NULL OR char_length(p_review_notes) > 10000 OR p_blocker_escalated IS NULL THEN
    RAISE EXCEPTION 'INVALID_WEB_PROJECT_REPORT_REVIEW';
  END IF;
  SELECT project_id, member_id INTO v_project_id, v_member_id
  FROM public.web_project_member_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_REPORT_NOT_FOUND'; END IF;
  IF NOT (public.web_is_program_admin() OR public.web_is_project_lead(v_project_id)) THEN
    RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED';
  END IF;
  IF public.web_current_member_id() = v_member_id THEN RAISE EXCEPTION 'WEB_PROJECT_REPORT_SELF_REVIEW_FORBIDDEN'; END IF;
  UPDATE public.web_project_member_reports
  SET status = p_status, reviewed_by_auth_user_id = auth.uid(), reviewed_at = now(),
      review_notes = p_review_notes, blocker_escalated = p_blocker_escalated, updated_at = now()
  WHERE id = p_report_id AND status IN ('submitted','needs_clarification');
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_REPORT_REVIEW_STATE_INVALID'; END IF;
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.web_review_member_report(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_review_member_report(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- RLS is enabled on every new table. Anonymous and service-role direct table
-- access is revoked; the browser uses authenticated RLS and narrow RPCs only.
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'web_program_admin_audit','web_ideas','web_idea_contributors','web_idea_reviews',
    'web_projects','web_project_agreements','web_project_members','web_project_agreement_acceptances',
    'web_project_consents','web_project_milestones','web_project_milestone_dependencies',
    'web_project_deliverables','web_project_sprints','web_project_tasks','web_project_task_assignees',
    'web_project_task_comments','web_project_task_checklist_items','web_project_task_attachments',
    'web_project_updates','web_project_member_reports','web_resources','web_project_resource_refs',
    'web_project_integrations','web_project_activity_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE
  public.web_program_admin_audit, public.web_ideas, public.web_idea_contributors, public.web_idea_reviews,
  public.web_projects, public.web_project_agreements, public.web_project_members,
  public.web_project_agreement_acceptances, public.web_project_consents,
  public.web_project_milestones, public.web_project_milestone_dependencies,
  public.web_project_deliverables, public.web_project_sprints, public.web_project_tasks,
  public.web_project_task_assignees, public.web_project_task_comments,
  public.web_project_task_checklist_items, public.web_project_task_attachments,
  public.web_project_updates, public.web_project_member_reports,
  public.web_resources, public.web_project_resource_refs, public.web_project_integrations,
  public.web_project_activity_logs TO authenticated;

GRANT INSERT ON public.web_ideas, public.web_idea_contributors,
  public.web_project_milestones, public.web_project_milestone_dependencies,
  public.web_project_deliverables, public.web_project_sprints, public.web_project_tasks,
  public.web_project_task_assignees, public.web_project_task_comments,
  public.web_project_task_checklist_items, public.web_project_task_attachments,
  public.web_project_updates, public.web_resources, public.web_project_resource_refs,
  public.web_project_integrations TO authenticated;
GRANT UPDATE, DELETE ON public.web_project_milestones, public.web_project_milestone_dependencies,
  public.web_project_sprints, public.web_project_task_assignees,
  public.web_project_task_checklist_items TO authenticated;
GRANT UPDATE (title, description, evidence, due_date, task_id, milestone_id,
  status, submitted_at, reviewed_by_auth_user_id, reviewed_at, review_notes, updated_at)
  ON public.web_project_deliverables TO authenticated;
GRANT UPDATE (title, description, priority, start_date, due_date, estimated_effort,
  actual_effort, labels, parent_task_id, milestone_id, sprint_id, updated_at)
  ON public.web_project_tasks TO authenticated;
GRANT UPDATE (status, reviewed_by_auth_user_id, reviewed_at, review_notes, blocker_escalated, updated_at)
  ON public.web_project_member_reports TO authenticated;
GRANT UPDATE (name, slug, logo_url, cover_image_url, short_description, description, category,
  priority, expected_delivery_date, problem_statement, proposed_solution, target_audience,
  phantoms_benefit, graduation_project, potential_use_cases, required_skills,
  estimated_complexity, tech_stack, supporting_documents, repository_url, live_demo_url,
  figma_url, documentation_url, phantoms_assets_used, expected_phantoms_contribution,
  technical_support_arrangement, updated_at)
  ON public.web_projects TO authenticated;
GRANT UPDATE, DELETE ON public.web_project_resource_refs, public.web_project_integrations TO authenticated;
GRANT UPDATE (title, description, category, tags, preview_url, external_url,
  storage_object_path, version_label, access_status, is_approved, updated_at)
  ON public.web_resources TO authenticated;

-- Program-admin audit is Owner-only, even among Web Projects program admins.
CREATE POLICY web_program_admin_audit_owner_read ON public.web_program_admin_audit
  FOR SELECT TO authenticated USING (public.is_owner());

CREATE POLICY web_ideas_author_or_admin_read ON public.web_ideas
  FOR SELECT TO authenticated
  USING (public.web_is_program_admin() OR submitted_by_member_id = public.web_current_member_id());
CREATE POLICY web_ideas_bound_author_insert ON public.web_ideas
  FOR INSERT TO authenticated
  WITH CHECK (
    (submitted_by_member_id = public.web_current_member_id() OR public.web_is_program_admin())
    AND review_status = 'proposed'
    AND reviewed_by_auth_user_id IS NULL AND reviewed_at IS NULL
    AND converted_project_id IS NULL AND converted_at IS NULL
  );
CREATE POLICY web_idea_contributors_scoped_read ON public.web_idea_contributors
  FOR SELECT TO authenticated
  USING (public.web_is_program_admin() OR EXISTS (
    SELECT 1 FROM public.web_ideas AS i
    WHERE i.id = idea_id AND i.submitted_by_member_id = public.web_current_member_id()
  ));
CREATE POLICY web_idea_contributors_author_insert ON public.web_idea_contributors
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.web_ideas AS i
    WHERE i.id = idea_id AND i.review_status = 'proposed'
      AND (public.web_is_program_admin() OR i.submitted_by_member_id = public.web_current_member_id())
  ));
CREATE POLICY web_idea_reviews_author_or_admin_read ON public.web_idea_reviews
  FOR SELECT TO authenticated
  USING (public.web_is_program_admin() OR EXISTS (
    SELECT 1 FROM public.web_ideas AS i
    WHERE i.id = idea_id AND i.submitted_by_member_id = public.web_current_member_id()
  ));

CREATE POLICY web_projects_scoped_read ON public.web_projects
  FOR SELECT TO authenticated USING (public.web_can_access_project(id));
CREATE POLICY web_projects_scoped_update ON public.web_projects
  FOR UPDATE TO authenticated
  USING (public.web_is_project_lead(id))
  WITH CHECK (public.web_is_project_lead(id));

CREATE POLICY web_project_agreements_pending_or_member_read ON public.web_project_agreements
  FOR SELECT TO authenticated USING (public.web_can_read_agreement(project_id));
CREATE POLICY web_project_members_scoped_read ON public.web_project_members
  FOR SELECT TO authenticated
  USING (public.web_can_access_project(project_id)
    OR member_id = public.web_current_member_id()
    OR public.web_is_program_admin());
CREATE POLICY web_project_acceptances_private_read ON public.web_project_agreement_acceptances
  FOR SELECT TO authenticated
  USING (member_id = public.web_current_member_id()
    OR public.web_is_project_lead(project_id)
    OR public.web_is_program_admin());
CREATE POLICY web_project_consents_private_read ON public.web_project_consents
  FOR SELECT TO authenticated
  USING (member_id = public.web_current_member_id()
    OR public.web_is_project_lead(project_id)
    OR public.web_is_program_admin());

CREATE POLICY web_project_milestones_read ON public.web_project_milestones
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_milestones_manage ON public.web_project_milestones
  FOR ALL TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (public.web_is_project_lead(project_id));
CREATE POLICY web_project_milestone_dependencies_read ON public.web_project_milestone_dependencies
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_milestone_dependencies_manage ON public.web_project_milestone_dependencies
  FOR ALL TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (public.web_is_project_lead(project_id));

CREATE POLICY web_project_deliverables_read ON public.web_project_deliverables
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_deliverables_submit ON public.web_project_deliverables
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by_member_id = public.web_current_member_id()
    AND public.web_is_project_contributor(project_id)
    AND status IN ('draft','submitted')
    AND (reviewed_by_auth_user_id IS NULL AND reviewed_at IS NULL)
  );
CREATE POLICY web_project_deliverables_lead_request ON public.web_project_deliverables
  FOR INSERT TO authenticated
  WITH CHECK (
    public.web_is_project_lead(project_id)
    AND status = 'draft' AND submitted_at IS NULL
    AND reviewed_by_auth_user_id IS NULL AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.web_project_members AS m
      JOIN public.web_projects AS p ON p.id = m.project_id
      WHERE m.project_id = web_project_deliverables.project_id
        AND m.member_id = web_project_deliverables.submitted_by_member_id
        AND m.status = 'active' AND m.role = 'contributor'
        AND m.accepted_agreement_version = p.current_agreement_version
    )
  );
CREATE POLICY web_project_deliverables_review ON public.web_project_deliverables
  FOR UPDATE TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (public.web_is_project_lead(project_id));
CREATE POLICY web_project_deliverables_member_resubmit ON public.web_project_deliverables
  FOR UPDATE TO authenticated
  USING (submitted_by_member_id = public.web_current_member_id()
    AND status IN ('draft','submitted','revision_requested','rejected')
    AND public.web_is_project_contributor(project_id))
  WITH CHECK (
    submitted_by_member_id = public.web_current_member_id()
    AND public.web_is_project_contributor(project_id)
    AND status IN ('draft','submitted')
    AND (status = 'draft' OR submitted_at IS NOT NULL)
    AND reviewed_by_auth_user_id IS NULL AND reviewed_at IS NULL
  );

CREATE POLICY web_project_sprints_read ON public.web_project_sprints
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_sprints_manage ON public.web_project_sprints
  FOR ALL TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (public.web_is_project_lead(project_id));

CREATE POLICY web_project_tasks_read ON public.web_project_tasks
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_tasks_lead_insert ON public.web_project_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.web_is_project_lead(project_id)
    AND created_by_auth_user_id = auth.uid()
    AND status = 'backlog' AND completed_at IS NULL
  );
CREATE POLICY web_project_tasks_scoped_update ON public.web_project_tasks
  FOR UPDATE TO authenticated
  USING (public.web_is_project_lead(project_id) OR public.web_is_task_assignee(project_id, id))
  WITH CHECK (public.web_is_project_lead(project_id) OR public.web_is_task_assignee(project_id, id));

CREATE POLICY web_project_task_assignees_read ON public.web_project_task_assignees
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_task_assignees_manage ON public.web_project_task_assignees
  FOR ALL TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (
    public.web_is_project_lead(project_id)
    AND assigned_by_auth_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.web_project_members AS m
      WHERE m.project_id = web_project_task_assignees.project_id
        AND m.member_id = web_project_task_assignees.member_id
        AND m.status = 'active' AND m.role IN ('lead','contributor')
    )
  );
CREATE POLICY web_project_task_comments_read ON public.web_project_task_comments
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_task_comments_insert ON public.web_project_task_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_auth_user_id = auth.uid()
    AND (author_member_id = public.web_current_member_id() OR
         (author_member_id IS NULL AND public.web_is_program_admin()))
    AND (public.web_is_project_contributor(project_id) OR public.web_is_project_lead(project_id))
  );
CREATE POLICY web_project_task_checklist_read ON public.web_project_task_checklist_items
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_task_checklist_manage ON public.web_project_task_checklist_items
  FOR ALL TO authenticated
  USING (public.web_is_project_lead(project_id) OR public.web_is_task_assignee(project_id, task_id))
  WITH CHECK (
    (public.web_is_project_lead(project_id) OR public.web_is_task_assignee(project_id, task_id))
    AND (created_by_member_id = public.web_current_member_id() OR public.web_is_project_lead(project_id))
  );
CREATE POLICY web_project_task_attachments_read ON public.web_project_task_attachments
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_task_attachments_insert ON public.web_project_task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by_member_id = public.web_current_member_id()
    AND public.web_is_project_contributor(project_id)
  );

CREATE POLICY web_project_updates_read ON public.web_project_updates
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_updates_insert ON public.web_project_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    author_member_id = public.web_current_member_id()
    AND public.web_is_project_contributor(project_id)
    AND (update_type = 'blocker' OR blocker_status = 'open')
  );
CREATE POLICY web_project_updates_lead_update ON public.web_project_updates
  FOR UPDATE TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (public.web_is_project_lead(project_id));

CREATE POLICY web_project_member_reports_author_lead_admin_read ON public.web_project_member_reports
  FOR SELECT TO authenticated
  USING (public.web_can_view_report(project_id, member_id));

CREATE POLICY web_resources_approved_or_project_read ON public.web_resources
  FOR SELECT TO authenticated
  USING (
    public.web_is_program_admin()
    OR (project_id IS NULL AND is_approved AND access_status = 'approved')
    OR (project_id IS NOT NULL AND public.web_can_access_project(project_id))
  );
CREATE POLICY web_resources_scoped_insert ON public.web_resources
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_auth_user_id = auth.uid()
    AND ((project_id IS NULL AND public.web_is_program_admin())
      OR (project_id IS NOT NULL AND public.web_is_project_lead(project_id)
          AND scope_id = project_id))
  );
CREATE POLICY web_resources_scoped_update ON public.web_resources
  FOR UPDATE TO authenticated
  USING (public.web_is_program_admin() OR (project_id IS NOT NULL AND public.web_is_project_lead(project_id)))
  WITH CHECK (public.web_is_program_admin() OR (project_id IS NOT NULL AND public.web_is_project_lead(project_id)));

CREATE POLICY web_project_resource_refs_read ON public.web_project_resource_refs
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_resource_refs_insert ON public.web_project_resource_refs
  FOR INSERT TO authenticated
  WITH CHECK (
    added_by_auth_user_id = auth.uid()
    AND public.web_is_project_lead(project_id)
  );
CREATE POLICY web_project_resource_refs_delete ON public.web_project_resource_refs
  FOR DELETE TO authenticated USING (public.web_is_project_lead(project_id));

CREATE POLICY web_project_integrations_read ON public.web_project_integrations
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));
CREATE POLICY web_project_integrations_manage ON public.web_project_integrations
  FOR ALL TO authenticated
  USING (public.web_is_project_lead(project_id))
  WITH CHECK (public.web_is_project_lead(project_id) AND created_by_auth_user_id = auth.uid());
CREATE POLICY web_project_activity_scoped_read ON public.web_project_activity_logs
  FOR SELECT TO authenticated USING (public.web_can_access_project(project_id));

CREATE VIEW public.web_project_progress WITH (security_invoker = true) AS
SELECT p.id AS project_id,
       count(t.id) FILTER (WHERE t.status <> 'cancelled')::bigint AS task_count,
       count(t.id) FILTER (WHERE t.status = 'done')::bigint AS completed_task_count,
       CASE WHEN count(t.id) FILTER (WHERE t.status <> 'cancelled') = 0 THEN NULL::numeric
            ELSE round(100.0 * count(t.id) FILTER (WHERE t.status = 'done')
                 / count(t.id) FILTER (WHERE t.status <> 'cancelled'), 2) END AS progress_percent
FROM public.web_projects AS p
LEFT JOIN public.web_project_tasks AS t ON t.project_id = p.id
GROUP BY p.id;

CREATE VIEW public.web_project_milestone_progress WITH (security_invoker = true) AS
SELECT m.project_id, m.id AS milestone_id, m.title AS milestone_title,
       t.linked_task_count, t.completed_task_count,
       d.linked_deliverable_count, d.accepted_deliverable_count,
       t.linked_task_count + d.linked_deliverable_count AS tracked_item_count,
       t.completed_task_count + d.accepted_deliverable_count AS completed_item_count,
       CASE WHEN t.linked_task_count + d.linked_deliverable_count = 0 THEN NULL::numeric
            ELSE round(100.0 * (t.completed_task_count + d.accepted_deliverable_count)
                 / (t.linked_task_count + d.linked_deliverable_count), 2) END AS progress_percent
FROM public.web_project_milestones AS m
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE task.status <> 'cancelled')::bigint AS linked_task_count,
         count(*) FILTER (WHERE task.status = 'done')::bigint AS completed_task_count
  FROM public.web_project_tasks AS task
  WHERE task.project_id = m.project_id AND task.milestone_id = m.id
) AS t
CROSS JOIN LATERAL (
  SELECT count(*)::bigint AS linked_deliverable_count,
         count(*) FILTER (WHERE deliverable.status = 'accepted')::bigint AS accepted_deliverable_count
  FROM public.web_project_deliverables AS deliverable
  WHERE deliverable.project_id = m.project_id AND deliverable.milestone_id = m.id
) AS d;

CREATE VIEW public.web_project_sprint_progress WITH (security_invoker = true) AS
SELECT s.project_id, s.id AS sprint_id, s.name AS sprint_name,
       count(t.id) FILTER (WHERE t.status <> 'cancelled')::bigint AS task_count,
       count(t.id) FILTER (WHERE t.status = 'done')::bigint AS completed_task_count,
       count(t.id) FILTER (WHERE t.status = 'blocked')::bigint AS blocked_task_count,
       CASE WHEN count(t.id) FILTER (WHERE t.status <> 'cancelled') = 0 THEN NULL::numeric
            ELSE round(100.0 * count(t.id) FILTER (WHERE t.status = 'done')
                 / count(t.id) FILTER (WHERE t.status <> 'cancelled'), 2) END AS progress_percent
FROM public.web_project_sprints AS s
LEFT JOIN public.web_project_tasks AS t ON t.project_id = s.project_id AND t.sprint_id = s.id
GROUP BY s.project_id, s.id, s.name;

REVOKE ALL ON public.web_project_progress, public.web_project_milestone_progress,
  public.web_project_sprint_progress FROM PUBLIC, anon, service_role;
GRANT SELECT ON public.web_project_progress, public.web_project_milestone_progress,
  public.web_project_sprint_progress TO authenticated;

CREATE FUNCTION public.web_validate_idea_contributor_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.web_member_has_auth_binding(NEW.member_id) THEN
    RAISE EXCEPTION 'WEB_IDEA_CONTRIBUTOR_MUST_HAVE_CANONICAL_BINDING';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_idea_contributor_binding() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_idea_contributors_binding_guard
  BEFORE INSERT OR UPDATE ON public.web_idea_contributors
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_idea_contributor_binding();

CREATE TRIGGER web_idea_reviews_no_mutation
  BEFORE UPDATE OR DELETE ON public.web_idea_reviews
  FOR EACH ROW EXECUTE FUNCTION public.web_prevent_append_only_mutation();
CREATE TRIGGER web_idea_reviews_no_truncate
  BEFORE TRUNCATE ON public.web_idea_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION public.web_prevent_append_only_mutation();

CREATE FUNCTION public.web_validate_task_reporter_and_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.parent_task_id = NEW.id THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_CANNOT_PARENT_ITSELF'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.web_project_members AS m
    JOIN public.web_projects AS p ON p.id = m.project_id
    WHERE m.project_id = NEW.project_id AND m.member_id = NEW.reporter_member_id
      AND m.status = 'active' AND m.role IN ('lead','contributor')
      AND m.accepted_agreement_version = p.current_agreement_version
  ) THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_REPORTER_MUST_BE_ACTIVE_CONTRIBUTOR'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_task_reporter_and_parent() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_task_reporter_guard
  BEFORE INSERT OR UPDATE OF project_id, reporter_member_id, parent_task_id ON public.web_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_task_reporter_and_parent();

CREATE FUNCTION public.web_validate_task_assignee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.web_project_members AS m
    JOIN public.web_projects AS p ON p.id = m.project_id
    WHERE m.project_id = NEW.project_id AND m.member_id = NEW.member_id
      AND m.status = 'active' AND m.role IN ('lead','contributor')
      AND m.accepted_agreement_version = p.current_agreement_version
  ) THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_ASSIGNEE_MUST_BE_ACTIVE_CONTRIBUTOR'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_task_assignee() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_task_assignee_guard
  BEFORE INSERT OR UPDATE ON public.web_project_task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_task_assignee();

CREATE FUNCTION public.web_validate_contributor_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT;
  v_role TEXT;
BEGIN
  IF TG_TABLE_NAME = 'web_project_deliverables' THEN
    v_member_id := NEW.submitted_by_member_id;
  ELSIF TG_TABLE_NAME = 'web_project_updates' THEN
    v_member_id := NEW.author_member_id;
  ELSIF TG_TABLE_NAME = 'web_project_task_checklist_items' THEN
    v_member_id := COALESCE(NEW.updated_by_member_id, NEW.created_by_member_id);
    IF TG_OP = 'UPDATE' THEN NEW.updated_by_member_id := public.web_current_member_id(); END IF;
  ELSIF TG_TABLE_NAME = 'web_project_task_attachments' THEN
    v_member_id := NEW.uploaded_by_member_id;
  ELSIF TG_TABLE_NAME = 'web_project_task_comments' THEN
    v_member_id := NEW.author_member_id;
  END IF;
  IF v_member_id IS NULL AND TG_TABLE_NAME = 'web_project_task_comments'
     AND public.web_is_program_admin() THEN RETURN NEW; END IF;
  SELECT m.role INTO v_role
  FROM public.web_project_members AS m
  JOIN public.web_projects AS p ON p.id = m.project_id
  WHERE m.project_id = NEW.project_id AND m.member_id = v_member_id
    AND m.status = 'active' AND m.accepted_agreement_version = p.current_agreement_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_ACTIVE_MEMBERSHIP_REQUIRED'; END IF;
  IF TG_TABLE_NAME IN ('web_project_deliverables','web_project_updates','web_project_task_attachments')
     AND v_role NOT IN ('lead','contributor') THEN
    RAISE EXCEPTION 'WEB_PROJECT_CONTRIBUTOR_ROLE_REQUIRED';
  END IF;
  IF TG_TABLE_NAME = 'web_project_task_comments'
     AND NOT (v_role IN ('lead','contributor') OR public.web_is_project_lead(NEW.project_id)) THEN
    RAISE EXCEPTION 'WEB_PROJECT_CONTRIBUTOR_ROLE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_contributor_row() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_deliverable_submitter_guard
  BEFORE INSERT OR UPDATE OF project_id, submitted_by_member_id ON public.web_project_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_contributor_row();
CREATE TRIGGER web_project_update_author_guard
  BEFORE INSERT OR UPDATE OF project_id, author_member_id ON public.web_project_updates
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_contributor_row();
CREATE TRIGGER web_project_task_comment_author_guard
  BEFORE INSERT OR UPDATE OF project_id, author_member_id ON public.web_project_task_comments
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_contributor_row();
CREATE TRIGGER web_project_task_checklist_author_guard
  BEFORE INSERT OR UPDATE OF project_id, created_by_member_id, updated_by_member_id ON public.web_project_task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_contributor_row();
CREATE TRIGGER web_project_task_attachment_uploader_guard
  BEFORE INSERT OR UPDATE OF project_id, uploaded_by_member_id ON public.web_project_task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_contributor_row();

CREATE FUNCTION public.web_prepare_deliverable_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('under_review','accepted','revision_requested','rejected')
       AND public.web_is_project_lead(NEW.project_id) THEN
      NEW.reviewed_by_auth_user_id := auth.uid();
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    ELSIF NEW.status = 'submitted'
       AND NEW.submitted_by_member_id = public.web_current_member_id() THEN
      NEW.reviewed_by_auth_user_id := NULL;
      NEW.reviewed_at := NULL;
      NEW.review_notes := '';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_prepare_deliverable_review() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_deliverable_review_metadata
  BEFORE UPDATE OF status ON public.web_project_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.web_prepare_deliverable_review();

CREATE FUNCTION public.web_validate_milestone_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task_total BIGINT;
  v_task_done BIGINT;
  v_deliverable_total BIGINT;
  v_deliverable_accepted BIGINT;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE t.status <> 'cancelled'), count(*) FILTER (WHERE t.status = 'done')
    INTO v_task_total, v_task_done
  FROM public.web_project_tasks AS t
  WHERE t.project_id = NEW.project_id AND t.milestone_id = NEW.id;
  SELECT count(*), count(*) FILTER (WHERE d.status = 'accepted')
    INTO v_deliverable_total, v_deliverable_accepted
  FROM public.web_project_deliverables AS d
  WHERE d.project_id = NEW.project_id AND d.milestone_id = NEW.id;
  IF COALESCE(v_task_total, 0) + COALESCE(v_deliverable_total, 0) = 0 THEN
    RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_COMPLETION_REQUIRES_TRACKED_WORK';
  END IF;
  IF COALESCE(v_task_total, 0) <> COALESCE(v_task_done, 0)
     OR COALESCE(v_deliverable_total, 0) <> COALESCE(v_deliverable_accepted, 0) THEN
    RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_COMPLETION_REQUIRES_COMPLETED_WORK';
  END IF;
  IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_milestone_completion() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_milestone_completion_guard
  BEFORE INSERT OR UPDATE OF status, completed_at ON public.web_project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_milestone_completion();

CREATE FUNCTION public.web_validate_sprint_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total BIGINT;
  v_done BIGINT;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE t.status <> 'cancelled'), count(*) FILTER (WHERE t.status = 'done')
    INTO v_total, v_done
  FROM public.web_project_tasks AS t
  WHERE t.project_id = NEW.project_id AND t.sprint_id = NEW.id;
  IF COALESCE(v_total, 0) = 0 OR v_total <> v_done THEN
    RAISE EXCEPTION 'WEB_PROJECT_SPRINT_COMPLETION_REQUIRES_COMPLETED_TASKS';
  END IF;
  IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_validate_sprint_completion() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_sprint_completion_guard
  BEFORE INSERT OR UPDATE OF status, completed_at ON public.web_project_sprints
  FOR EACH ROW EXECUTE FUNCTION public.web_validate_sprint_completion();

CREATE FUNCTION public.web_reopen_finished_work_container()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id UUID;
  v_milestone_id UUID;
  v_sprint_id UUID;
  v_total BIGINT;
  v_done BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_project_id := OLD.project_id;
    IF TG_TABLE_NAME = 'web_project_tasks' THEN
      v_milestone_id := OLD.milestone_id; v_sprint_id := OLD.sprint_id;
    ELSE v_milestone_id := OLD.milestone_id; END IF;
  ELSE
    v_project_id := NEW.project_id;
    IF TG_TABLE_NAME = 'web_project_tasks' THEN
      v_milestone_id := NEW.milestone_id; v_sprint_id := NEW.sprint_id;
    ELSE v_milestone_id := NEW.milestone_id; END IF;
  END IF;
  IF TG_TABLE_NAME = 'web_project_tasks' AND TG_OP = 'UPDATE' THEN
    IF OLD.milestone_id IS DISTINCT FROM NEW.milestone_id THEN
      UPDATE public.web_project_milestones SET status = 'in_progress', completed_at = NULL
      WHERE id = OLD.milestone_id AND project_id = OLD.project_id AND status = 'completed';
    END IF;
    IF OLD.sprint_id IS DISTINCT FROM NEW.sprint_id THEN
      UPDATE public.web_project_sprints SET status = 'active', completed_at = NULL
      WHERE id = OLD.sprint_id AND project_id = OLD.project_id AND status = 'completed';
    END IF;
  END IF;
  IF v_milestone_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE t.status <> 'cancelled'), count(*) FILTER (WHERE t.status = 'done')
      INTO v_total, v_done FROM public.web_project_tasks AS t
      WHERE t.project_id = v_project_id AND t.milestone_id = v_milestone_id;
    IF v_total > v_done THEN
      UPDATE public.web_project_milestones SET status = 'in_progress', completed_at = NULL
      WHERE id = v_milestone_id AND project_id = v_project_id AND status = 'completed';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE d.status = 'accepted')
      INTO v_total, v_done FROM public.web_project_deliverables AS d
      WHERE d.project_id = v_project_id AND d.milestone_id = v_milestone_id;
    IF v_total > v_done OR v_total = 0 THEN
      UPDATE public.web_project_milestones SET status = 'in_progress', completed_at = NULL
      WHERE id = v_milestone_id AND project_id = v_project_id AND status = 'completed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.web_project_milestones AS m WHERE m.id = v_milestone_id AND m.status = 'completed')
       AND (EXISTS (SELECT 1 FROM public.web_project_tasks AS t WHERE t.project_id = v_project_id AND t.milestone_id = v_milestone_id AND t.status NOT IN ('done','cancelled'))
         OR EXISTS (SELECT 1 FROM public.web_project_deliverables AS d WHERE d.project_id = v_project_id AND d.milestone_id = v_milestone_id AND d.status <> 'accepted')) THEN
      UPDATE public.web_project_milestones SET status = 'in_progress', completed_at = NULL
      WHERE id = v_milestone_id AND project_id = v_project_id AND status = 'completed';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'web_project_tasks' AND v_sprint_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE t.status <> 'cancelled'), count(*) FILTER (WHERE t.status = 'done')
      INTO v_total, v_done FROM public.web_project_tasks AS t
      WHERE t.project_id = v_project_id AND t.sprint_id = v_sprint_id;
    IF v_total > v_done OR v_total = 0 THEN
      UPDATE public.web_project_sprints SET status = 'active', completed_at = NULL
      WHERE id = v_sprint_id AND project_id = v_project_id AND status = 'completed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_reopen_finished_work_container() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_task_reopen_summaries
  AFTER INSERT OR UPDATE OF status, sprint_id, milestone_id OR DELETE ON public.web_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.web_reopen_finished_work_container();
CREATE TRIGGER web_project_deliverable_reopen_milestone
  AFTER INSERT OR UPDATE OF status, milestone_id OR DELETE ON public.web_project_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.web_reopen_finished_work_container();

CREATE FUNCTION public.web_check_task_parent_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_skip_id UUID := NULL;
BEGIN
  IF NEW.parent_task_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_task_id = NEW.id THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_CANNOT_PARENT_ITSELF'; END IF;
  PERFORM 1 FROM public.web_projects WHERE id = NEW.project_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN v_skip_id := OLD.id; END IF;
  IF EXISTS (
    WITH RECURSIVE parents(id) AS (
      SELECT NEW.parent_task_id
      UNION
      SELECT t.parent_task_id
      FROM public.web_project_tasks AS t
      JOIN parents AS p ON p.id = t.id
      WHERE t.project_id = NEW.project_id AND t.parent_task_id IS NOT NULL
        AND t.id IS DISTINCT FROM v_skip_id
    )
    SELECT 1 FROM parents WHERE id = NEW.id
  ) THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_PARENT_CYCLE'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_check_task_parent_cycle() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_task_parent_cycle_guard
  BEFORE INSERT OR UPDATE OF parent_task_id ON public.web_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.web_check_task_parent_cycle();

CREATE OR REPLACE FUNCTION public.web_check_milestone_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_skip_id UUID := NULL;
BEGIN
  IF NEW.milestone_id = NEW.depends_on_milestone_id THEN RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_SELF_DEPENDENCY'; END IF;
  PERFORM 1 FROM public.web_projects WHERE id = NEW.project_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN v_skip_id := OLD.id; END IF;
  IF EXISTS (
    WITH RECURSIVE reachable(id) AS (
      SELECT NEW.depends_on_milestone_id
      UNION
      SELECT d.depends_on_milestone_id
      FROM public.web_project_milestone_dependencies AS d
      JOIN reachable AS r ON r.id = d.milestone_id
      WHERE d.project_id = NEW.project_id AND d.id IS DISTINCT FROM v_skip_id
    )
    SELECT 1 FROM reachable WHERE id = NEW.milestone_id
  ) THEN RAISE EXCEPTION 'WEB_PROJECT_MILESTONE_DEPENDENCY_CYCLE'; END IF;
  RETURN NEW;
END;
$$;


CREATE FUNCTION public.web_create_idea(p_details JSONB, p_contributor_member_ids BIGINT[] DEFAULT ARRAY[]::BIGINT[])
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_submitter_id BIGINT;
  v_leader_id BIGINT;
  v_idea_id UUID := extensions.gen_random_uuid();
  v_admin BOOLEAN := public.web_is_program_admin();
  v_complexity TEXT;
BEGIN
  IF auth.uid() IS NULL OR (NOT v_admin AND v_member_id IS NULL) THEN
    RAISE EXCEPTION 'CANONICAL_MEMBER_BINDING_REQUIRED';
  END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR char_length(COALESCE(p_details ->> 'title','')) NOT BETWEEN 3 AND 180
     OR char_length(COALESCE(p_details ->> 'short_description','')) NOT BETWEEN 1 AND 800 THEN
    RAISE EXCEPTION 'INVALID_WEB_IDEA';
  END IF;
  IF (p_details ? 'potential_use_cases' AND jsonb_typeof(p_details -> 'potential_use_cases') <> 'array')
     OR (p_details ? 'suggested_tech_stack' AND jsonb_typeof(p_details -> 'suggested_tech_stack') <> 'array')
     OR (p_details ? 'required_skills' AND jsonb_typeof(p_details -> 'required_skills') <> 'array')
     OR (p_details ? 'supporting_documents' AND jsonb_typeof(p_details -> 'supporting_documents') <> 'array')
     OR (p_details ? 'graduation_project' AND jsonb_typeof(p_details -> 'graduation_project') <> 'boolean') THEN
    RAISE EXCEPTION 'INVALID_WEB_IDEA_FIELDS';
  END IF;
  v_complexity := COALESCE(p_details ->> 'estimated_complexity','unspecified');
  IF v_complexity NOT IN ('unspecified','small','medium','large','research') THEN
    RAISE EXCEPTION 'INVALID_WEB_IDEA_COMPLEXITY';
  END IF;
  IF v_admin THEN
    IF COALESCE(p_details ->> 'submitted_by_member_id','') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'WEB_IDEA_SUBMITTER_REQUIRED';
    END IF;
    v_submitter_id := (p_details ->> 'submitted_by_member_id')::bigint;
  ELSE
    v_submitter_id := v_member_id;
    IF p_details ? 'submitted_by_member_id'
       AND p_details ->> 'submitted_by_member_id' IS DISTINCT FROM v_member_id::text THEN
      RAISE EXCEPTION 'WEB_IDEA_SUBMITTER_MUST_BE_CURRENT_MEMBER';
    END IF;
  END IF;
  IF NOT public.web_member_has_auth_binding(v_submitter_id) THEN
    RAISE EXCEPTION 'WEB_IDEA_SUBMITTER_NOT_ACTIVE';
  END IF;
  IF p_details ? 'suggested_leader_member_id'
     AND jsonb_typeof(p_details -> 'suggested_leader_member_id') <> 'null' THEN
    IF COALESCE(p_details ->> 'suggested_leader_member_id','') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'INVALID_WEB_IDEA_LEADER';
    END IF;
    v_leader_id := (p_details ->> 'suggested_leader_member_id')::bigint;
    IF NOT public.web_member_has_auth_binding(v_leader_id) THEN
      RAISE EXCEPTION 'WEB_IDEA_LEADER_NOT_ACTIVE';
    END IF;
  END IF;
  IF p_contributor_member_ids IS NULL
     OR array_position(p_contributor_member_ids, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(p_contributor_member_ids) AS x WHERE x <= 0)
     OR cardinality(p_contributor_member_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_contributor_member_ids) AS x) THEN
    RAISE EXCEPTION 'INVALID_WEB_IDEA_CONTRIBUTORS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_contributor_member_ids) AS x
    WHERE NOT public.web_member_has_auth_binding(x)
  ) THEN RAISE EXCEPTION 'WEB_IDEA_CONTRIBUTOR_NOT_ACTIVE'; END IF;
  INSERT INTO public.web_ideas (
    id, title, short_description, problem_statement, proposed_solution, target_audience,
    phantoms_benefit, potential_use_cases, suggested_tech_stack, required_skills,
    estimated_complexity, suggested_leader_member_id, graduation_project, supporting_documents,
    submitted_by_member_id
  ) VALUES (
    v_idea_id, btrim(p_details ->> 'title'), btrim(p_details ->> 'short_description'),
    COALESCE(p_details ->> 'problem_statement',''), COALESCE(p_details ->> 'proposed_solution',''),
    COALESCE(p_details ->> 'target_audience',''), COALESCE(p_details ->> 'phantoms_benefit',''),
    COALESCE(p_details -> 'potential_use_cases','[]'::jsonb),
    COALESCE(p_details -> 'suggested_tech_stack','[]'::jsonb),
    COALESCE(p_details -> 'required_skills','[]'::jsonb), v_complexity, v_leader_id,
    COALESCE((p_details ->> 'graduation_project')::boolean,FALSE),
    COALESCE(p_details -> 'supporting_documents','[]'::jsonb), v_submitter_id
  );
  INSERT INTO public.web_idea_contributors (idea_id, member_id, responsibility)
  SELECT v_idea_id, x, '' FROM unnest(p_contributor_member_ids) AS x
  WHERE x <> v_submitter_id
  ON CONFLICT (idea_id, member_id) DO NOTHING;
  IF v_admin THEN
    INSERT INTO public.web_program_admin_audit (actor_auth_user_id, action, details)
    VALUES (auth.uid(), 'idea_created', jsonb_build_object('idea_id', v_idea_id, 'submitter_member_id', v_submitter_id));
  END IF;
  RETURN v_idea_id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_create_idea(JSONB, BIGINT[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_create_idea(JSONB, BIGINT[]) TO authenticated;

CREATE FUNCTION public.web_guard_task_assignment_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (OLD.parent_task_id IS DISTINCT FROM NEW.parent_task_id
      OR OLD.milestone_id IS DISTINCT FROM NEW.milestone_id
      OR OLD.sprint_id IS DISTINCT FROM NEW.sprint_id)
     AND NOT public.web_is_project_lead(NEW.project_id) THEN
    RAISE EXCEPTION 'WEB_PROJECT_TASK_ASSIGNMENT_METADATA_LEAD_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.web_guard_task_assignment_columns() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER web_project_task_assignment_metadata_guard
  BEFORE UPDATE OF parent_task_id, milestone_id, sprint_id ON public.web_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.web_guard_task_assignment_columns();

CREATE FUNCTION public.web_delete_project_task(p_task_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.web_project_tasks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_task_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_task FROM public.web_project_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_NOT_FOUND'; END IF;
  IF NOT public.web_is_project_lead(v_task.project_id) THEN RAISE EXCEPTION 'WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED'; END IF;
  IF v_task.status <> 'cancelled' THEN
    UPDATE public.web_project_tasks SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE id = p_task_id;
  END IF;
  RETURN 'cancelled';
END;
$$;
REVOKE ALL ON FUNCTION public.web_delete_project_task(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_delete_project_task(UUID) TO authenticated;

COMMIT;
