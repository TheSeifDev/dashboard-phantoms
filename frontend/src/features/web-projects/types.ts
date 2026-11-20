export type WebMode = 'admin' | 'member';
export type WebProjectStatus = 'proposed' | 'reviewing' | 'approved' | 'planning' | 'active' | 'on_hold' | 'completed' | 'archived' | 'rejected';
export type WebTaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled';
export type WebPriority = 'low' | 'normal' | 'high' | 'urgent';
export type WebRole = 'lead' | 'contributor' | 'viewer';
export type WebMembershipStatus = 'pending' | 'active' | 'suspended' | 'removed';
export type WebJson = string | number | boolean | null | WebJson[] | { [key: string]: WebJson };
export interface WebIdea {
  id: string; title: string; short_description: string; problem_statement: string; proposed_solution: string;
  target_audience: string; phantoms_benefit: string; potential_use_cases: WebJson[]; suggested_tech_stack: WebJson[];
  required_skills: WebJson[]; estimated_complexity: string; suggested_leader_member_id: number | null;
  graduation_project: boolean; supporting_documents: WebJson[]; submitted_by_member_id: number; submitted_at: string;
  review_status: 'proposed' | 'under_review' | 'approved' | 'rejected'; review_notes: string;
  reviewed_by_auth_user_id: string | null; reviewed_at: string | null; converted_project_id: string | null; converted_at: string | null;
}
export interface WebProject {
  id: string; slug: string; name: string; logo_url: string | null; cover_image_url: string | null;
  short_description: string; description: string; category: string; status: WebProjectStatus; priority: WebPriority;
  created_at: string; updated_at: string; expected_delivery_date: string | null; owner_member_id: number;
  lead_member_id: number | null; origin_submitter_member_id: number | null; source_idea_id: string | null;
  problem_statement: string; proposed_solution: string; target_audience: string; phantoms_benefit: string;
  graduation_project: boolean; potential_use_cases: WebJson[]; required_skills: WebJson[]; estimated_complexity: string;
  tech_stack: WebJson[]; supporting_documents: WebJson[]; repository_url: string | null; live_demo_url: string | null;
  figma_url: string | null; documentation_url: string | null; ownership_model: string; ownership_notes: string;
  license_name: string; attribution_notes: string; phantoms_assets_used: boolean; phantoms_brand_permission: boolean;
  public_showcase_permission: boolean; expected_phantoms_contribution: string; technical_support_arrangement: string;
  phantoms_integration_status: string; current_agreement_version: number; created_by_auth_user_id: string;
}
export interface WebMembership {
  project_id: string; member_id: number; full_name: string; role: WebRole; status: WebMembershipStatus;
  responsibility: string; accepted_agreement_version: number | null; agreement_accepted_at: string | null;
  added_by_auth_user_id: string; created_at: string; updated_at: string;
}
export interface WebCandidate { member_id: number; full_name: string }
export interface WebInvitation {
  project_id: string; project_name: string; role: WebRole; status: WebMembershipStatus; current_agreement_version: number;
  ownership_model: string; ownership_notes: string; license_name: string; attribution_notes: string; terms: Record<string, WebJson>;
}
export interface WebMilestone {
  id: string; project_id: string; title: string; description: string; phase: string;
  status: 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'; start_date: string | null; due_date: string | null;
  completed_at: string | null; created_at: string; updated_at: string; created_by_auth_user_id: string;
}
export interface WebSprint {
  id: string; project_id: string; name: string; goal: string; status: 'planned' | 'active' | 'completed' | 'cancelled';
  starts_on: string; ends_on: string; completed_at: string | null; retrospective_notes: string;
  created_at: string; updated_at: string; created_by_auth_user_id: string;
}
export interface WebTask {
  id: string; project_id: string; parent_task_id: string | null; milestone_id: string | null; sprint_id: string | null;
  reporter_member_id: number; title: string; description: string; priority: WebPriority; status: WebTaskStatus;
  start_date: string | null; due_date: string | null; estimated_effort: number | null; actual_effort: number | null;
  labels: string[]; created_at: string; updated_at: string; completed_at: string | null; created_by_auth_user_id: string;
}
export interface WebAssignee { project_id: string; task_id: string; member_id: number; is_primary: boolean }
export interface WebDeliverable {
  id: string; project_id: string; milestone_id: string | null; task_id: string | null; submitted_by_member_id: number;
  title: string; description: string; evidence: WebJson[]; due_date: string | null;
  status: 'draft' | 'submitted' | 'under_review' | 'accepted' | 'revision_requested' | 'rejected';
  submitted_at: string | null; reviewed_at: string | null; reviewed_by_auth_user_id: string | null; review_notes: string;
  created_at: string; updated_at: string;
}
export interface WebReport {
  id: string; project_id: string; member_id: number; period_start: string; period_end: string;
  completed_this_week: string; working_on: string; next_week_plan: string; deliverables_complete: boolean;
  blockers: string; support_needed: boolean; references_and_attachments: WebJson[];
  status: 'submitted' | 'needs_clarification' | 'reviewed'; reviewed_by_auth_user_id: string | null;
  reviewed_at: string | null; review_notes: string; blocker_escalated: boolean; submitted_at: string; updated_at: string;
}
export interface WebUpdate {
  id: string; project_id: string; author_member_id: number; update_type: 'progress' | 'blocker' | 'support_request';
  title: string; body: string; blocker_status: 'open' | 'escalated' | 'resolved'; related_task_id: string | null;
  created_at: string; updated_at: string; resolved_at: string | null;
}
export const RESOURCE_CATEGORIES = ['brand_logo', 'brand_guidelines', 'design_system', 'ui_components', 'documents_templates', 'approved_fonts', 'illustrations_media', 'technical_standards', 'development_resources', 'other'] as const;
export interface WebResource {
  id: string; scope_id: string; project_id: string | null; title: string; description: string;
  category: typeof RESOURCE_CATEGORIES[number]; tags: string[]; preview_url: string | null; external_url: string | null;
  storage_object_path: string | null; version_label: string | null; access_status: 'pending' | 'approved' | 'rejected' | 'archived';
  is_approved: boolean; created_by_auth_user_id: string; created_at: string; updated_at: string;
}
export interface WebActivity {
  id: string; project_id: string; occurred_at: string; actor_auth_user_id: string | null; actor_member_id: number | null;
  action: string; entity_type: string; entity_id: string | null; details: Record<string, WebJson>;
}
export interface WebIntegration {
  id: string; project_id: string; integration_type: string; label: string; link_url: string | null;
  metadata: Record<string, WebJson>; connection_state: 'metadata_only'; created_at: string;
}
export interface WebDependency { id: string; project_id: string; milestone_id: string; depends_on_milestone_id: string }
export interface WebChecklist { id: string; project_id: string; task_id: string; title: string; is_done: boolean; sort_order: number }
export interface WebComment { id: string; project_id: string; task_id: string; author_member_id: number | null; author_auth_user_id: string; body: string; created_at: string }
export interface WebAttachment { id: string; project_id: string; task_id: string; uploaded_by_member_id: number; title: string; external_url: string | null; storage_object_path: string | null; created_at: string }
