export type RpcError = { message?: string } | null;
export type RpcResult<T = unknown> = { data: T | null; error: RpcError };

export interface RpcClient {
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<RpcResult<T>>;
}

export interface AuthAdminClient {
  auth: {
    admin: {
      createUser(attributes: { email: string; password: string; email_confirm: true }): Promise<RpcResult<{ user?: { id?: string } }>>;
      updateUserById(userId: string, attributes: { password: string; email_confirm?: true }): Promise<RpcResult<{ user?: { id?: string } }>>;
    };
  };
}

export interface AdminActor {
  userId: string;
}

export interface ControllerRuntime {
  configReady: boolean;
  serviceDb: RpcClient;
  adminDb: RpcClient;
  authAdmin: AuthAdminClient;
  authorizeAdmin(authorization: string): Promise<AdminActor | null>;
}

export interface ControllerOptions {
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  now?: () => Date;
}

const SAFE_CODES = new Set([
  'INVALID_INPUT', 'INVALID_TOKEN', 'WRONG_EMAIL', 'EXPIRED', 'REVOKED', 'ALREADY_USED',
  'MEMBER_DISABLED', 'MEMBER_NOT_FOUND', 'IDENTITY_CONFLICT', 'PASSWORD_ALREADY_SET',
  'PASSWORD_MISMATCH', 'WEAK_PASSWORD', 'RATE_LIMITED', 'SERVER_CONFIG', 'SERVER_UNAVAILABLE',
  'REVIEW_REQUIRED', 'UNAUTHORIZED',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^phpw_[0-9a-f]{64}$/;
const MAX_MEMBER_PASSWORD_BYTES = 72;
const MAX_MEMBER_PASSWORD_CODE_UNITS = 128;
const PROFILE_KEYS = ['fullName', 'phone', 'residence', 'workConditions', 'bio', 'device', 'gender'] as const;
const MEMBER_DEVICES = new Set(['', 'لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول']);
type MemberSelfServiceProfile = {
  fullName: string; phone: string | null; residence: string | null;
  workConditions: string | null; bio: string | null; device: string | null; gender: string | null;
};
const DEFAULT_ALLOWED_ORIGINS = [
  'https://dashboard-phantoms.vercel.app',
] as const;

const jsonHeaders = (origin: string) => ({
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': origin || DEFAULT_ALLOWED_ORIGINS[0],
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Origin',
});

const response = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });

const errorResponse = (code: string, status: number, origin: string) =>
  response({ code: SAFE_CODES.has(code) ? code : 'SERVER_UNAVAILABLE' }, status, origin);

const errorCode = (error: RpcError): string | null => {
  const message = typeof error?.message === 'string' ? error.message : '';
  const match = message.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
  return match?.[1] ?? null;
};

const statusForCode = (code: string): number => {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'SERVER_CONFIG' || code === 'SERVER_UNAVAILABLE') return 503;
  if (code === 'REVIEW_REQUIRED') return 409;
  return 400;
};

const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 254 && EMAIL_RE.test(email) ? email : null;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const parseObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

