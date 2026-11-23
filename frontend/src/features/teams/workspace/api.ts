import { supabase } from '../../../lib/supabase/client';
import { toAppError } from '../../../lib/supabase/errors';
import type {
  AnnouncementPriority,
  MemberCustomFieldType,
  MemberEvaluationGrade,
  TeamMemberSummary,
  TeamMembershipStatus,
  TaskStatus,
} from '../../../types/db';

export type TeamWorkspaceSection =
  | 'tasks'
  | 'members'
  | 'notes'
  | 'ranking'
  | 'announcements'
  | 'custom-fields'
  | 'ledger';

export const teamWorkspaceKey = (
  userId: string,
  teamId: string,
  section: TeamWorkspaceSection,
) => ['team-workspace', userId, teamId, section] as const;

export interface WorkspaceRosterEntry {
  member_id: number;
  full_name: string;
  membership_status: TeamMembershipStatus;
  work_status?: string | null;
}

export interface WorkspaceTask {
  id: number;
  title: string;
  description: string | null;
  has_deadline: boolean;
  deadline_date: string | null;
  assigned_to: Array<string | number> | 'ALL' | null;
  tracking: Record<string, { status: TaskStatus; note?: string; submission_url?: string; updated_at?: string }> | null;
  bonus_points: number;
}

export interface WorkspaceNote {
  id: number;
  created_at: string;
  text: string;
  target_member_id: number | null;
  target_name: string | null;
}

export interface WorkspaceEvaluation {
  id: number;
  created_at: string;
  member_id: number;
  member_name: string;
  title: string;
  grade: MemberEvaluationGrade;
  points: number;
  feedback: string;
  evaluator_name: string;
}

export interface WorkspaceRankingEntry {
  member_id: number;
  full_name: string;
  completion_rank: number;
  bonus_points: number;
  bonus_infinite: boolean;
}

export interface WorkspaceAnnouncement {
  id: number;
  created_at: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  is_active: boolean;
  target_audience: { type: 'all' } | { type: 'specific'; member_ids: number[] };
  recipient_count: number;
  read_count: number;
}

export interface WorkspaceCustomField {
  id: number;
  label: string;
  field_type: MemberCustomFieldType;
  options: string[];
  sort_order: number;
}

export interface WorkspaceCustomFieldValue {
  field_id: number;
  label: string;
  field_type: MemberCustomFieldType;
  options: string[];
  value: unknown;
  updated_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isMembershipStatus(value: unknown): value is TeamMembershipStatus {
  return value === 'pending' || value === 'active' || value === 'suspended' || value === 'removed';
}

function isWorkspaceRosterList(value: unknown): value is WorkspaceRosterEntry[] {
  return Array.isArray(value) && value.every((member) => isRecord(member)
    && isNumber(member.member_id)
    && typeof member.full_name === 'string'
    && isMembershipStatus(member.membership_status));
}

function isOwnerRosterList(value: unknown): value is TeamMemberSummary[] {
  return Array.isArray(value) && value.every((member) => isRecord(member)
    && isNumber(member.member_id)
    && typeof member.full_name === 'string'
    && typeof member.email === 'string'
    && isNullableString(member.phone)
    && isNullableString(member.work_status)
    && isMembershipStatus(member.membership_status)
    && typeof member.created_at === 'string');
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'pending' || value === 'in_progress' || value === 'under_review'
    || value === 'approved' || value === 'revision_requested';
}

function isWorkspaceTaskList(value: unknown): value is WorkspaceTask[] {
  return Array.isArray(value) && value.every((task) => {
    if (!isRecord(task)
      || !isNumber(task.id)
      || typeof task.title !== 'string'
      || !isNullableString(task.description)
      || typeof task.has_deadline !== 'boolean'
      || !isNullableString(task.deadline_date)
      || !isNumber(task.bonus_points)) return false;
    const assigned = task.assigned_to;
    if (assigned !== null && assigned !== 'ALL'
      && !(Array.isArray(assigned) && assigned.every((id) => typeof id === 'string' || isNumber(id)))) return false;
    if (task.tracking === null) return true;
    if (!isRecord(task.tracking)) return false;
    return Object.values(task.tracking).every((entry) => isRecord(entry) && isTaskStatus(entry.status));
  });
}

function isWorkspaceNoteList(value: unknown): value is WorkspaceNote[] {
  return Array.isArray(value) && value.every((note) => isRecord(note)
    && isNumber(note.id)
    && typeof note.created_at === 'string'
    && typeof note.text === 'string'
    && (note.target_member_id === null || isNumber(note.target_member_id))
    && isNullableString(note.target_name));
}

function isEvaluationGrade(value: unknown): value is MemberEvaluationGrade {
  return value === 'excellent' || value === 'very_good' || value === 'good'
    || value === 'needs_improvement' || value === 'warning';
}

function isWorkspaceEvaluationList(value: unknown): value is WorkspaceEvaluation[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && isNumber(item.id)
    && isNumber(item.member_id)
    && typeof item.member_name === 'string'
    && typeof item.created_at === 'string'
    && typeof item.title === 'string'
    && isEvaluationGrade(item.grade)
    && isNumber(item.points)
    && typeof item.feedback === 'string'
    && typeof item.evaluator_name === 'string');
}

