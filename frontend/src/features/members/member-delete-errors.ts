export type MemberDeletionErrorCode =
  | 'member_delete_no_match'
  | 'member_delete_dependency_invitations'
  | 'member_delete_dependency_team'
  | 'member_delete_dependency_projects'
  | 'member_delete_dependency_other'
  | 'member_delete_permission'
  | 'member_delete_missing_schema'
  | 'member_delete_self'
  | 'member_delete_unknown';

export interface MemberDeletionResult {
  id: number;
  deletedCount: 1;
}

export class MemberDeletionError extends Error {
  readonly code: MemberDeletionErrorCode;

  constructor(code: MemberDeletionErrorCode) {
    super(code);
    this.name = 'MemberDeletionError';
    this.code = code;
  }
}

type ProviderErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  constraint?: unknown;
};

function providerText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const value = raw as ProviderErrorLike;
  return [value.code, value.message, value.details, value.hint, value.constraint]
    .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    .join(' ')
    .toLowerCase();
}

function providerCode(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const code = (raw as ProviderErrorLike).code;
  return typeof code === 'string' ? code.toUpperCase() : '';
}

/**
 * Convert a provider response into a stable, non-provider-facing member-delete code.
 * The original provider payload is intentionally not retained on the returned Error.
 */
export function classifyMemberDeletionError(raw: unknown): MemberDeletionErrorCode {
  const code = providerCode(raw);
  const text = providerText(raw);
  const embeddedCode = text.match(/\b(?:23503|42501|42P01|42703|PGRST204|PGRST205)\b/)?.[0] ?? '';
  const effectiveCode = code || embeddedCode;

  if (effectiveCode === '42501' || /row-level security|permission denied|\bpermission\b|\brls\b/.test(text)) {
    return 'member_delete_permission';
  }

  if (effectiveCode === '42P01' || effectiveCode === '42703' || effectiveCode === 'PGRST204' || effectiveCode === 'PGRST205' || /undefined table|undefined column|schema cache|relation .* does not exist|column .* does not exist/.test(text)) {
    return 'member_delete_missing_schema';
  }

  if (effectiveCode === '23503' || /foreign key|violates .*key constraint/.test(text)) {
    if (/member_password_invitation|password invitation|invitation/.test(text)) {
      return 'member_delete_dependency_invitations';
    }
    if (/team_membership|team member|\bteam\b/.test(text)) {
      return 'member_delete_dependency_team';
    }
    if (/web_project|web idea|project|roster/.test(text)) {
      return 'member_delete_dependency_projects';
    }
    return 'member_delete_dependency_other';
  }

  return 'member_delete_unknown';
}

export function memberDeletionErrorFromProvider(raw: unknown): MemberDeletionError {
  return new MemberDeletionError(classifyMemberDeletionError(raw));
}

export function memberDeletionNoMatchError(): MemberDeletionError {
  return new MemberDeletionError('member_delete_no_match');
}

/**
 * The owner RPC raises stable machine prefixes (FORBIDDEN / SELF_DELETE_FORBIDDEN /
 * MEMBER_NOT_FOUND / MEMBER_DELETE_FAILED). Map them to the same public codes so the
 * UI never shows a raw provider payload or a vague "unconfirmed" message.
 */
export function classifyOwnerDeletionRpcError(message: unknown): MemberDeletionErrorCode {
  const text = typeof message === 'string' ? message : '';
  if (/SELF_DELETE_FORBIDDEN/.test(text)) return 'member_delete_self';
  if (/FORBIDDEN/.test(text) || /permission denied/i.test(text)) return 'member_delete_permission';
  if (/MEMBER_NOT_FOUND/.test(text)) return 'member_delete_no_match';
  if (/MEMBER_DELETE_FAILED/.test(text)) return 'member_delete_no_match';
  if (/owner_member_erasure_operations|check constraint/i.test(text)) return 'member_delete_unknown';
  return classifyMemberDeletionError({ message: text });
}

/**
 * Assert that a DELETE ... RETURNING id removed exactly the requested row.
 * A zero-row or mismatched response is never treated as success.
 */
export function assertMemberDeletionResult(
  id: number,
  rows: unknown,
  providerError?: unknown,
): MemberDeletionResult {
  if (providerError) throw memberDeletionErrorFromProvider(providerError);

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw memberDeletionNoMatchError();
  }

  const deletedId = rows[0] && typeof rows[0] === 'object' ? (rows[0] as { id?: unknown }).id : undefined;
  if (deletedId !== id) {
    throw memberDeletionNoMatchError();
  }

  return { id, deletedCount: 1 };
}
