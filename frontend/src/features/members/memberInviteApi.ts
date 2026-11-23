import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import type { Member } from '../../types/db';
import {
  buildTrustedMemberInviteUrl,
  isMemberInviteId,
  isMemberInviteToken,
  memberAuthErrorMessage,
  normalizeAuthEmail,
  readMemberEndpointCode,
} from '../auth/member-password';

export const MEMBER_INVITES_KEY = ['member_password_invites'] as const;
export const MEMBER_JOIN_REVIEWS_KEY = ['member_password_join_reviews'] as const;
export const MEMBER_JOIN_REVIEW_PAGE_SIZE = 100;
export const MEMBER_JOIN_REVIEW_REFRESH_MS = 15_000;
export type MemberInvitePurpose = 'join' | 'enroll' | 'reset';
export type MemberInviteStatus = 'pending' | 'reserved' | 'review_required';

export interface MemberInviteRecord {
  id: string;
  member_id: number | null;
  email: string | null;
  purpose: MemberInvitePurpose;
  status: MemberInviteStatus;
  note: string | null;
  expires_at: string;
  created_at: string;
}

export interface CreatedMemberInvite extends MemberInviteRecord {
  url: string;
}

export interface MemberInviteMemberOption {
  id: number;
  email: string;
  full_name: string;
  work_status: string | null;
}

export interface MemberJoinReview {
  invitationId: string;
  memberId: number;
  fullName: string;
  email: string;
  invitationEmail: string;
  emailIdentityMatches: boolean;
  phone: string | null;
  residence: string | null;
  workConditions: string | null;
  bio: string | null;
  device: string | null;
  gender: string | null;
  submittedAt: string;
}

export interface MemberJoinReviewCursor {
  submittedAt: string;
  memberId: number;
  invitationId: string;
}

export class MemberInviteApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(memberAuthErrorMessage(code, 'تعذر تنفيذ إجراء الدعوة. راجع صلاحياتك وحاول مرة أخرى.'));
    this.name = 'MemberInviteApiError';
    this.code = code;
  }
}

function mapInviteRow(value: unknown): MemberInviteRecord | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const purpose = row.purpose;
  const email = row.email === null
    ? null
    : typeof row.email === 'string' && row.email.trim() ? normalizeAuthEmail(row.email) : undefined;
  if (
    typeof row.id !== 'string' || !isMemberInviteId(row.id)
    || email === undefined || (email === null && purpose !== 'join')
    || (purpose !== 'join' && purpose !== 'enroll' && purpose !== 'reset')
    || (row.status !== 'pending' && row.status !== 'reserved' && row.status !== 'review_required')
    || typeof row.expires_at !== 'string' || typeof row.created_at !== 'string'
  ) return null;
  const memberId = row.member_id === null
    ? null
    : typeof row.member_id === 'number' && Number.isSafeInteger(row.member_id) && row.member_id > 0 ? row.member_id : undefined;
  if (memberId === undefined || ((purpose === 'join') !== (memberId === null))) return null;
  return {
    id: row.id,
    member_id: memberId,
    email,
    purpose,
    status: row.status,
    note: typeof row.note === 'string' ? row.note : null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function mapJoinReview(value: unknown): MemberJoinReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const invitationId = typeof row.invitation_id === 'string' ? row.invitation_id : null;
  const email = normalizeAuthEmail(typeof row.email === 'string' ? row.email : '');
  const invitationEmail = normalizeAuthEmail(typeof row.invitation_email === 'string' ? row.invitation_email : '');
  const emailIdentityMatches = typeof row.email_identity_matches === 'boolean' ? row.email_identity_matches : null;
  const nullableText = (key: string): string | null | undefined =>
    row[key] === null ? null : typeof row[key] === 'string' ? row[key] as string : undefined;
  const phone = nullableText('phone');
  const residence = nullableText('residence');
  const workConditions = nullableText('work_conditions');
  const bio = nullableText('bio');
  const device = nullableText('device');
  const gender = nullableText('gender');
  if (!invitationId || !isMemberInviteId(invitationId)
      || typeof row.member_id !== 'number' || !Number.isSafeInteger(row.member_id) || row.member_id <= 0
      || typeof row.full_name !== 'string' || !row.full_name.trim() || row.full_name.length > 160
      || !email || !invitationEmail || emailIdentityMatches === null
      || [phone, residence, workConditions, bio, device, gender].includes(undefined)
      || typeof row.submitted_at !== 'string' || !Number.isFinite(Date.parse(row.submitted_at))) return null;
  return {
    invitationId,
    memberId: row.member_id,
    fullName: row.full_name,
    email,
    invitationEmail,
    emailIdentityMatches,
    phone: phone ?? null,
    residence: residence ?? null,
    workConditions: workConditions ?? null,
    bio: bio ?? null,
    device: device ?? null,
    gender: gender ?? null,
    submittedAt: row.submitted_at,
  };
}

