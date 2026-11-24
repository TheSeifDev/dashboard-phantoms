// =====================================================
// أنواع بيانات قاعدة بيانات PHANTOMS (Supabase / PostgreSQL)
// المصدر: supabase_setup.sql — MUST يطابق السكيما دائماً
// =====================================================

export type Member = {
  id: number;
  created_at: string;
  email: string;
  full_name: string;
  completion_rank: number | null;
  /** ملاحظات legacy عامة؛ بيانات النشاط الجديدة لها scope مستقل لكل فريق. */
  team_notes: string | null;
  residence: string | null;
  work_conditions: string | null;
  bio: string | null;
  phone: string | null;
  device: string | null;
  gender: string | null;
  meeting_attendance: string | null;
  work_status: string | null;
  can_go_alexandria: boolean;
  bonus_infinite: boolean;
  session_token?: string | null;
  /** قيم الحقول المخصصة الديناميكية لكل عضو { [fieldId]: value } */
  custom_fields?: Record<string, string | number | boolean | null>;
  /** Additive member information; legacy rows remain valid until completion. */
  academic_number?: string | null;
  academic_group?: string | null;
  specialization?: 'software' | 'hardware' | 'ai' | null;
  university_email?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
}

export type MemberInsert = Omit<Member, 'id' | 'created_at' | 'bonus_infinite' | 'university_email'>;
export type MemberUpdate = Partial<MemberInsert> & { id: Member['id'] };

export type MemberCustomFieldType = 'short_text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'select';

