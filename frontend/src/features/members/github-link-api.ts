import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { memberSupabase } from '../../lib/supabase/member-client';
import { githubAvatarUrl as sharedGithubAvatarUrl, normalizeGithubHandle as sharedNormalizeGithubHandle } from '../dashboard/github';

interface RpcResult { data: unknown; error: { message?: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
const memberRpc = memberSupabase as unknown as RpcClient;

export type GithubLinkErrorCode = 'INVALID_HANDLE' | 'HANDLE_TAKEN' | 'NOT_FOUND' | 'MEMBER_SCOPE_REQUIRED' | 'SERVER_UNAVAILABLE';

export class GithubLinkError extends Error {
  readonly code: GithubLinkErrorCode;
  constructor(code: GithubLinkErrorCode) {
    super(code);
    this.code = code;
  }
}

/** نفس تطبيع الـ handle اللي في الـ RPC: لينك كامل أو @handle أو handle — ونخزّنه lowercase. */
export function normalizeGithubHandle(input: string): string | null {
  const handle = sharedNormalizeGithubHandle(input);
  return handle ? handle.toLowerCase() : null;
}

export const githubAvatarUrl = sharedGithubAvatarUrl;

export interface GithubProfile {
  handle: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string;
  htmlUrl: string;
  repos: number;
  followers: number;
  createdAt: string | null;
}

/** تحقق حقيقي من الحساب على GitHub قبل الحفظ — لو فشل الشبكة بنكمل ونحفظ الـ handle زي ما هو. */
export async function fetchGithubProfile(handle: string, signal?: AbortSignal): Promise<GithubProfile | null> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/users/${encodeURIComponent(handle)}`, {
      signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch {
    return null;
  }
  if (response.status === 404) throw new GithubLinkError('NOT_FOUND');
  if (!response.ok) return null;
  const raw = await response.json() as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    handle,
    name: str(raw.name) || null,
    bio: str(raw.bio) || null,
    avatarUrl: str(raw.avatar_url) || githubAvatarUrl(handle),
    htmlUrl: str(raw.html_url) || `https://github.com/${handle}`,
    repos: typeof raw.public_repos === 'number' ? raw.public_repos : 0,
    followers: typeof raw.followers === 'number' ? raw.followers : 0,
    createdAt: str(raw.created_at) || null,
  };
}

function toLinkError(cause: unknown): never {
  const message = typeof cause === 'object' && cause !== null && 'message' in cause
    ? String((cause as { message?: unknown }).message ?? '')
    : '';
  const known: GithubLinkErrorCode[] = ['INVALID_HANDLE', 'HANDLE_TAKEN', 'MEMBER_SCOPE_REQUIRED'];
  const code = known.find((candidate) => message.includes(candidate));
  throw new GithubLinkError(code ?? 'SERVER_UNAVAILABLE');
}

export const githubLinkKeys = { state: ['member', 'github-link'] as const };

export interface GithubLinkState {
  handle: string | null;
  linked: boolean;
  profile_url: string | null;
}

export function useGithubLinkState() {
  return useQuery({
    queryKey: githubLinkKeys.state,
    staleTime: 60_000,
    queryFn: async (): Promise<GithubLinkState> => {
      let result: RpcResult;
      try {
        result = await memberRpc.rpc('member_github_state');
      } catch (cause) {
        toLinkError(cause);
      }
      if (result.error) toLinkError(result.error);
      const data = (result.data ?? {}) as Partial<GithubLinkState>;
      return {
        handle: typeof data.handle === 'string' ? data.handle : null,
        linked: data.linked === true,
        profile_url: typeof data.profile_url === 'string' ? data.profile_url : null,
      };
    },
  });
}

export function useLinkGithub() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (handle: string): Promise<GithubLinkState> => {
      let result: RpcResult;
      try {
        result = await memberRpc.rpc('member_github_link', { p_handle: handle });
      } catch (cause) {
        toLinkError(cause);
      }
      if (result.error) toLinkError(result.error);
      const data = (result.data ?? {}) as { handle?: string | null; linked?: boolean };
      const next = typeof data.handle === 'string' ? data.handle : null;
      return { handle: next, linked: data.linked === true, profile_url: next ? `https://github.com/${next}` : null };
    },
    onSuccess: (state) => {
      cache.setQueryData(githubLinkKeys.state, state);
      void cache.invalidateQueries({ queryKey: ['members'] });
    },
  });
}
