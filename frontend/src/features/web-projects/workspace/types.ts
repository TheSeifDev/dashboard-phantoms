import type {
  WebActivity,
  WebAssignee,
  WebAttachment,
  WebCandidate,
  WebChecklist,
  WebComment,
  WebDependency,
  WebDeliverable,
  WebIntegration,
  WebMembership,
  WebMilestone,
  WebProject,
  WebReport,
  WebResource,
  WebSprint,
  WebTask,
  WebUpdate,
} from "../types";

export type WorkspaceMode = "admin" | "member";
export type Project = WebProject;
export type Task = WebTask;
export type MemberOption = WebMembership;
export type {
  WebActivity,
  WebAssignee,
  WebAttachment,
  WebCandidate,
  WebChecklist,
  WebComment,
  WebDependency,
  WebDeliverable,
  WebIntegration,
  WebMembership,
  WebMilestone,
  WebProject,
  WebReport,
  WebResource,
  WebSprint,
  WebTask,
  WebUpdate,
};

export interface WebProjectProgress {
  project_id: string;
  task_count: number;
  completed_task_count: number;
  progress_percent: number | null;
}

export interface WebMilestoneProgress {
  project_id: string;
  milestone_id: string;
  milestone_title: string;
  linked_task_count: number;
  completed_task_count: number;
  linked_deliverable_count: number;
  accepted_deliverable_count: number;
  tracked_item_count: number;
  completed_item_count: number;
  progress_percent: number | null;
}

export interface WebSprintProgress {
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  task_count: number;
  completed_task_count: number;
  blocked_task_count: number;
  progress_percent: number | null;
}

export interface WebProjectConsent {
  project_id: string;
  member_id: number;
  agreement_version: number;
  consent_type: "phantoms_brand_assets" | "public_showcase";
  granted: boolean;
  actor_auth_user_id: string;
  recorded_at: string;
}

export interface WebProjectAgreement {
  project_id: string;
  version: number;
  ownership_model: string;
  ownership_notes: string;
  license_name: string;
  attribution_notes: string;
  terms: Record<string, import("../types").WebJson>;
  created_by_auth_user_id: string;
  created_at: string;
}

export interface WebProjectResourceReference {
  project_id: string;
  resource_id: string;
  resource_scope_id: string;
  added_by_auth_user_id: string;
  created_at: string;
}

export type WorkspaceRoster = WebMembership[];
export type WorkspaceCandidates = WebCandidate[];

export type WorkspaceProps = {
  project: Project;
  projectId: string;
  mode: WorkspaceMode;
  currentMemberId: number | null;
  isLead: boolean;
  isProgramAdmin: boolean;
  roster: WorkspaceRoster;
  candidates: WorkspaceCandidates;
  reloadProject: () => void;
};

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
export const BOARD_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const labelStatus = (status: string) =>
  status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
export const dateInputValue = (value?: string | null) =>
  value ? value.slice(0, 10) : "";
