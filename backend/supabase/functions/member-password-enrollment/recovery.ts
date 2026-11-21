import type { RpcClient } from './controller.ts';

type RpcError = { message?: string } | null;
type RpcResult<T = unknown> = { data: T | null; error: RpcError };

export interface RecoveryRuntime {
  serviceDb: RpcClient;
  sendRecoveryEmail?: (email: string, redirectTo: string, codeChallenge: string) => Promise<{ error: unknown }>;
  authorizeRecovery?: (authorization: string) => Promise<{
    userId: string;
    email: string;
    db: RpcClient;
  } | null>;
}

const DEFAULT_ALLOWED_ORIGIN = 'https://dashboard-phantoms.vercel.app';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_CODES = new Set([
  'INVALID_INPUT', 'PASSWORD_MISMATCH', 'WEAK_PASSWORD', 'RATE_LIMITED',
  'SERVER_UNAVAILABLE', 'UNAUTHORIZED', 'REVIEW_REQUIRED',
]);
const MAX_PASSWORD_BYTES = 72;
const MAX_PASSWORD_CODE_UNITS = 128;

type RecoverySuccess = { ok: true };

const jsonHeaders = (origin: string) => ({
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': origin || DEFAULT_ALLOWED_ORIGIN,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Origin',
});

const response = (body: unknown, status: number, origin: string) => new Response(
  JSON.stringify(body),
  { status, headers: jsonHeaders(origin) },
);

const errorResponse = (code: string, status: number, origin: string) => response(
  { code: SAFE_CODES.has(code) ? code : 'SERVER_UNAVAILABLE' },
  status,
  origin,
);

const statusForCode = (code: string): number => {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'SERVER_UNAVAILABLE') return 503;
  return 400;
};

const parseErrorCode = (error: RpcError | unknown): string | null => {
  const message = error && typeof error === 'object' && 'message' in error
    ? (error as { message?: unknown }).message
    : null;
  if (typeof message !== 'string') return null;
  return message.match(/\b([A-Z][A-Z0-9_]{2,})\b/)?.[1] ?? null;
};