export function buildMemberInviteUrl(token: string, purpose: MemberInvitePurpose = 'join'): string {
  try {
    return buildTrustedMemberInviteUrl(token, import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined, purpose);
  } catch {
    throw new MemberInviteApiError(isMemberInviteToken(token) ? 'SERVER_CONFIG' : 'INVALID_TOKEN');
  }
}

/** Historical placeholders are filtered without promotion, deletion or any account writes. */
export function isInvitePlaceholderMember(member: Pick<Member, 'email'>): boolean {
  return typeof member.email === 'string' && member.email.toLowerCase().endsWith('@invite.phantoms.local');
}
export function syncPendingPre0020Invites(rawMembers: Member[]): Member[] {
  return rawMembers.filter((member) => !isInvitePlaceholderMember(member));
}

export async function fetchApprovedMembersForInvite(): Promise<MemberInviteMemberOption[]> {
  const { data, error } = await supabase.from('members')
    .select('id, email, full_name, work_status').eq('work_status', 'active')
    .order('full_name', { ascending: true }).limit(500);
  if (error || !data) throw new MemberInviteApiError('SERVER_UNAVAILABLE');
  return (data as Array<Record<string, unknown>>)
    .filter((row) => typeof row.id === 'number' && typeof row.email === 'string' && typeof row.full_name === 'string')
    .map((row) => ({
      id: Number(row.id), email: normalizeAuthEmail(String(row.email)), full_name: String(row.full_name),
      work_status: typeof row.work_status === 'string' ? row.work_status : null,
    }));
}

interface IssueInput {
  memberId: number | null;
  email: string | null;
  purpose: MemberInvitePurpose;
  expiresInHours: number;
  note?: string;
}

export function useCreateMemberInvite() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (input: IssueInput): Promise<CreatedMemberInvite> => {
      const email = input.email === null ? null : normalizeAuthEmail(input.email);
      if ((input.purpose === 'join'
        ? input.memberId !== null
        : !Number.isSafeInteger(input.memberId) || (input.memberId ?? 0) <= 0 || email === null) || (input.email !== null && !email)
        || (input.purpose !== 'join' && input.purpose !== 'enroll' && input.purpose !== 'reset')) {
        throw new MemberInviteApiError('INVALID_INPUT');
      }
      const { data, error } = await supabase.functions.invoke<{
        invite?: { id?: string; token?: string; email?: string | null; member_id?: number | null; purpose?: MemberInvitePurpose; note?: string | null; expires_at?: string };
        code?: string;
      }>('member-password-enrollment', {
        body: {
          action: 'issue', memberId: input.memberId, email, purpose: input.purpose,
          expiresInHours: input.expiresInHours, note: input.note?.trim() || '',
        },
      });
      if (error) throw new MemberInviteApiError(await readMemberEndpointCode(error));
      const invite = data?.invite;
      const issuedEmail = invite?.email === null
        ? null
        : typeof invite?.email === 'string' && invite.email.trim() ? normalizeAuthEmail(invite.email) : undefined;
      if (!invite || typeof invite.id !== 'string' || !isMemberInviteId(invite.id)
        || typeof invite.token !== 'string' || !isMemberInviteToken(invite.token)
        || invite.member_id !== input.memberId || issuedEmail === undefined
        || issuedEmail !== email || invite.purpose !== input.purpose
        || typeof invite.expires_at !== 'string') {
        throw new MemberInviteApiError(await readMemberEndpointCode(data));
      }
      return {
        id: invite.id, member_id: input.memberId, email, purpose: input.purpose, status: 'pending',
        note: typeof invite.note === 'string' ? invite.note : null, expires_at: invite.expires_at,
        created_at: new Date().toISOString(), url: buildMemberInviteUrl(invite.token, invite.purpose),
      };
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: MEMBER_INVITES_KEY }); },
  });
}

