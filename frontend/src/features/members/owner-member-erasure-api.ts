import { supabase } from '../../lib/supabase/client';

export interface OwnerMemberErasureImpact {
  key: string;
  label_ar: string;
  label_en: string;
  count: number;
}
export interface OwnerMemberErasureSharedTeam {
  id: string;
  name: string;
  other_member_count: number;
}
export interface OwnerMemberErasureSharedProject {
  id: string;
  name: string;
  other_member_count: number;
  dependent_rows: number;
}
export interface OwnerMemberErasureCandidate {
  member_id: number;
  full_name: string;
}
export interface OwnerMemberErasureHandoverRequirement {
  kind: string;
  entity_id: string | number;
  entity_name: string;
  candidates: OwnerMemberErasureCandidate[];
}
export interface OwnerMemberErasurePreview {
  operation_id: string;
  member_id: number;
  auth_user_id: string;
  member_name: string;
  email_masked: string | null;
  preview_token: string;
  expires_at: string;
  impacts: OwnerMemberErasureImpact[];
  shared_teams: OwnerMemberErasureSharedTeam[];
  shared_projects: OwnerMemberErasureSharedProject[];
  handover_requirements: OwnerMemberErasureHandoverRequirement[];
  storage_object_count: number;
  owner_target: boolean;
  is_admin: boolean;
  blockers: unknown[];
  can_execute: boolean;
}
export type OwnerMemberErasureSuccessorAssignments = Record<string, number>;
export interface OwnerMemberErasureDeletedCounts {
  database_rows: number;
  storage_objects: number;
  auth_users: number;
}
interface CompletionFlags {
  database_complete: boolean;
  storage_complete: boolean;
  auth_complete: boolean;
}
export interface OwnerMemberErasureComplete extends CompletionFlags {
  ok: true;
  status: 'complete';
  operation_id: string;
  deleted: OwnerMemberErasureDeletedCounts;
}
export interface OwnerMemberErasurePartial {
  ok: false;
  status: 'partial';
  operation_id: string;
  stage: string;
  retryable: boolean;
  message_ar: string;
  message_en: string;
}
export type OwnerMemberErasureResult = OwnerMemberErasureComplete | OwnerMemberErasurePartial;
export type OwnerMemberErasureStatus =
  | (CompletionFlags & { ok: true; status: 'complete'; operation_id: string; deleted: OwnerMemberErasureDeletedCounts })
  | (CompletionFlags & { ok: true; status: 'partial'; operation_id: string; stage: string; retryable: boolean; deleted: OwnerMemberErasureDeletedCounts })
  | (CompletionFlags & { ok: true; status: 'pending'; operation_id: string; stage: string; retryable: boolean; deleted: OwnerMemberErasureDeletedCounts });
export type OwnerMemberErasureErrorCode =
  | 'binding_unconfirmed'
  | 'owner_prohibited'
  | 'owner_required'
  | 'invalid_preview'
  | 'scope_blocked'
  | 'request_failed';