export type MemberCustomField = {
  id: number;
  team_id?: string | null;
  label: string;
  field_type: MemberCustomFieldType;
  options: string[];
  placeholder: string;
  show_in_card: boolean;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MemberCustomFieldInsert = Omit<MemberCustomField, 'id' | 'created_at' | 'updated_at'> & {
  updated_at?: string;
};

export type TaskStatus = 'pending' | 'in_progress' | 'under_review' | 'approved' | 'revision_requested';

/** حالة تتبع عضو داخل مهمة */
export interface TaskTrackingEntry {
  status: TaskStatus;
  note?: string;
  submission_url?: string;
  updated_at?: string;
  /** البونص الممنوح فعلياً عند الاعتماد (migration 0012) */
  bonus_awarded?: number;
  /** النقاط التي زادت فعلياً بعد حد 100، لعكس الاعتماد بدقة */
  rank_awarded?: number;
  bonus_note_id?: number | null;
  approval_reversal_reason?: string;
  approval_reversed_at?: string;
  approval_reversed_by?: string;
}

export type Task = {
  id: number;
  created_at: string;
  team_id?: string | null;
  title: string;
  description: string | null;
  has_deadline: boolean;
  deadline_date: string | null;
  /** JSONB: مصفوفة أرقام أعضاء أو "ALL" */
  assigned_to: string[] | string | null;
  /** JSONB: { [memberId: string]: TaskTrackingEntry } */
  tracking: Record<string, TaskTrackingEntry> | null;
  /** بونص يُمنح لكل عضو عند اعتماد تسليمه (0-50) — migration 0012. قد يغيب قبل تطبيقها. */
  bonus_points?: number | null;
}

export type TaskInsert = Omit<Task, 'id' | 'created_at'>;
export type TaskUpdate = Partial<TaskInsert> & { id: Task['id'] };

export type Note = {
  id: number;
  created_at: string;
  team_id?: string | null;
  text: string;
  author: string | null;
  author_role: string | null;
  date: string | null;
  target_member_id: number | null;
  target_name: string | null;
  source_task_id?: number | null;
  source_member_id?: number | null;
}

export type NoteInsert = Omit<Note, 'id' | 'created_at'>;

// ===== أنواع بيانات نظام الإعلامات =====
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

export type AnnouncementTargetAudience = {
  type: 'all';
} | {
  type: 'specific';
  member_ids: number[];
};

export type Announcement = {
  id: number;
  created_at: string;
  team_id?: string | null;
  title: string;
  content: string;
  target_audience: AnnouncementTargetAudience;
  priority: AnnouncementPriority;
  send_push: boolean;
  send_whatsapp: boolean;
  whatsapp_sent_at: string | null;
  whatsapp_sent_count: number;
  whatsapp_errors: any[];
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
  read_receipts: Record<string, { read_at?: string; dismissed_at?: string }>;
};

export type AnnouncementInsert = Omit<Announcement, 'id' | 'created_at' | 'read_receipts' | 'whatsapp_sent_at' | 'whatsapp_sent_count' | 'whatsapp_errors'>;

export type MemberAnnouncement = {
  id: number;
  created_at: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  is_read: boolean;
  is_dismissed: boolean;
};

export type AnnouncementStats = {
  total_recipients: number;
  read_count: number;
  dismissed_count: number;
  pending_count: number;
  viewed_count: number;
};

/** صف تفصيلي لعضو واحد داخل تقرير إعلان (للإدارة فقط — بلا أعمدة حساسة) */
export type AnnouncementMemberDetail = {
  member_id: number;
  full_name: string;
  email: string;
  viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  read_at: string | null;
  dismissed_at: string | null;
};

export type AdminRole = 'owner' | 'admin';

export type AdminPermission =
  | 'dashboard'
  | 'members'
  | 'tasks'
  | 'ranking'
  | 'notes'
  | 'announcements'
  | 'whatsapp'
  | 'ai_assistant'
  | 'web_projects';

export type AdminPermissions = Record<AdminPermission, boolean>;
export type TeamPermission = Exclude<AdminPermission, 'web_projects'>;
export type TeamPermissions = Record<TeamPermission, boolean>;
export type TeamAdminRole = 'head' | 'monitor';
export type TeamMembershipStatus = 'pending' | 'active' | 'suspended' | 'removed';

export interface TeamAccessEntry {
  team_id: string;
  slug: string;
  name: string;
  /** null means this is a picker item for an existing global Admin/Owner. */
  role: TeamAdminRole | null;
  permissions: Partial<TeamPermissions>;
}

export type TeamRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

export type TeamMembership = {
  team_id: string;
  member_id: number;
  status: TeamMembershipStatus;
  created_at: string;
  created_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  updated_at: string;
};

export type TeamAdminAssignment = {
  id: string;
  team_id: string;
  user_id: string;
  email: string;
  role: TeamAdminRole;
  permissions: TeamPermissions;
  created_at: string;
};

export interface TeamOverview {
  team_id: string;
  slug: string;
  name: string;
  is_active: boolean;
  member_count: number;
  assignments: TeamAdminAssignment[];
}

export interface TeamAdminCandidate {
  user_id: string;
  email: string;
  member_id: number | null;
  member_name: string | null;
  global_role: AdminRole | null;
}

export interface TeamMemberSummary {
  member_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  work_status: string | null;
  membership_status: TeamMembershipStatus;
  created_at: string;
}

export interface TeamMemberCandidate extends Omit<TeamMemberSummary, 'membership_status' | 'created_at'> {
  membership_status: TeamMembershipStatus | null;
}

export interface AdminAccess {
  is_admin: boolean;
  /** Real owner role only — governance of administrator accounts stays here. */
  is_owner: boolean;
  /** Owner authority: the real owner or an administrator granted full_owner. */
  owner_authority?: boolean;
  owner_authority_permanent?: boolean;
  /** Team-scoped only; never changes is_admin or global permissions. */
  is_team_admin: boolean;
  role: AdminRole | null;
  email: string | null;
  permissions: Partial<AdminPermissions>;
  /** نهاية صلاحيات المالك المؤقتة (منحة full_owner) لو موجودة. */
  owner_authority_until?: string | null;
  teams: TeamAccessEntry[];
}

export interface AdminAccount {
  user_id: string;
  email: string;
  role: AdminRole;
  created_at: string;
  created_by: string | null;
  permissions: AdminPermissions;
  /** سجل العضو المرتبط بنفس البريد — بيستخدم لتصفير كلمة المرور. */
  member_id: number | null;
}

/** نتيجة دالة تسجيل دخول العضو (RPC محصورة بالأعمدة العامة فقط — بلا session_token) */
export type MemberLookupRow = Pick<
  Member,
  'id' | 'created_at' | 'email' | 'full_name' | 'completion_rank' | 'bio' | 'device' | 'meeting_attendance' | 'work_status' | 'can_go_alexandria'
>;

/** نتيجة دالة الاعتماد الذرّي */
export interface ApproveTaskResult {
  task_id: number;
  member_id: number;
  status: 'approved';
  completion_rank: number | null;
  bonus_awarded?: number;
  rank_awarded?: number;
  total_bonus?: number;
}

export interface RevokeTaskApprovalResult {
  task_id: number;
  member_id: number;
  status: 'revision_requested';
  completion_rank: number;
  rank_reversed: number;
  bonus_reversed: number;
}

export type MemberEvaluationGrade = 'excellent' | 'very_good' | 'good' | 'needs_improvement' | 'warning';

export type MemberEvaluation = {
  id: number;
  created_at: string;
  team_id?: string | null;
  member_id: number;
  title: string;
  grade: MemberEvaluationGrade;
  /** stars = منح نجوم، minus = خصم نجوم، strike = تحذير (بدون نجوم). */
  kind?: 'stars' | 'minus' | 'strike';
  points: number;
  feedback: string;
  evaluator_name: string;
  bonus_note_id?: number | null;
  viewed_at?: string | null;
  read_at?: string | null;
  created_by?: string | null;
};

export type MemberEvaluationInsert = Omit<MemberEvaluation, 'id' | 'created_at'>;

export interface Database {
  public: {
    Tables: {
      teams: { Row: TeamRow; Insert: Omit<TeamRow, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<TeamRow>; Relationships: [] };
      team_memberships: { Row: TeamMembership; Insert: Omit<TeamMembership, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }; Update: Partial<TeamMembership>; Relationships: [] };
      team_admin_assignments: { Row: Omit<TeamAdminAssignment, 'email'> & { created_by: string | null }; Insert: Omit<TeamAdminAssignment, 'email' | 'created_at'> & { created_at?: string; created_by: string | null }; Update: Partial<Omit<TeamAdminAssignment, 'email'>>; Relationships: [] };
      team_member_metrics: { Row: { team_id: string; member_id: number; completion_rank: number; bonus_infinite: boolean; bonus_points: number; updated_at: string; updated_by: string | null }; Insert: { team_id: string; member_id: number; completion_rank?: number; bonus_infinite?: boolean; bonus_points?: number; updated_at?: string; updated_by?: string | null }; Update: Partial<{ team_id: string; member_id: number; completion_rank: number; bonus_infinite: boolean; bonus_points: number; updated_at: string; updated_by: string | null }>; Relationships: [] };
      team_member_custom_field_values: { Row: { team_id: string; member_id: number; field_id: number; value: unknown; updated_at: string; updated_by: string | null }; Insert: { team_id: string; member_id: number; field_id: number; value: unknown; updated_at?: string; updated_by?: string | null }; Update: Partial<{ team_id: string; member_id: number; field_id: number; value: unknown; updated_at: string; updated_by: string | null }>; Relationships: [] };
      announcement_recipients: { Row: { announcement_id: number; team_id: string; member_id: number; created_at: string; viewed_at: string | null; read_at: string | null; dismissed_at: string | null }; Insert: { announcement_id: number; team_id: string; member_id: number; created_at?: string; viewed_at?: string | null; read_at?: string | null; dismissed_at?: string | null }; Update: Partial<{ announcement_id: number; team_id: string; member_id: number; created_at: string; viewed_at: string | null; read_at: string | null; dismissed_at: string | null }>; Relationships: [] };
      members: { Row: Member; Insert: MemberInsert; Update: Partial<MemberInsert>; Relationships: [] };
      member_custom_fields: { Row: MemberCustomField; Insert: MemberCustomFieldInsert; Update: Partial<MemberCustomFieldInsert>; Relationships: [] };
      member_evaluations: { Row: MemberEvaluation; Insert: MemberEvaluationInsert; Update: Partial<MemberEvaluationInsert>; Relationships: [] };
      member_strikes: { Row: MemberStrike; Insert: Omit<MemberStrike, 'id' | 'created_at'> & { created_at?: string }; Update: Partial<Omit<MemberStrike, 'id' | 'created_at'>>; Relationships: [] };
      tasks: { Row: Task; Insert: TaskInsert; Update: Partial<TaskInsert>; Relationships: [] };
      notes: { Row: Note; Insert: NoteInsert; Update: Partial<NoteInsert>; Relationships: [] };
      announcements: { Row: Announcement; Insert: AnnouncementInsert; Update: Partial<AnnouncementInsert>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      member_record_app_usage: { Args: { p_device_token: string; p_app_version: string; p_app_build: string; p_platform?: 'android' | 'ios' }; Returns: unknown };
      admin_record_app_usage: { Args: { p_app_version: string; p_app_build: string; p_platform?: 'android' | 'ios' }; Returns: unknown };
      owner_member_app_usage: { Args: { p_member_ids: number[] }; Returns: { member_id: number; first_used_at: string; last_used_at: string; last_app_version: string; last_app_build: string; platform: 'android' | 'ios' }[] };
      member_get_profile_settings: { Args: { p_device_token: string }; Returns: unknown };
      member_update_profile_settings: { Args: { p_device_token: string; p_profile: unknown }; Returns: unknown };
      member_password_self_recovery_access: { Args: Record<string, never>; Returns: boolean };
      admin_issue_strike: { Args: { p_member_id: number; p_title: string; p_feedback: string; p_author?: string | null }; Returns: { strike_id: number; evaluation_id: number; member_id: number; strikes: number; limit: number; expulsion_required: boolean } };
      owner_expel_member: { Args: { p_member_id: number; p_reason?: string | null }; Returns: { member_id: number; expelled: boolean; strikes: number; reason: string | null } };
      member_my_strikes: { Args: Record<string, never>; Returns: { limit: number; strikes: { id: number; reason: string; created_at: string; issued_by_name: string | null }[] } };
      member_strike_limit: { Args: Record<string, never>; Returns: number };
      member_internal_teams: { Args: Record<string, never>; Returns: { team_id: string; slug: string; name: string; status: string; approved_at: string | null }[] };
      admin_task_audience_groups: { Args: Record<string, never>; Returns: { leads: number[]; heads: number[] } };
      team_list_roster: { Args: { p_team_id: string; p_feature: TeamPermission }; Returns: unknown };
      team_list_tasks: { Args: { p_team_id: string }; Returns: unknown };
      team_create_task: { Args: { p_team_id: string; p_title: string; p_description: string | null; p_assigned_to: unknown; p_has_deadline: boolean; p_deadline_date: string | null; p_bonus_points: number }; Returns: number };
      team_delete_task: { Args: { p_team_id: string; p_task_id: number }; Returns: boolean };
      team_review_task: { Args: { p_team_id: string; p_task_id: number; p_member_id: number; p_action: string; p_reason: string | null }; Returns: unknown };
      get_team_task_contributions: { Args: { p_team_id: string; p_year: number; p_member_id?: number | null }; Returns: unknown };
      team_list_notes: { Args: { p_team_id: string }; Returns: unknown };
      team_create_note: { Args: { p_team_id: string; p_text: string; p_target_member_id?: number | null }; Returns: number };
      team_delete_note: { Args: { p_team_id: string; p_note_id: number }; Returns: boolean };
      team_list_evaluations: { Args: { p_team_id: string }; Returns: unknown };
      team_create_evaluation: { Args: { p_team_id: string; p_member_id: number; p_title: string; p_grade: string; p_points: number; p_feedback: string }; Returns: number };
      team_delete_evaluation: { Args: { p_team_id: string; p_evaluation_id: number }; Returns: boolean };
      team_list_ranking: { Args: { p_team_id: string }; Returns: unknown };
      team_list_custom_fields: { Args: { p_team_id: string }; Returns: unknown };
      team_create_custom_field: { Args: { p_team_id: string; p_label: string; p_field_type: string; p_options: unknown }; Returns: number };
      team_set_custom_field_value: { Args: { p_team_id: string; p_member_id: number; p_field_id: number; p_value: unknown }; Returns: boolean };
      team_list_custom_field_values: { Args: { p_team_id: string; p_member_id: number }; Returns: unknown };
      team_list_announcements: { Args: { p_team_id: string }; Returns: unknown };
      team_create_announcement: { Args: { p_team_id: string; p_title: string; p_content: string; p_priority: string; p_member_ids?: unknown }; Returns: number };
      team_set_announcement_active: { Args: { p_team_id: string; p_announcement_id: number; p_active: boolean }; Returns: boolean };
      team_delete_announcement: { Args: { p_team_id: string; p_announcement_id: number }; Returns: boolean };
      has_team_permission: { Args: { p_team_id: string; p_permission: TeamPermission }; Returns: boolean };
      has_team_membership: { Args: { p_team_id: string; p_member_id: number }; Returns: boolean };
      has_team_member_identity: { Args: { p_team_id: string; p_member_id: number }; Returns: boolean };
      owner_list_team_admin_candidates: { Args: never; Returns: TeamAdminCandidate[] };
      owner_list_teams: { Args: never; Returns: TeamOverview[] };
      owner_create_team: { Args: { p_slug: string; p_name: string }; Returns: string };
      owner_set_team_active: { Args: { p_team_id: string; p_is_active: boolean }; Returns: boolean };
      owner_update_team_details: { Args: { p_team_id: string; p_slug: string; p_name: string }; Returns: boolean };
      owner_assign_team_admin: { Args: { p_team_id: string; p_user_id: string; p_role: TeamAdminRole; p_permissions: TeamPermissions }; Returns: string };
      owner_revoke_team_admin: { Args: { p_assignment_id: string }; Returns: boolean };
      owner_set_team_admin_seat: { Args: { p_team_id: string; p_role: TeamAdminRole; p_user_id: string | null; p_permissions: TeamPermissions | null }; Returns: string | null };
      owner_list_team_members: { Args: { p_team_id: string }; Returns: TeamMemberSummary[] };
      owner_list_team_member_candidates: { Args: { p_team_id: string }; Returns: TeamMemberCandidate[] };
      team_add_member: { Args: { p_team_id: string; p_member_id: number }; Returns: TeamMembershipStatus };
      team_review_member: { Args: { p_team_id: string; p_member_id: number; p_decision: 'approve' | 'suspend' | 'remove' }; Returns: TeamMembershipStatus };
      has_admin_permission: { Args: { p_permission: string }; Returns: boolean };
      bind_member_device_session: { Args: { p_email: string; p_device_token: string }; Returns: boolean };
      set_member_bonus_infinite: { Args: { p_member_id: number; p_enabled: boolean; p_reason: string }; Returns: boolean };
      get_member_bonus_total: { Args: { p_member_id: number; p_device_token: string }; Returns: number };
      get_member_tasks: { Args: { p_member_id: number; p_device_token: string }; Returns: Task[] };
      get_member_bonus_infinite: { Args: { p_member_id: number; p_device_token: string }; Returns: boolean };
      get_member_leaderboard: { Args: { p_member_id: number; p_device_token: string }; Returns: unknown };
      get_admin_access: { Args: never; Returns: AdminAccess };
      get_member_password_access: { Args: never; Returns: { member_id: number; email: string; auth_user_id: string; active: boolean; password_ready: boolean; must_change_password: boolean } | null };
      get_member_pending_review: { Args: never; Returns: { status: string } | null };
      ensure_owner_member_identity: { Args: never; Returns: { member_id: number; email: string; created: boolean } | null };
      admin_list_accounts: { Args: never; Returns: AdminAccount[] };
      admin_capability_state: { Args: never; Returns: Record<string, unknown> };
      admin_request_capability: { Args: { p_capability: string; p_note?: string | null }; Returns: Record<string, unknown> };
      admin_cancel_capability_request: { Args: { p_request_id: number }; Returns: boolean };
      admin_capability_inbox: { Args: never; Returns: Record<string, unknown> };
      admin_capability_matrix: { Args: never; Returns: unknown };
      admin_set_capability: { Args: { p_user_id: string; p_capability: string; p_granted: boolean }; Returns: { user_id: string; capability: string; granted: boolean } };
      admin_decide_capability_request: { Args: { p_request_id: number; p_approve: boolean; p_minutes?: number; p_note?: string | null }; Returns: Record<string, unknown> };
      admin_revoke_capability_grant: { Args: { p_grant_id: number }; Returns: boolean };
      has_capability: { Args: { p_capability: string }; Returns: boolean };
      admin_add_account: { Args: { p_email: string }; Returns: AdminAccount };
      admin_demote_account: { Args: { p_user_id: string }; Returns: { target_uuid: string; demoted: boolean; member_linked: boolean } };
      admin_update_permissions: { Args: { p_user_id: string; p_permissions: AdminPermissions }; Returns: boolean };
      lookup_member_by_email: { Args: { p_email: string; p_device_token?: string | null }; Returns: MemberLookupRow[] };
      logout_member_device: { Args: { p_member_id: number; p_device_token?: string | null }; Returns: boolean };
      submit_task_status: {
        Args: { p_task_id: number; p_member_id: number; p_device_token?: string | null; p_status?: string; p_note?: string; p_submission_url?: string };
        Returns: unknown;
      };
      update_member_readiness: { Args: { p_member_id: number; p_device_token: string; p_can_go: boolean }; Returns: boolean };
      approve_task_submission: { Args: { p_task_id: number; p_member_id: number; p_bonus?: number }; Returns: ApproveTaskResult };
      revoke_task_approval: { Args: { p_task_id: number; p_member_id: number; p_reason: string }; Returns: RevokeTaskApprovalResult };
      admin_add_member_rating: { Args: { p_member_id: number; p_points: number; p_reason: string; p_author?: string }; Returns: number };
      save_push_subscription: { Args: { p_member_id: number; p_email: string; p_subscription: Record<string, any>; p_device_token?: string | null }; Returns: boolean };
      get_member_announcements: { Args: { p_member_id: number; p_device_token?: string | null }; Returns: MemberAnnouncement[] };
      mark_announcement_viewed: { Args: { p_announcement_id: number; p_member_id: number; p_device_token?: string | null }; Returns: boolean };
      mark_announcement_read: { Args: { p_announcement_id: number; p_member_id: number; p_device_token?: string | null }; Returns: boolean };
      dismiss_announcement: { Args: { p_announcement_id: number; p_member_id: number; p_device_token?: string | null }; Returns: boolean };
      get_announcement_details: { Args: { p_announcement_id: number }; Returns: AnnouncementMemberDetail[] };
      get_announcement_stats: { Args: { p_announcement_id: number }; Returns: AnnouncementStats[] };
      request_member_deletion: { Args: { p_reason?: string | null }; Returns: unknown };
      member_deletion_request_state: { Args: never; Returns: unknown };
      cancel_member_deletion_request: { Args: never; Returns: unknown };
      admin_list_member_deletion_requests: { Args: never; Returns: unknown };
      admin_reject_member_deletion: { Args: { p_request_id: string; p_note?: string | null }; Returns: unknown };
      member_deletion_admin_execute: { Args: { p_request_id: string }; Returns: unknown };
      member_deletion_storage_objects: { Args: { p_auth_user_id: string }; Returns: unknown };
      member_deletion_mark_complete: { Args: { p_request_id: string }; Returns: unknown };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ===== أسماء الجداول (مصدر واحد للحقيقة) =====
export const TABLES = {
  members: 'members',
  member_custom_fields: 'member_custom_fields',
  member_evaluations: 'member_evaluations',
  tasks: 'tasks',
  notes: 'notes',
  announcements: 'announcements',
} as const;
/** تحذير مسجّل على عضو؛ الحد ٣ تحذيرات لكل عضو. */
export type MemberStrike = {
  id: number;
  member_id: number;
  evaluation_id: number | null;
  reason: string;
  issued_by: string | null;
  issued_by_name: string | null;
  created_at: string;
};