export function usePendingMemberInvites(enabled = true) {
  return useQuery({
    queryKey: MEMBER_INVITES_KEY, enabled,
    queryFn: async (): Promise<MemberInviteRecord[]> => {
      const { data, error } = await supabase.functions.invoke<{ invites?: unknown[]; code?: string }>(
        'member-password-enrollment', { body: { action: 'list' } },
      );
      if (error) throw new MemberInviteApiError(await readMemberEndpointCode(error));
      if (!Array.isArray(data?.invites)) throw new MemberInviteApiError(await readMemberEndpointCode(data));
      return data.invites.map(mapInviteRow).filter((row): row is MemberInviteRecord => row !== null);
    },
  });
}

export function usePendingMemberJoinReviews(enabled = true) {
  return useInfiniteQuery({
    queryKey: MEMBER_JOIN_REVIEWS_KEY,
    enabled,
    refetchInterval: MEMBER_JOIN_REVIEW_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    initialPageParam: null as MemberJoinReviewCursor | null,
    queryFn: async ({ pageParam }): Promise<MemberJoinReview[]> => {
      const { data, error } = await supabase.functions.invoke<{ reviews?: unknown[]; code?: string }>(
        'member-password-enrollment', {
          body: pageParam
            ? { action: 'list_join_reviews', cursor: pageParam }
            : { action: 'list_join_reviews' },
        },
      );
      if (error) throw new MemberInviteApiError(await readMemberEndpointCode(error));
      if (!Array.isArray(data?.reviews)) throw new MemberInviteApiError(await readMemberEndpointCode(data));
      const reviews = data.reviews.map(mapJoinReview);
      if (reviews.some((review) => review === null)) throw new MemberInviteApiError('SERVER_UNAVAILABLE');
      return reviews as MemberJoinReview[];
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < MEMBER_JOIN_REVIEW_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last ? { submittedAt: last.submittedAt, memberId: last.memberId, invitationId: last.invitationId } : undefined;
    },
  });
}

export function useApproveMemberJoin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: number): Promise<{ alreadyApproved: boolean }> => {
      if (!Number.isSafeInteger(memberId) || memberId <= 0) throw new MemberInviteApiError('INVALID_INPUT');
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean; approved?: boolean; alreadyApproved?: boolean; code?: string;
      }>('member-password-enrollment', { body: { action: 'approve_join', memberId } });
      if (error) throw new MemberInviteApiError(await readMemberEndpointCode(error));
      if (data?.ok !== true || (data.approved !== true && data.alreadyApproved !== true)) {
        throw new MemberInviteApiError(await readMemberEndpointCode(data));
      }
      return { alreadyApproved: data.alreadyApproved === true };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MEMBER_JOIN_REVIEWS_KEY });
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

export interface MemberPasswordResetResult {
  memberId: number;
  email: string;
  temporaryPassword: string;
}

/**
 * Administrators set a working temporary password on the spot instead of
 * issuing a link the member may never open. The member signs in with it and is
 * asked to choose a personal password from inside the portal or the app.
 */
export function useSetMemberPassword() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (memberId: number): Promise<MemberPasswordResetResult> => {
      if (!Number.isSafeInteger(memberId) || memberId <= 0) throw new MemberInviteApiError('INVALID_INPUT');
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean; memberId?: number; email?: string; temporaryPassword?: string; code?: string;
      }>('member-password-enrollment', { body: { action: 'set_password', memberId } });
      if (error) throw new MemberInviteApiError(await readMemberEndpointCode(error));
      const email = normalizeAuthEmail(typeof data?.email === 'string' ? data.email : '');
      if (data?.ok !== true || data.memberId !== memberId || !email
          || typeof data.temporaryPassword !== 'string' || !data.temporaryPassword) {
        throw new MemberInviteApiError(await readMemberEndpointCode(data));
      }
      return { memberId, email, temporaryPassword: data.temporaryPassword };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MEMBER_INVITES_KEY });
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

export function useRevokeMemberInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string): Promise<string> => {
      if (!isMemberInviteId(inviteId)) throw new MemberInviteApiError('INVALID_INPUT');
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; code?: string }>(
        'member-password-enrollment', { body: { action: 'revoke', inviteId } },
      );
      if (error) throw new MemberInviteApiError(await readMemberEndpointCode(error));
      if (data?.ok !== true) throw new MemberInviteApiError(await readMemberEndpointCode(data));
      return inviteId;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: MEMBER_INVITES_KEY }); },
  });
}