function isWorkspaceRankingList(value: unknown): value is WorkspaceRankingEntry[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && isNumber(item.member_id)
    && typeof item.full_name === 'string'
    && isNumber(item.completion_rank)
    && isNumber(item.bonus_points)
    && typeof item.bonus_infinite === 'boolean');
}

function isAnnouncementPriority(value: unknown): value is AnnouncementPriority {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'urgent';
}

function isAnnouncementAudience(value: unknown): value is WorkspaceAnnouncement['target_audience'] {
  if (!isRecord(value)) return false;
  if (value.type === 'all') return true;
  return value.type === 'specific' && Array.isArray(value.member_ids)
    && value.member_ids.every(isNumber);
}

function isWorkspaceAnnouncementList(value: unknown): value is WorkspaceAnnouncement[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && isNumber(item.id)
    && typeof item.created_at === 'string'
    && typeof item.title === 'string'
    && typeof item.content === 'string'
    && isAnnouncementPriority(item.priority)
    && typeof item.is_active === 'boolean'
    && isAnnouncementAudience(item.target_audience)
    && isNumber(item.recipient_count)
    && isNumber(item.read_count));
}

function isCustomFieldType(value: unknown): value is MemberCustomFieldType {
  return value === 'short_text' || value === 'long_text' || value === 'number'
    || value === 'date' || value === 'yes_no' || value === 'select';
}

function isWorkspaceCustomFieldList(value: unknown): value is WorkspaceCustomField[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && isNumber(item.id)
    && typeof item.label === 'string'
    && isCustomFieldType(item.field_type)
    && Array.isArray(item.options)
    && item.options.every((option) => typeof option === 'string')
    && isNumber(item.sort_order));
}

function isWorkspaceCustomFieldValueList(value: unknown): value is WorkspaceCustomFieldValue[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && isNumber(item.field_id)
    && typeof item.label === 'string'
    && isCustomFieldType(item.field_type)
    && Array.isArray(item.options)
    && item.options.every((option) => typeof option === 'string')
    && (item.updated_at === null || typeof item.updated_at === 'string')
    && 'value' in item);
}

async function listResult<T>(
  result: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  isResult: (value: unknown) => value is T,
  fallback: string,
): Promise<T> {
  const { data, error } = await result;
  if (error) throw toAppError(error, fallback);
  if (!isResult(data)) throw new Error(fallback);
  return data;
}

async function mutationResult<T>(
  result: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  fallback: string,
): Promise<T> {
  const { data, error } = await result;
  if (error) throw toAppError(error, fallback);
  if (data === null) throw new Error(fallback);
  return data;
}

export function listWorkspaceRoster(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('owner_list_team_members', { p_team_id: teamId }).abortSignal(signal),
    isOwnerRosterList,
    'Could not load this team’s member roster.',
  );
}

export function listWorkspaceFeatureRoster(
  teamId: string,
  feature: 'tasks' | 'notes' | 'ranking',
  signal: AbortSignal,
) {
  return listResult(
    supabase.rpc('team_list_roster', { p_team_id: teamId, p_feature: feature }).abortSignal(signal),
    isWorkspaceRosterList,
    'Could not load active members for this team feature.',
  );
}

export function listWorkspaceTasks(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('team_list_tasks', { p_team_id: teamId }).abortSignal(signal),
    isWorkspaceTaskList,
    'Could not load this team’s tasks.',
  );
}

export function createWorkspaceTask(input: {
  teamId: string;
  title: string;
  description: string | null;
  deadlineDate: string | null;
  assignedTo: string[] | 'ALL';
  bonusPoints: number;
}) {
  const deadline = input.deadlineDate ? `${input.deadlineDate}T23:59:59.999Z` : null;
  return mutationResult(
    supabase.rpc('team_create_task', {
      p_team_id: input.teamId,
      p_title: input.title,
      p_description: input.description,
      p_assigned_to: input.assignedTo,
      p_has_deadline: deadline !== null,
      p_deadline_date: deadline,
      p_bonus_points: input.bonusPoints,
    }),
    'Could not create the team task.',
  );
}

export function deleteWorkspaceTask(teamId: string, taskId: number) {
  return mutationResult(
    supabase.rpc('team_delete_task', { p_team_id: teamId, p_task_id: taskId }),
    'Could not delete the team task.',
  );
}

export function reviewWorkspaceTask(input: {
  teamId: string;
  taskId: number;
  memberId: number;
  action: 'approve' | 'revoke' | 'revision';
  reason: string | null;
}) {
  return mutationResult(
    supabase.rpc('team_review_task', {
      p_team_id: input.teamId,
      p_task_id: input.taskId,
      p_member_id: input.memberId,
      p_action: input.action,
      p_reason: input.reason,
    }),
    'Could not review this team task submission.',
  );
}

