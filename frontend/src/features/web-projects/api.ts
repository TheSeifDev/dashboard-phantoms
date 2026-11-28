import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import { useAuthStore } from '../../store/auth';
import type { WebCandidate, WebInvitation, WebMembership, WebMode } from './types';

const TABLES = new Set([
  'web_ideas', 'web_idea_contributors', 'web_idea_reviews', 'web_projects', 'web_project_agreements',
  'web_project_members', 'web_project_agreement_acceptances', 'web_project_consents', 'web_project_milestones',
  'web_project_milestone_dependencies', 'web_project_deliverables', 'web_project_sprints', 'web_project_tasks',
  'web_project_task_assignees', 'web_project_task_comments', 'web_project_task_checklist_items',
  'web_project_task_attachments', 'web_project_task_submissions', 'web_project_updates', 'web_project_member_reports', 'web_resources',
  'web_project_resource_refs', 'web_project_integrations', 'web_project_activity_logs', 'web_program_admin_audit',
  'web_project_progress', 'web_project_milestone_progress', 'web_project_sprint_progress',
]);
const RPCS = new Set([
  'web_set_program_admin_access', 'web_review_idea', 'web_create_project', 'web_convert_idea_to_project',
  'web_add_project_member', 'web_set_project_leader', 'web_accept_project_agreement',
  'web_amend_project_agreement', 'web_record_project_consent', 'web_set_project_permissions',
  'web_set_project_status', 'web_transition_project_task', 'web_submit_member_report', 'web_review_member_report',
  'web_list_member_candidates', 'web_list_project_roster', 'web_list_my_project_invitations', 'web_set_project_member_status',
  'web_create_idea', 'web_delete_project_task', 'web_submit_project_task',
]);
// The app keeps a hand-maintained legacy Database type. This isolated transport
// describes only the new namespace; it does not weaken that legacy schema.
type WebTransport = { public: {
  Tables: { [name: string]: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] } };
  Views: Record<string, never>;
  Functions: { [name: string]: { Args: Record<string, unknown>; Returns: unknown } };
  Enums: Record<string, never>; CompositeTypes: Record<string, never>;
} };
export function webClient(mode: WebMode) {
  return (mode === 'member' ? memberSupabase : supabase) as unknown as SupabaseClient<WebTransport>;
}
export function webError(raw: unknown): Error {
  const object = raw && typeof raw === 'object' ? raw as { code?: string; message?: string } : {};
  if (object.code === '42P01' || object.code === 'PGRST202' || object.code === 'PGRST205') {
    return new Error('Web Projects schema is not installed. Apply the pending migration only after release authorization. / مخطط مشروعات الويب لم يُثبت بعد.');
  }
  const message = raw instanceof Error ? raw.message : object.message;
  if (/WEB_|23514|23503|23505|42501/.test(`${object.code ?? ''} ${message ?? ''}`)) {
    return new Error(message ?? 'This operation is not allowed by the project rules. / العملية غير مسموح بها.');
  }
  return new Error('Could not complete the project request. Please retry. / تعذر تنفيذ طلب المشروع. حاول مجددًا.');
}
async function unwrap<T>(request: PromiseLike<{ data: unknown; error: unknown | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw webError(error);
  return data as T;
}
function useScope(mode: WebMode) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const memberId = useAuthStore((state) => state.currentMember?.id ?? null);
  const actor = mode === 'member' ? memberId : userId;
  return { key: ['web-projects', mode, actor] as const, enabled: actor !== null };
}
export type WebFilters = Record<string, string | number | boolean | null>;
export async function readWebRows<T>(mode: WebMode, table: string, projectId?: string, extra: WebFilters = {}): Promise<T[]> {
  if (!TABLES.has(table)) throw new Error('Unsupported project table');
  const results: T[] = [];
  const pageSize = 200;
  // Offset pages share a deterministic UUID/composite-key ordering. No silently
  // truncated overview counts: refuse excessively large responses explicitly.
  const orderColumn = table === 'web_project_members' || table === 'web_project_task_assignees' || table === 'web_project_agreement_acceptances' || table === 'web_idea_contributors' ? 'member_id'
    : table === 'web_project_agreements' ? 'version'
    : table === 'web_project_resource_refs' ? 'resource_id'
    : table === 'web_project_progress' ? 'project_id'
    : table === 'web_project_milestone_progress' ? 'milestone_id'
    : table === 'web_project_sprint_progress' ? 'sprint_id' : 'id';
  for (let page = 0; page < 100; page += 1) {
    let query = webClient(mode).from(table).select('*').order(orderColumn, { ascending: true });
    if (projectId) query = table === 'web_projects' ? query.eq('id', projectId) : query.eq('project_id', projectId);
    for (const [key, value] of Object.entries(extra)) query = value === null ? query.is(key, null) : query.eq(key, value);
    const rows = await unwrap<T[]>(query.range(page * pageSize, (page + 1) * pageSize - 1));
    results.push(...rows);
    if (rows.length < pageSize) return results;
  }
  throw new Error('This query exceeds the supported page limit. Narrow its project filters. / يرجى تحديد المشروع لتقليل النتائج.');
}
export function useWebQuery<T>(mode: WebMode, table: string, projectId?: string, extra: WebFilters = {}, enabled = true) {
  const scope = useScope(mode);
  return useQuery({
    queryKey: [...scope.key, table, projectId ?? 'program', extra],
    queryFn: () => readWebRows<T>(mode, table, projectId, extra),
    enabled: scope.enabled && enabled, retry: false, staleTime: 5_000,
  });
}
export interface WebMutationInput {
  table: string; operation: 'insert' | 'update' | 'delete'; data?: Record<string, unknown>;
  id?: string; filters?: WebFilters;
}
const ACTOR_COLUMNS: Record<string, string> = {
  web_project_milestones: 'created_by_auth_user_id', web_project_sprints: 'created_by_auth_user_id',
  web_project_tasks: 'created_by_auth_user_id', web_project_task_assignees: 'assigned_by_auth_user_id',
  web_project_task_comments: 'author_auth_user_id', web_resources: 'created_by_auth_user_id',
  web_project_resource_refs: 'added_by_auth_user_id', web_project_integrations: 'created_by_auth_user_id',
  web_project_milestone_dependencies: 'created_by_auth_user_id',
};
export function useWebMutation(mode: WebMode) {
  const scope = useScope(mode);
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (input: WebMutationInput): Promise<Record<string, unknown> | null> => {
      if (!TABLES.has(input.table) || /progress$|audit$|activity_logs$|agreements$|acceptances$|consents$|project_members$|member_reports$|idea_reviews$/.test(input.table)) throw new Error('Use the protected project operation.');
      if (input.operation !== 'insert' && !input.id && !Object.keys(input.filters ?? {}).length) throw new Error('A scoped row identifier is required.');
      const data = { ...input.data };
      if (input.table === 'web_project_tasks' && input.operation === 'update' && 'status' in data) throw new Error('Task status changes require the transition RPC.');
      if (input.operation === 'insert' && ACTOR_COLUMNS[input.table]) {
        const session = await webClient(mode).auth.getSession();
        if (!session.data.session?.user.id) throw new Error('Sign in again. / سجل الدخول مجددًا.');
        data[ACTOR_COLUMNS[input.table]] = session.data.session.user.id;
      }
      // The SDK rejects dynamic string-index inserts as excess numeric keys.
      // This cast is confined to the namespace adapter; RLS validates payloads.
      let query = input.operation === 'insert' ? webClient(mode).from(input.table).insert(data as never)
        : input.operation === 'update' ? webClient(mode).from(input.table).update(data as never)
        : webClient(mode).from(input.table).delete();
      if (input.id) query = query.eq('id', input.id);
      for (const [key, value] of Object.entries(input.filters ?? {})) query = value === null ? query.is(key, null) : query.eq(key, value);
      const row = await unwrap<Record<string, unknown> | null>(query.select('*').maybeSingle());
      if (!row) throw new Error('No authorized row changed. Refresh and retry. / لم يُعدل أي سجل مصرح به.');
      return row;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: scope.key }),
  });
}
export function useWebRpc(mode: WebMode) {
  const scope = useScope(mode);
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ name, args = {} }: { name: string; args?: Record<string, unknown> }) => {
      if (!RPCS.has(name)) throw new Error('Unsupported project operation');
      return unwrap<unknown>(webClient(mode).rpc(name, args));
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: scope.key }),
  });
}
function useWebReadRpc<T>(mode: WebMode, name: string, args: Record<string, unknown>, enabled: boolean) {
  const scope = useScope(mode);
  return useQuery({ queryKey: [...scope.key, name, args], queryFn: () => unwrap<T>(webClient(mode).rpc(name, args)), enabled: scope.enabled && enabled, retry: false, staleTime: 5_000 });
}
export function useWebRoster(mode: WebMode, projectId: string) {
  return useWebReadRpc<WebMembership[]>(mode, 'web_list_project_roster', { p_project_id: projectId }, Boolean(projectId));
}
export function useWebCandidates(mode: WebMode, projectId?: string, enabled = true) {
  return useWebReadRpc<WebCandidate[]>(mode, 'web_list_member_candidates', { p_project_id: projectId ?? null }, enabled);
}
export function useWebInvitations() {
  return useWebReadRpc<WebInvitation[]>('member', 'web_list_my_project_invitations', {}, true);
}