const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const randomInvitationToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `phpw_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const rateLimit = async (
  runtime: RecoveryRuntime,
  key: string,
): Promise<'ok' | 'limited' | 'unavailable'> => {
  try {
    const result = await runtime.serviceDb.rpc<boolean>('member_password_check_rate_limit', {
      p_key_hash: await sha256Hex(key),
      p_max_attempts: 8,
      p_window_seconds: 900,
      p_block_seconds: 900,
    });
    if (result.error || typeof result.data !== 'boolean') return 'unavailable';
    return result.data ? 'limited' : 'ok';
  } catch {
    return 'unavailable';
  }
};

const validatePassword = (body: Record<string, unknown>):
  | { ok: true; password: string }
  | { ok: false; code: 'INVALID_INPUT' | 'PASSWORD_MISMATCH' | 'WEAK_PASSWORD' } => {
  if (!hasExactKeys(body, ['action', 'password', 'confirmPassword'])
      || typeof body.password !== 'string' || typeof body.confirmPassword !== 'string') {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  const password = body.password;
  if (password !== body.confirmPassword) return { ok: false, code: 'PASSWORD_MISMATCH' };
  if (
    password.length < 12
    || password.length > MAX_PASSWORD_CODE_UNITS
    || new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES
    || !/[A-Za-z]/.test(password)
    || !/[0-9]/.test(password)
  ) return { ok: false, code: 'WEAK_PASSWORD' };
  return { ok: true, password };
};

const DELIVERY_CODES = new Set(['EMAIL_SEND_FAILED', 'SMTP_ERROR', 'OVER_EMAIL_SEND_RATE_LIMIT']);
const sanitizeDeliveryCode = (error: unknown): string => {
  const code = parseErrorCode(error);
  return code && DELIVERY_CODES.has(code) ? code : 'DELIVERY_FAILED';
};

async function requestRecovery(
  runtime: RecoveryRuntime,
  body: Record<string, unknown>,
  origin: string,
  redirectTo: string,
): Promise<Response> {
  if (!hasExactKeys(body, ['action', 'email', 'codeChallenge'])
      || typeof body.codeChallenge !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge)) return errorResponse('INVALID_INPUT', 400, origin);
  const email = normalizeEmail(body.email);
  if (!email) return errorResponse('INVALID_INPUT', 400, origin);

  const limited = await rateLimit(runtime, `member-password:recovery:email:${email}`);
  if (limited === 'unavailable') return errorResponse('SERVER_UNAVAILABLE', 503, origin);
  if (limited === 'limited') return errorResponse('RATE_LIMITED', 429, origin);

  let eligible: RpcResult<boolean>;
  try {
    eligible = await runtime.serviceDb.rpc<boolean>('member_password_recovery_eligible', { p_email: email });
  } catch {
    return errorResponse('SERVER_UNAVAILABLE', 503, origin);
  }
  if (eligible.error || typeof eligible.data !== 'boolean') return errorResponse('SERVER_UNAVAILABLE', 503, origin);

  // Unknown and ineligible addresses intentionally share the same body and
  // status. Native Auth delivery is attempted only after the private check.
  if (eligible.data === true && runtime.sendRecoveryEmail) {
    try {
      const delivery = await runtime.sendRecoveryEmail(email, redirectTo, body.codeChallenge);
      if (delivery.error) console.warn('member recovery delivery failure', sanitizeDeliveryCode(delivery.error));
    } catch (error) {
      console.warn('member recovery delivery failure', sanitizeDeliveryCode(error));
    }
  }
  return response({ ok: true } satisfies RecoverySuccess, 200, origin);
}

async function completeRecovery(
  runtime: RecoveryRuntime,
  body: Record<string, unknown>,
  req: Request,
  origin: string,
  redeem: (body: Record<string, unknown>) => Promise<Response>,
): Promise<Response> {
  const parsed = validatePassword(body);
  if (!parsed.ok) return errorResponse(parsed.code, statusForCode(parsed.code), origin);
  if (!runtime.authorizeRecovery) return errorResponse('UNAUTHORIZED', 401, origin);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization) return errorResponse('UNAUTHORIZED', 401, origin);
  let actor: { userId: string; email: string; db: RpcClient } | null;
  try {
    actor = await runtime.authorizeRecovery(authorization);
  } catch {
    return errorResponse('UNAUTHORIZED', 401, origin);
  }
  const email = normalizeEmail(actor?.email);
  if (!actor || !email || !actor.userId) return errorResponse('UNAUTHORIZED', 401, origin);

  const limited = await rateLimit(runtime, `member-password:recovery:user:${actor.userId}`);
  if (limited === 'unavailable') return errorResponse('SERVER_UNAVAILABLE', 503, origin);
  if (limited === 'limited') return errorResponse('RATE_LIMITED', 429, origin);

  // Abort before this point is safe: no invitation or claim exists yet.
  if (req.signal.aborted) return errorResponse('SERVER_UNAVAILABLE', 503, origin);

  const token = randomInvitationToken();
  let prepared: RpcResult<boolean>;
  try {
    prepared = await actor.db.rpc<boolean>('member_password_prepare_self_recovery', {
      p_token_hash: await sha256Hex(token),
    });
  } catch {
    return errorResponse('REVIEW_REQUIRED', 409, origin);
  }
  if (prepared.error || prepared.data !== true) {
    const code = parseErrorCode(prepared.error);
    if (code === 'UNAUTHORIZED') return errorResponse('UNAUTHORIZED', 401, origin);
    return errorResponse('REVIEW_REQUIRED', 409, origin);
  }

  // Deliberately delegate even if the client disconnects after preparation.
  // The enrollment controller owns reservation, Auth mutation, completion, and
  // quarantine; this layer never retries or releases an uncertain claim.
  try {
    const result = await redeem({
      action: 'enroll',
      email,
      token,
      password: parsed.password,
      confirmPassword: parsed.password,
    });
    // Preparation consumed this native session even if a later limiter or
    // service check failed before reservation. Never invite a retry of it.
    return result.ok ? result : errorResponse('REVIEW_REQUIRED', 409, origin);
  } catch {
    return errorResponse('REVIEW_REQUIRED', 409, origin);
  }
}

export async function handleMemberRecoveryAction(
  runtime: RecoveryRuntime,
  body: Record<string, unknown>,
  req: Request,
  origin: string,
  redeem: (body: Record<string, unknown>) => Promise<Response>,
  redirectTo: string,
): Promise<Response> {
  if (body.action === 'request_recovery') {
    return requestRecovery(runtime, body, origin, redirectTo);
  }
  if (body.action === 'complete_recovery') {
    return completeRecovery(runtime, body, req, origin, redeem);
  }
  return errorResponse('INVALID_INPUT', 400, origin);
}