export class OwnerMemberErasureError extends Error {
  readonly code: OwnerMemberErasureErrorCode;
  constructor(code: OwnerMemberErasureErrorCode) {
    super(code);
    this.name = 'OwnerMemberErasureError';
    this.code = code;
  }
}
export interface OwnerMemberErasureApi {
  preview(memberId: number): Promise<OwnerMemberErasurePreview>;
  execute(preview: OwnerMemberErasurePreview, successorAssignments: OwnerMemberErasureSuccessorAssignments, confirmation: string): Promise<OwnerMemberErasureResult>;
  status(operationId: string): Promise<OwnerMemberErasureStatus>;
  retry(operationId: string): Promise<OwnerMemberErasureResult>;
}
type ErasureFunctionClient = Pick<typeof supabase, 'functions'>;
type InvokeBody = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BINDING_ERROR_CODES = new Set([
  'MEMBER_AUTH_BINDING_MISSING',
  'MEMBER_AUTH_BINDING_NOT_FOUND',
  'MEMBER_AUTH_BINDING_AMBIGUOUS',
  'AUTH_BINDING_MISSING',
  'NO_EXACT_MEMBER_AUTH_BINDING',
  'EXACT_BINDING_REQUIRED',
  'BINDING_AMBIGUOUS',
  'MEMBER_BINDING_NOT_FOUND',
  'AMBIGUOUS_MEMBER_AUTH_BINDING',
]);
const OWNER_ERROR_CODES = new Set(['OWNER_TARGET', 'PRIMARY_OWNER', 'PRIMARY_OWNER_PROTECTED', 'SELF_ERASURE_PROHIBITED']);
const OWNER_REQUIRED_CODES = new Set(['NOT_OWNER', 'OWNER_REQUIRED']);
const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const hasControlCharacters = (value: string) => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
};
const boundedString = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !hasControlCharacters(value);
const isMaskedEmail = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 254 && /[*•…]/.test(value) && !hasControlCharacters(value);
export const isExactAuthUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);
export const ownerMemberErasureConfirmation = (memberId: number, authUserId: string): string =>
  `ERASE ${memberId} ${authUserId.slice(0, 8)}`;