async function readBody(req: Request, maxBodyBytes: number): Promise<Record<string, unknown> | null> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxBodyBytes) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseObject(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `phpw_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function rateLimitKey(runtime: ControllerRuntime, value: string, maxAttempts: number): Promise<'ok' | 'limited' | 'unavailable'> {
  const result = await runtime.serviceDb.rpc<boolean>('member_password_check_rate_limit', {
    p_key_hash: await sha256Hex(value),
    p_max_attempts: maxAttempts,
    p_window_seconds: 900,
    p_block_seconds: 900,
  });
  if (result.error || typeof result.data !== 'boolean') return 'unavailable';
  return result.data ? 'limited' : 'ok';
}

async function rateLimitCredentials(runtime: ControllerRuntime, body: Record<string, unknown>): Promise<'ok' | 'limited' | 'unavailable'> {
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 512) : '<missing-email>';
  const rawToken = typeof body.token === 'string' ? body.token.slice(0, 1024) : '<missing-token>';
  for (const [key, max] of [
    [`member-password:email:${rawEmail}`, 8],
    [`member-password:token:${rawToken}`, 8],
  ] as const) {
    const result = await rateLimitKey(runtime, key, max);
    if (result !== 'ok') return result;
  }
  return 'ok';
}

async function markReview(runtime: ControllerRuntime, claim: { invitation_id: string; claim_id: string }): Promise<void> {
  await runtime.serviceDb.rpc('member_password_mark_review_required', {
    p_invitation_id: claim.invitation_id,
    p_claim_id: claim.claim_id,
  });
}

function validateProfile(value: unknown): MemberSelfServiceProfile | null {
  const profile = parseObject(value);
  if (!profile || !hasExactKeys(profile, PROFILE_KEYS) || PROFILE_KEYS.some((key) => typeof profile[key] !== 'string')) return null;
  const values = Object.fromEntries(PROFILE_KEYS.map((key) => [key, (profile[key] as string).trim()])) as Record<typeof PROFILE_KEYS[number], string>;
  const noControls = (text: string) => !/[\u0000-\u001f\u007f]/.test(text);
  const optional = (text: string) => text || null;
  if (!values.fullName || values.fullName.length > 160 || !noControls(values.fullName)
      || (values.phone !== '' && (values.phone.length > 32 || !/^\+?[0-9 ()-]{7,32}$/.test(values.phone)))
      || (values.residence !== '' && (values.residence.length > 160 || !noControls(values.residence)))
      || (values.workConditions !== '' && (values.workConditions.length > 2000 || !noControls(values.workConditions)))
      || (values.bio !== '' && (values.bio.length > 4000 || !noControls(values.bio)))
      || !MEMBER_DEVICES.has(values.device)
      || (values.gender !== '' && values.gender !== 'ذكر' && values.gender !== 'أنثى')) return null;
  return {
    fullName: values.fullName, phone: optional(values.phone), residence: optional(values.residence),
    workConditions: optional(values.workConditions), bio: optional(values.bio),
    device: optional(values.device), gender: optional(values.gender),
  };
}

function validateEnroll(body: Record<string, unknown>):
  | { ok: true; email: string; token: string; password: string; profile: MemberSelfServiceProfile | null }
  | { ok: false; code: string } {
  const baseKeys = ['action', 'email', 'token', 'password', 'confirmPassword'] as const;
  const hasProfile = Object.hasOwn(body, 'profile');
  if (!hasExactKeys(body, hasProfile ? [...baseKeys, 'profile'] : baseKeys)) return { ok: false, code: 'INVALID_INPUT' };
  const email = normalizeEmail(body.email);
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : null;
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : null;
  const profile = hasProfile ? validateProfile(body.profile) : null;
  if (!email || !TOKEN_RE.test(token) || password === null || confirmPassword === null || (hasProfile && !profile)) return { ok: false, code: 'INVALID_INPUT' };
  if (password !== confirmPassword) return { ok: false, code: 'PASSWORD_MISMATCH' };
  if (
    password.length < 12
    || password.length > MAX_MEMBER_PASSWORD_CODE_UNITS
    || new TextEncoder().encode(password).byteLength > MAX_MEMBER_PASSWORD_BYTES
    || !/[A-Za-z]/.test(password)
    || !/[0-9]/.test(password)
  ) {
    return { ok: false, code: 'WEAK_PASSWORD' };
  }
  return { ok: true, email, token, password, profile };
}

function validateIssue(body: Record<string, unknown>):
  | { ok: true; memberId: number | null; email: string; purpose: 'enroll' | 'reset' | 'join'; expiresInHours: number; note: string }
  | { ok: false; code: string } {
  const requiredKeys = ['action', 'memberId', 'email', 'purpose', 'expiresInHours', 'note'] as const;
  if (!hasExactKeys(body, requiredKeys)) return { ok: false, code: 'INVALID_INPUT' };
  const email = normalizeEmail(body.email);
  const memberId = body.memberId === null ? null : typeof body.memberId === 'number' && Number.isSafeInteger(body.memberId) && body.memberId > 0 ? body.memberId : null;
  const purpose = body.purpose === 'enroll' || body.purpose === 'reset' || body.purpose === 'join' ? body.purpose : null;
  const expires = typeof body.expiresInHours === 'number' && Number.isInteger(body.expiresInHours) && body.expiresInHours >= 1 && body.expiresInHours <= 2160 ? body.expiresInHours : null;
  const note = typeof body.note === 'string' && body.note.length <= 500 ? body.note : null;
  if (!email || purpose === null || expires === null || note === null
      || (purpose === 'join' ? body.memberId !== null : memberId === null)) return { ok: false, code: 'INVALID_INPUT' };
  return { ok: true, memberId, email, purpose, expiresInHours: expires, note };
}

function validateRevoke(body: Record<string, unknown>): { ok: true; inviteId: string } | { ok: false; code: string } {
  if (!hasExactKeys(body, ['action', 'inviteId']) || typeof body.inviteId !== 'string' || !UUID_RE.test(body.inviteId)) return { ok: false, code: 'INVALID_INPUT' };
  return { ok: true, inviteId: body.inviteId };
}

async function enroll(runtime: ControllerRuntime, body: Record<string, unknown>, req: Request, origin: string): Promise<Response> {
  const parsed = validateEnroll(body);
  if (!parsed.ok) return errorResponse(parsed.code, statusForCode(parsed.code), origin);
  if (req.signal.aborted) return errorResponse('SERVER_UNAVAILABLE', 503, origin);
  const limited = await rateLimitCredentials(runtime, { email: parsed.email, token: parsed.token });
  if (limited === 'unavailable') return errorResponse('SERVER_UNAVAILABLE', 503, origin);
  if (limited === 'limited') return errorResponse('RATE_LIMITED', 429, origin);
  const health = await runtime.serviceDb.rpc<boolean>('member_password_service_health');
  if (health.error || health.data !== true) return errorResponse('SERVER_UNAVAILABLE', 503, origin);

  let claim: { invitation_id: string; claim_id: string; member_id: number | null; email: string; purpose: 'enroll' | 'reset' | 'join'; expected_auth_user_id: string | null } | null = null;
  let reviewMarked = false;
  const quarantine = async () => {
    if (!claim || reviewMarked) return;
    reviewMarked = true;
    try {
      await markReview(runtime, claim);
    } catch {
      // Quarantine is best effort; never retry or release an uncertain Auth write.
    }
  };

  try {
    const reserved = await runtime.serviceDb.rpc<{
      invitation_id: string; claim_id: string; member_id: number | null; email: string; purpose: 'enroll' | 'reset' | 'join'; expected_auth_user_id: string | null;
    }>('member_password_reserve', { p_token_hash: await sha256Hex(parsed.token), p_email: parsed.email });
    if (reserved.error || !reserved.data) {
      const code = errorCode(reserved.error) ?? 'SERVER_UNAVAILABLE';
      return errorResponse(SAFE_CODES.has(code) ? code : 'SERVER_UNAVAILABLE', statusForCode(code), origin);
    }
    if ((reserved.data as { status?: unknown }).status === 'expired') {
      return errorResponse('EXPIRED', statusForCode('EXPIRED'), origin);
    }
    if (typeof reserved.data.invitation_id !== 'string' || !UUID_RE.test(reserved.data.invitation_id)
        || typeof reserved.data.claim_id !== 'string' || !UUID_RE.test(reserved.data.claim_id)) {
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    claim = reserved.data;
    const validMemberBinding = claim.purpose === 'join'
      ? claim.member_id === null && claim.expected_auth_user_id === null
      : Number.isSafeInteger(claim.member_id) && (claim.member_id ?? 0) > 0;
    if (!validMemberBinding || claim.email !== parsed.email
        || (claim.purpose !== 'enroll' && claim.purpose !== 'reset' && claim.purpose !== 'join')
        || (claim.expected_auth_user_id !== null && (typeof claim.expected_auth_user_id !== 'string' || !UUID_RE.test(claim.expected_auth_user_id)))
        || (claim.purpose === 'reset' && claim.expected_auth_user_id === null)) {
      await quarantine();
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    if ((claim.purpose === 'reset' && parsed.profile !== null)
        || (claim.purpose !== 'reset' && parsed.profile === null)) {
      await quarantine();
      return errorResponse('INVALID_INPUT', 400, origin);
    }
    if (req.signal.aborted) {
      await quarantine();
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    let authUserId: string | null = claim.expected_auth_user_id;

    if (authUserId) {
      const state = await runtime.serviceDb.rpc<{
        exists: boolean; auth_user_id?: string; email?: string; email_matches?: boolean; has_password?: boolean; email_confirmed?: boolean; usable?: boolean; is_admin?: boolean;
      }>('member_password_identity_state', { p_auth_user_id: authUserId, p_email: parsed.email });
      if (state.error || state.data?.exists !== true || state.data.auth_user_id !== authUserId) {
        await quarantine();
        return errorResponse('REVIEW_REQUIRED', 409, origin);
      }
      if (state.data.email_matches !== true || state.data.usable !== true || state.data.is_admin !== false) {
        await quarantine();
        return errorResponse('IDENTITY_CONFLICT', 409, origin);
      }
      if (claim.purpose === 'enroll' && state.data.has_password !== false) {
        await quarantine();
        return errorResponse(state.data.has_password === true ? 'PASSWORD_ALREADY_SET' : 'REVIEW_REQUIRED', 409, origin);
      }
    } else {
      const identity = await runtime.serviceDb.rpc<{
        exists: boolean; auth_user_id?: string; has_password?: boolean; email_confirmed?: boolean; usable?: boolean; is_admin?: boolean;
      }>('member_password_identity_by_email', { p_email: parsed.email });
      if (identity.error || !identity.data || identity.data.exists !== false) {
        await quarantine();
        return errorResponse(identity.data?.exists === true ? 'IDENTITY_CONFLICT' : 'REVIEW_REQUIRED', 409, origin);
      }
      if (identity.data.exists) {
        await quarantine();
        return errorResponse('IDENTITY_CONFLICT', 409, origin);
      }
    }

    if (req.signal.aborted) {
      await quarantine();
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    if (claim.expected_auth_user_id) {
      const write = await runtime.authAdmin.auth.admin.updateUserById(claim.expected_auth_user_id, {
        password: parsed.password,
        ...(claim.purpose === 'enroll' ? { email_confirm: true as const } : {}),
      });
      if (write.error || !write.data?.user?.id || write.data.user.id !== claim.expected_auth_user_id) {
        await quarantine();
        return errorResponse('REVIEW_REQUIRED', 409, origin);
      }
      authUserId = write.data.user.id;
    } else {
      const identity = await runtime.serviceDb.rpc<{ exists: boolean }>('member_password_identity_by_email', { p_email: parsed.email });
      if (identity.error || identity.data?.exists !== false) {
        await quarantine();
        return errorResponse(identity.data?.exists === true ? 'IDENTITY_CONFLICT' : 'REVIEW_REQUIRED', 409, origin);
      }
      const created = await runtime.authAdmin.auth.admin.createUser({ email: parsed.email, password: parsed.password, email_confirm: true });
      if (created.error || !created.data?.user?.id) {
        await quarantine();
        return errorResponse('REVIEW_REQUIRED', 409, origin);
      }
      authUserId = created.data.user.id;
    }

    if (!authUserId) throw new Error('missing Auth user id');
    if (req.signal.aborted) {
      await quarantine();
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    const completed = await runtime.serviceDb.rpc<{ ok?: boolean; membership?: string }>('member_password_complete_profile', {
      p_invitation_id: claim.invitation_id,
      p_claim_id: claim.claim_id,
      p_auth_user_id: authUserId,
      p_profile: parsed.profile,
    });
    const expectedMembership = claim.purpose === 'join' ? 'pending_review' : 'active';
    if (completed.error || completed.data?.ok !== true || completed.data.membership !== expectedMembership) {
      await quarantine();
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    if (req.signal.aborted) {
      await quarantine();
      return errorResponse('REVIEW_REQUIRED', 409, origin);
    }
    return response({ ok: true, membership: expectedMembership }, 200, origin);
  } catch {
    await quarantine();
    return errorResponse('REVIEW_REQUIRED', 409, origin);
  }
}

async function issue(runtime: ControllerRuntime, body: Record<string, unknown>, actor: AdminActor, origin: string): Promise<Response> {
  const parsed = validateIssue(body);
  if (!parsed.ok) return errorResponse(parsed.code, statusForCode(parsed.code), origin);
  const token = randomInvitationToken();
  const issued = await runtime.adminDb.rpc<{
    id: string; member_id: number | null; email: string; purpose: 'enroll' | 'reset' | 'join'; note: string; expires_at: string;
  }>('member_password_issue_invitation', {
    p_token_hash: await sha256Hex(token),
    p_member_id: parsed.memberId,
    p_email: parsed.email,
    p_purpose: parsed.purpose,
    p_expected_auth_user_id: null,
    p_association_evidence: null,
    p_expires_in_hours: parsed.expiresInHours,
    p_note: parsed.note,
    p_actor_user_id: actor.userId,
  });
  if (issued.error || !issued.data) {
    const code = errorCode(issued.error) ?? 'SERVER_UNAVAILABLE';
    return errorResponse(SAFE_CODES.has(code) ? code : 'SERVER_UNAVAILABLE', statusForCode(code), origin);
  }
  return response({ invite: { ...issued.data, token } }, 200, origin);
}

async function adminAction(runtime: ControllerRuntime, body: Record<string, unknown>, authorization: string, origin: string): Promise<Response> {
  const actor = await runtime.authorizeAdmin(authorization);
  if (!actor) return errorResponse('UNAUTHORIZED', 401, origin);
  const limited = await rateLimitKey(runtime, `member-password:admin:${actor.userId}`, 60);
  if (limited === 'unavailable') return errorResponse('SERVER_UNAVAILABLE', 503, origin);
  if (limited === 'limited') return errorResponse('RATE_LIMITED', 429, origin);
  if (body.action === 'issue') return await issue(runtime, body, actor, origin);
  if (body.action === 'revoke') {
    const parsed = validateRevoke(body);
    if (!parsed.ok) return errorResponse(parsed.code, statusForCode(parsed.code), origin);
    const result = await runtime.adminDb.rpc<boolean>('member_password_revoke_invitation', { p_invitation_id: parsed.inviteId, p_actor_user_id: actor.userId });
    if (result.error) {
      const code = errorCode(result.error) ?? 'SERVER_UNAVAILABLE';
      return errorResponse(SAFE_CODES.has(code) ? code : 'SERVER_UNAVAILABLE', statusForCode(code), origin);
    }
    return response({ ok: result.data === true }, 200, origin);
  }
  if (body.action === 'list') {
    if (!hasExactKeys(body, ['action'])) return errorResponse('INVALID_INPUT', 400, origin);
    const result = await runtime.adminDb.rpc('member_password_list_invitations', { p_actor_user_id: actor.userId });
    if (result.error || !Array.isArray(result.data)) return errorResponse('SERVER_UNAVAILABLE', 503, origin);
    return response({ invites: result.data }, 200, origin);
  }
  return errorResponse('INVALID_INPUT', 400, origin);
}

export function createMemberPasswordEnrollmentController(runtime: ControllerRuntime, options: ControllerOptions = {}) {
  const allowedOrigins = new Set((options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS).map((origin) => origin.replace(/\/+$/, '')));
  const maxBodyBytes = options.maxBodyBytes ?? 16 * 1024;
  return async function handle(req: Request): Promise<Response> {
    const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
    if (origin && !allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders(origin) });
    if (req.method !== 'POST') return errorResponse('INVALID_INPUT', 405, origin);
    if (!runtime.configReady) return errorResponse('SERVER_CONFIG', 503, origin);
    try {
      const body = await readBody(req, maxBodyBytes);
      if (!body || typeof body.action !== 'string') return errorResponse('INVALID_INPUT', 400, origin);
      const authorization = req.headers.get('Authorization') ?? '';
      if (body.action === 'enroll') return await enroll(runtime, body, req, origin);
      if (body.action === 'issue' || body.action === 'revoke' || body.action === 'list') {
        if (!authorization) return errorResponse('UNAUTHORIZED', 401, origin);
        return await adminAction(runtime, body, authorization, origin);
      }
      return errorResponse('INVALID_INPUT', 400, origin);
    } catch {
      return errorResponse('SERVER_UNAVAILABLE', 503, origin);
    }
  };
}