export function reviewWorkspaceMember(input: {
  teamId: string;
  memberId: number;
  decision: 'approve' | 'suspend' | 'remove';
}) {
  return mutationResult(
    supabase.rpc('team_review_member', {
      p_team_id: input.teamId,
      p_member_id: input.memberId,
      p_decision: input.decision,
    }),
    'Could not review this team membership.',
  );
}

export function listWorkspaceNotes(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('team_list_notes', { p_team_id: teamId }).abortSignal(signal),
    isWorkspaceNoteList,
    'Could not load this team’s notes.',
  );
}

export function createWorkspaceNote(input: {
  teamId: string;
  text: string;
  memberId: number | null;
}) {
  return mutationResult(
    supabase.rpc('team_create_note', {
      p_team_id: input.teamId,
      p_text: input.text,
      p_target_member_id: input.memberId,
    }),
    'Could not create the team note.',
  );
}

export function deleteWorkspaceNote(teamId: string, noteId: number) {
  return mutationResult(
    supabase.rpc('team_delete_note', { p_team_id: teamId, p_note_id: noteId }),
    'Could not delete the team note.',
  );
}

export function listWorkspaceEvaluations(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('team_list_evaluations', { p_team_id: teamId }).abortSignal(signal),
    isWorkspaceEvaluationList,
    'Could not load this team’s evaluations.',
  );
}

export function createWorkspaceEvaluation(input: {
  teamId: string;
  memberId: number;
  title: string;
  grade: MemberEvaluationGrade;
  points: number;
  feedback: string;
}) {
  return mutationResult(
    supabase.rpc('team_create_evaluation', {
      p_team_id: input.teamId,
      p_member_id: input.memberId,
      p_title: input.title,
      p_grade: input.grade,
      p_points: input.points,
      p_feedback: input.feedback,
    }),
    'Could not create the team evaluation.',
  );
}

export function deleteWorkspaceEvaluation(teamId: string, evaluationId: number) {
  return mutationResult(
    supabase.rpc('team_delete_evaluation', {
      p_team_id: teamId,
      p_evaluation_id: evaluationId,
    }),
    'Could not delete the team evaluation.',
  );
}

export function listWorkspaceRanking(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('team_list_ranking', { p_team_id: teamId }).abortSignal(signal),
    isWorkspaceRankingList,
    'Could not load this team’s ranking.',
  );
}

export function listWorkspaceAnnouncements(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('team_list_announcements', { p_team_id: teamId }).abortSignal(signal),
    isWorkspaceAnnouncementList,
    'Could not load this team’s announcements.',
  );
}

export function createWorkspaceAnnouncement(input: {
  teamId: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
}) {
  return mutationResult(
    supabase.rpc('team_create_announcement', {
      p_team_id: input.teamId,
      p_title: input.title,
      p_content: input.content,
      p_priority: input.priority,
      p_member_ids: null,
    }),
    'Could not publish the team announcement.',
  );
}

export function setWorkspaceAnnouncementActive(input: {
  teamId: string;
  announcementId: number;
  active: boolean;
}) {
  return mutationResult(
    supabase.rpc('team_set_announcement_active', {
      p_team_id: input.teamId,
      p_announcement_id: input.announcementId,
      p_active: input.active,
    }),
    'Could not change the announcement state.',
  );
}

export function deleteWorkspaceAnnouncement(teamId: string, announcementId: number) {
  return mutationResult(
    supabase.rpc('team_delete_announcement', {
      p_team_id: teamId,
      p_announcement_id: announcementId,
    }),
    'Could not delete the team announcement.',
  );
}

export function listWorkspaceCustomFields(teamId: string, signal: AbortSignal) {
  return listResult(
    supabase.rpc('team_list_custom_fields', { p_team_id: teamId }).abortSignal(signal),
    isWorkspaceCustomFieldList,
    'Could not load this team’s custom fields.',
  );
}

export function createWorkspaceCustomField(input: {
  teamId: string;
  label: string;
  type: MemberCustomFieldType;
  options: string[];
}) {
  return mutationResult(
    supabase.rpc('team_create_custom_field', {
      p_team_id: input.teamId,
      p_label: input.label,
      p_field_type: input.type,
      p_options: input.options,
    }),
    'Could not create the team custom field.',
  );
}

export function listWorkspaceCustomFieldValues(
  teamId: string,
  memberId: number,
  signal: AbortSignal,
) {
  return listResult(
    supabase.rpc('team_list_custom_field_values', {
      p_team_id: teamId,
      p_member_id: memberId,
    }).abortSignal(signal),
    isWorkspaceCustomFieldValueList,
    'Could not load the member’s team-only custom field values.',
  );
}

export function setWorkspaceCustomFieldValue(input: {
  teamId: string;
  memberId: number;
  fieldId: number;
  value: string | number | boolean;
}) {
  return mutationResult(
    supabase.rpc('team_set_custom_field_value', {
      p_team_id: input.teamId,
      p_member_id: input.memberId,
      p_field_id: input.fieldId,
      p_value: input.value,
    }),
    'Could not save the team-only custom field value.',
  );
}