export function isOwnerMemberErasureConfirmationValid(memberId: number, authUserId: string, value: string): boolean {
  return value === ownerMemberErasureConfirmation(memberId, authUserId);
}
function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}
function safeCodeFromValue(value: unknown): OwnerMemberErasureErrorCode {
  if (!plainObject(value) || typeof value.code !== 'string') return 'request_failed';
  const code = value.code.toUpperCase();
  if (code === 'ERASURE_SCOPE_BLOCKED' || code === 'ERASURE_RETRY_DISABLED') return 'scope_blocked';
  if (BINDING_ERROR_CODES.has(code) || (/BINDING/.test(code) && /(MISSING|NOT_FOUND|AMBIGUOUS|EXACT_REQUIRED)/.test(code))) return 'binding_unconfirmed';
  if (OWNER_ERROR_CODES.has(code)) return 'owner_prohibited';
  if (OWNER_REQUIRED_CODES.has(code)) return 'owner_required';
  return 'request_failed';
}
async function normalizeFunctionError(error: unknown): Promise<OwnerMemberErasureError> {
  if (!plainObject(error)) return new OwnerMemberErasureError('request_failed');
  const directCode = safeCodeFromValue(error);
  if (directCode !== 'request_failed') return new OwnerMemberErasureError(directCode);
  const response = error.context;
  if (typeof Response !== 'undefined' && response instanceof Response) {
    const payload: unknown = await response.clone().json().catch(() => null);
    const responseCode = safeCodeFromValue(payload);
    if (responseCode !== 'request_failed') return new OwnerMemberErasureError(responseCode);
  }
  return new OwnerMemberErasureError('request_failed');
}
async function invoke(client: ErasureFunctionClient, body: InvokeBody): Promise<unknown> {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.functions.invoke('owner-member-erasure', { body });
  } catch {
    throw new OwnerMemberErasureError('request_failed');
  }
  if (response.error) throw await normalizeFunctionError(response.error);
  return response.data;
}
function entityId(value: unknown): value is string | number {
  return (typeof value === 'string' && boundedString(value, 200)) || (typeof value === 'number' && Number.isSafeInteger(value));
}
export function ownerMemberErasureHandoverKey(requirement: Pick<OwnerMemberErasureHandoverRequirement, 'kind' | 'entity_id'>): string {
  return `${requirement.kind}:${String(requirement.entity_id)}`;
}
function assertPreview(value: unknown, requestedMemberId: number): OwnerMemberErasurePreview {
  if (!plainObject(value) || value.ok !== true || !plainObject(value.preview)) {
    const code = safeCodeFromValue(value);
    throw new OwnerMemberErasureError(code);
  }
  const preview = value.preview;
  if (preview.member_id !== requestedMemberId) throw new OwnerMemberErasureError('invalid_preview');
  if (!isExactAuthUuid(preview.auth_user_id)) throw new OwnerMemberErasureError('binding_unconfirmed');
  if (!isOperationId(preview.operation_id)
      || !boundedString(preview.member_name, 200)
      || !(preview.email_masked === null || isMaskedEmail(preview.email_masked))
      || !boundedString(preview.preview_token, 2048)
      || typeof preview.expires_at !== 'string'
      || !Number.isFinite(Date.parse(preview.expires_at))
      || !Array.isArray(preview.impacts)
      || !Array.isArray(preview.shared_teams)
      || !Array.isArray(preview.shared_projects)
      || !Array.isArray(preview.handover_requirements)
      || !Array.isArray(preview.blockers)
      || preview.blockers.length > 500
      || !isCount(preview.storage_object_count)
      || typeof preview.owner_target !== 'boolean'
      || typeof preview.is_admin !== 'boolean'
      || typeof preview.can_execute !== 'boolean') {
    throw new OwnerMemberErasureError('invalid_preview');
  }
  const impacts = preview.impacts.map((item) => {
    if (!plainObject(item) || !boundedString(item.key, 128) || !boundedString(item.label_ar, 200)
        || !boundedString(item.label_en, 200) || !isCount(item.count)) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    return { key: item.key, label_ar: item.label_ar, label_en: item.label_en, count: item.count };
  });
  const sharedTeams = preview.shared_teams.map((item) => {
    if (!plainObject(item) || !boundedString(item.id, 128) || !boundedString(item.name, 200)
        || !isCount(item.other_member_count)) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    return { id: item.id, name: item.name, other_member_count: item.other_member_count };
  });
  const sharedProjects = preview.shared_projects.map((item) => {
    if (!plainObject(item) || !boundedString(item.id, 128) || !boundedString(item.name, 200)
        || !isCount(item.other_member_count) || !isCount(item.dependent_rows)) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    return {
      id: item.id,
      name: item.name,
      other_member_count: item.other_member_count,
      dependent_rows: item.dependent_rows,
    };
  });
  const handoverRequirements = preview.handover_requirements.map((item) => {
    if (!plainObject(item) || !boundedString(item.kind, 80) || item.kind.includes(':')
        || !entityId(item.entity_id) || !boundedString(item.entity_name, 200) || !Array.isArray(item.candidates)) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    const candidates = item.candidates.map((candidate) => {
      if (!plainObject(candidate) || !Number.isSafeInteger(candidate.member_id) || (candidate.member_id as number) <= 0
          || !boundedString(candidate.full_name, 200) || candidate.member_id === requestedMemberId) {
        throw new OwnerMemberErasureError('invalid_preview');
      }
      return { member_id: candidate.member_id as number, full_name: candidate.full_name };
    });
    if (new Set(candidates.map(({ member_id }) => member_id)).size !== candidates.length) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    return { kind: item.kind, entity_id: item.entity_id, entity_name: item.entity_name, candidates };
  });
  const handoverKeys = handoverRequirements.map(ownerMemberErasureHandoverKey);
  if (new Set(handoverKeys).size !== handoverKeys.length
      || new Set(sharedTeams.map(({ id }) => id)).size !== sharedTeams.length
      || new Set(sharedProjects.map(({ id }) => id)).size !== sharedProjects.length) {
    throw new OwnerMemberErasureError('invalid_preview');
  }
  return {
    operation_id: preview.operation_id,
    member_id: requestedMemberId,
    auth_user_id: preview.auth_user_id,
    member_name: preview.member_name,
    email_masked: preview.email_masked,
    preview_token: preview.preview_token,
    expires_at: preview.expires_at,
    impacts,
    shared_teams: sharedTeams,
    shared_projects: sharedProjects,
    handover_requirements: handoverRequirements,
    storage_object_count: preview.storage_object_count,
    owner_target: preview.owner_target,
    is_admin: preview.is_admin,
    blockers: preview.blockers,
    can_execute: preview.can_execute,
  };
}
function assertOperationId(value: unknown): string {
  if (!isOperationId(value)) throw new OwnerMemberErasureError('request_failed');
  return value;
}
function assertDeleted(value: unknown): OwnerMemberErasureDeletedCounts {
  if (!plainObject(value) || !isCount(value.database_rows) || !isCount(value.storage_objects) || !isCount(value.auth_users)) {
    throw new OwnerMemberErasureError('request_failed');
  }
  return { database_rows: value.database_rows, storage_objects: value.storage_objects, auth_users: value.auth_users };
}
function assertResult(value: unknown, expectedOperationId?: string): OwnerMemberErasureResult {
  if (!plainObject(value)) throw new OwnerMemberErasureError(safeCodeFromValue(value));
  const operationId = assertOperationId(value.operation_id);
  if (expectedOperationId && operationId !== expectedOperationId) throw new OwnerMemberErasureError('request_failed');
  if (value.ok === true && value.status === 'complete'
      && value.database_complete === true && value.storage_complete === true && value.auth_complete === true) {
    return {
      ok: true,
      status: 'complete',
      operation_id: operationId,
      database_complete: true,
      storage_complete: true,
      auth_complete: true,
      deleted: assertDeleted(value.deleted),
    };
  }
  if (value.ok === false && value.status === 'partial' && boundedString(value.stage, 80)
      && typeof value.retryable === 'boolean'
      && typeof value.message_ar === 'string' && value.message_ar.length <= 1000
      && typeof value.message_en === 'string' && value.message_en.length <= 1000) {
    return {
      ok: false,
      status: 'partial',
      operation_id: operationId,
      stage: value.stage,
      retryable: value.retryable,
      message_ar: 'العملية لم تكتمل بالكامل. أعد المحاولة فقط إذا صرّح الخادم بذلك.',
      message_en: 'The operation did not complete fully. Retry only when the server designates it as retryable.',
    };
  }
  throw new OwnerMemberErasureError('request_failed');
}
function assertStatus(value: unknown, expectedOperationId: string): OwnerMemberErasureStatus {
  if (!plainObject(value) || value.ok !== true) throw new OwnerMemberErasureError(safeCodeFromValue(value));
  const operationId = assertOperationId(value.operation_id);
  if (operationId !== expectedOperationId || !['complete', 'partial', 'pending'].includes(String(value.status))) {
    throw new OwnerMemberErasureError('request_failed');
  }
  const flags = {
    database_complete: value.database_complete,
    storage_complete: value.storage_complete,
    auth_complete: value.auth_complete,
  };
  if (typeof flags.database_complete !== 'boolean' || typeof flags.storage_complete !== 'boolean'
      || typeof flags.auth_complete !== 'boolean') throw new OwnerMemberErasureError('request_failed');
  const completionFlags: CompletionFlags = {
    database_complete: flags.database_complete as boolean,
    storage_complete: flags.storage_complete as boolean,
    auth_complete: flags.auth_complete as boolean,
  };
  const deleted = assertDeleted(value.deleted);
  if (value.status === 'complete') {
    if (!completionFlags.database_complete || !completionFlags.storage_complete || !completionFlags.auth_complete) throw new OwnerMemberErasureError('request_failed');
    return { ok: true, status: 'complete', operation_id: operationId, ...completionFlags, deleted };
  }
  if (!boundedString(value.stage, 80) || typeof value.retryable !== 'boolean') throw new OwnerMemberErasureError('request_failed');
  if (value.status === 'partial') {
    return { ok: true, status: 'partial', operation_id: operationId, stage: value.stage, retryable: value.retryable, ...completionFlags, deleted };
  }
  return { ok: true, status: 'pending', operation_id: operationId, stage: value.stage, retryable: value.retryable, ...completionFlags, deleted };
}
function assertSuccessorAssignments(preview: OwnerMemberErasurePreview, assignments: OwnerMemberErasureSuccessorAssignments): OwnerMemberErasureSuccessorAssignments {
  if (!plainObject(assignments) || !Array.isArray(preview.handover_requirements)) throw new OwnerMemberErasureError('invalid_preview');
  const requirements = new Map<string, OwnerMemberErasureHandoverRequirement>();
  for (const requirement of preview.handover_requirements) {
    if (!plainObject(requirement) || !boundedString(requirement.kind, 80) || requirement.kind.includes(':')
        || !entityId(requirement.entity_id) || !Array.isArray(requirement.candidates)) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    const key = ownerMemberErasureHandoverKey(requirement as OwnerMemberErasureHandoverRequirement);
    if (requirements.has(key)) throw new OwnerMemberErasureError('invalid_preview');
    requirements.set(key, requirement as unknown as OwnerMemberErasureHandoverRequirement);
  }
  const suppliedKeys = Object.keys(assignments);
  if (suppliedKeys.length !== requirements.size || suppliedKeys.some((key) => !requirements.has(key))) {
    throw new OwnerMemberErasureError('invalid_preview');
  }
  const safe: OwnerMemberErasureSuccessorAssignments = {};
  for (const [key, requirement] of requirements) {
    const memberId = assignments[key];
    if (!Number.isSafeInteger(memberId) || !requirement.candidates.some((candidate) => candidate.member_id === memberId)) {
      throw new OwnerMemberErasureError('invalid_preview');
    }
    safe[key] = memberId;
  }
  return safe;
}
export function createOwnerMemberErasureApi(client: ErasureFunctionClient): OwnerMemberErasureApi {
  return {
    async preview(memberId) {
      if (!Number.isSafeInteger(memberId) || memberId <= 0) throw new OwnerMemberErasureError('invalid_preview');
      const reply = await invoke(client, { action: 'preview', member_id: memberId });
      return assertPreview(reply, memberId);
    },
    async execute(preview, successorAssignments, confirmation) {
      if (!isOperationId(preview.operation_id)
          || !Number.isSafeInteger(preview.member_id) || preview.member_id <= 0
          || !isExactAuthUuid(preview.auth_user_id)
          || !boundedString(preview.preview_token, 2048)
          || !Number.isFinite(Date.parse(preview.expires_at)) || Date.parse(preview.expires_at) <= Date.now()
          || preview.owner_target || preview.can_execute !== true || !Array.isArray(preview.blockers) || preview.blockers.length > 0
          || !isOwnerMemberErasureConfirmationValid(preview.member_id, preview.auth_user_id, confirmation)) {
        throw new OwnerMemberErasureError('invalid_preview');
      }
      const safeAssignments = assertSuccessorAssignments(preview, successorAssignments);
      const reply = await invoke(client, {
        action: 'execute',
        operation_id: preview.operation_id,
        member_id: preview.member_id,
        auth_user_id: preview.auth_user_id,
        preview_token: preview.preview_token,
        successor_assignments: safeAssignments,
        confirmation,
      });
      return assertResult(reply, preview.operation_id);
    },
    async status(operationId) {
      const safeOperationId = assertOperationId(operationId);
      const reply = await invoke(client, { action: 'status', operation_id: safeOperationId });
      return assertStatus(reply, safeOperationId);
    },
    async retry(operationId) {
      const safeOperationId = assertOperationId(operationId);
      const reply = await invoke(client, { action: 'retry', operation_id: safeOperationId });
      return assertResult(reply, safeOperationId);
    },
  };
}
export const ownerMemberErasureApi = createOwnerMemberErasureApi(supabase);
export function ownerMemberErasureErrorCode(error: unknown): OwnerMemberErasureErrorCode {
  return error instanceof OwnerMemberErasureError ? error.code : 'request_failed';
}
