import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { memberSupabase } from '../../lib/supabase/member-client';
import { clearDeviceToken, getDeviceToken, useAuthStore } from '../../store/auth';
import { fetchMemberByEmail } from '../members/api';
import { getMemberPasswordAccess } from './member-password-access';
import { memberAuthErrorMessage, normalizeAuthEmail } from './member-password';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { useLocale } from '../../i18n/useLocale';

type GuardState = 'checking' | 'allowed' | 'denied';

type AuthSignal = {
  sequence: number;
  event: string;
  uid: string | null;
};

type CleanupSnapshot = {
  generation: number;
  memberId: number | null;
  memberEmail: string;
  deviceToken: string | null;
  authUid: string | null;
  authUidKnown: boolean;
  authSequence: number;
};

type GuardRenderState = {
  key: string;
  authSequence: number;
  state: GuardState;
};

// A later verification run owns the current member boundary. This remains useful
// after an earlier guard unmounts, before its pending promise rejects.
let latestVerificationGeneration = 0;

function sameMemberOwner(snapshot: CleanupSnapshot): boolean {
  const currentMember = useAuthStore.getState().currentMember;
  const currentMemberId = currentMember?.id ?? null;
  const currentMemberEmail = normalizeAuthEmail(currentMember?.email ?? '');
  return currentMemberId === snapshot.memberId
    && currentMemberEmail === snapshot.memberEmail
    && getDeviceToken() === snapshot.deviceToken;
}

async function readCurrentMemberAuth(): Promise<{ known: boolean; uid: string | null }> {
  try {
    const { data, error } = await memberSupabase.auth.getSession();
    if (error) return { known: false, uid: null };
    return { known: true, uid: data.session?.user?.id ?? null };
  } catch {
    return { known: false, uid: null };
  }
}

/**
 * Clear only member-local state, but never let an old verification clear a
 * newer member login. Local state is cleared before the awaited signOut so an
 * unmount/failure cannot leave the browser looking locally authenticated.
 */
async function cleanupMemberState(snapshot?: CleanupSnapshot, latestAuthSignal?: AuthSignal): Promise<void> {
  if (snapshot) {
    if (snapshot.memberId === null && snapshot.deviceToken === null) return;
    if (snapshot.generation !== latestVerificationGeneration || !sameMemberOwner(snapshot)) return;

    const currentAuth = await readCurrentMemberAuth();
    if (!currentAuth.known || !snapshot.authUidKnown) return;

    // Any auth event after this verification belongs to a newer auth owner.
    // SIGNED_OUT is the one intentional exception: it is the same member
    // session ending, and is safe only when the current session is actually gone.
    if (latestAuthSignal && latestAuthSignal.sequence > snapshot.authSequence) {
      if (!(latestAuthSignal.event === 'SIGNED_OUT' && currentAuth.uid === null)) return;
    }

    if (currentAuth.uid !== snapshot.authUid) {
      if (!(latestAuthSignal?.event === 'SIGNED_OUT' && currentAuth.uid === null && snapshot.authUid !== null)) return;
    }
  }

  clearDeviceToken();
  useAuthStore.getState().logoutMember();
  await memberSupabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}

export function MemberAccessGuard({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const currentMember = useAuthStore((state) => state.currentMember);
  const currentMemberId = currentMember?.id ?? null;
  const currentMemberEmail = normalizeAuthEmail(currentMember?.email ?? '');
  const memberKey = `${currentMemberId ?? 'none'}:${currentMemberEmail}`;
  const authSignalRef = useRef<AuthSignal>({ sequence: 0, event: 'INITIAL', uid: null });
  const [authSignal, setAuthSignal] = useState<AuthSignal>(authSignalRef.current);
  const [guardState, setGuardState] = useState<GuardRenderState>({
    key: '',
    authSequence: -1,
    state: 'checking',
  });

  useEffect(() => {
    let disposed = false;
    const subscriptionResult = memberSupabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      const nextSignal: AuthSignal = {
        sequence: authSignalRef.current.sequence + 1,
        event,
        uid: session?.user?.id ?? null,
      };
      // The callback is deliberately synchronous: Supabase must not be
      // awaited or called again from inside its auth callback.
      authSignalRef.current = nextSignal;
      setAuthSignal(nextSignal);
    });

    return () => {
      disposed = true;
      subscriptionResult.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const generation = ++latestVerificationGeneration;
    const snapshot: CleanupSnapshot = {
      generation,
      memberId: currentMemberId,
      memberEmail: currentMemberEmail,
      deviceToken: getDeviceToken(),
      authUid: null,
      authUidKnown: false,
      authSequence: authSignal.sequence,
    };

    setGuardState({ key: memberKey, authSequence: authSignal.sequence, state: 'checking' });

    const verify = async () => {
      try {
        const initialAuth = await readCurrentMemberAuth();
        snapshot.authUid = initialAuth.uid;
        snapshot.authUidKnown = initialAuth.known;

        const { data, error } = await memberSupabase.auth.getUser();
        const user = data.user;
        const authEmail = normalizeAuthEmail(user?.email ?? '');
        if (
          error
          || !user?.id
          || !authEmail
          || !snapshot.deviceToken
          || !currentMemberId
          || !snapshot.authUidKnown
          || snapshot.authUid !== user.id
        ) throw new Error('INVALID_MEMBER_SESSION');

        const access = await getMemberPasswordAccess();
        if (
          !access
          || !access.active
          || !access.password_ready
          || access.auth_user_id !== user.id
          || normalizeAuthEmail(access.email) !== authEmail
          || access.member_id !== currentMemberId
        ) throw new Error('INVALID_MEMBER_SESSION');

        const boundMember = await fetchMemberByEmail(authEmail, snapshot.deviceToken);
        const boundAuthUserId = boundMember && 'auth_user_id' in boundMember
          ? (boundMember as unknown as { auth_user_id?: unknown }).auth_user_id
          : undefined;
        if (
          !boundMember
          || boundMember.id !== access.member_id
          || normalizeAuthEmail(boundMember.email) !== authEmail
          || boundMember.work_status !== 'active'
          || (boundAuthUserId !== undefined && boundAuthUserId !== user.id)
        ) throw new Error('INVALID_MEMBER_SESSION');

        if (!active || generation !== latestVerificationGeneration) return;
        setGuardState({ key: memberKey, authSequence: authSignal.sequence, state: 'allowed' });
      } catch {
        // Cleanup is intentionally not gated by `active`: known failures must
        // clear member-local state even when the guard already unmounted.
        await cleanupMemberState(snapshot, authSignalRef.current);
        if (!active || generation !== latestVerificationGeneration) return;
        setGuardState({ key: memberKey, authSequence: authSignal.sequence, state: 'denied' });
      }
    };

    void verify();
    return () => {
      active = false;
    };
  }, [authSignal.sequence, currentMemberEmail, currentMemberId, memberKey]);

  // Derive checking synchronously from the stable identity key and auth
  // sequence, so a changed member/auth owner cannot render children for one
  // frame while the effect is being scheduled.
  const visibleState = guardState.key === memberKey && guardState.authSequence === authSignal.sequence
    ? guardState.state
    : 'checking';

  if (visibleState === 'denied') return <Navigate to="/login" replace />;
  if (visibleState === 'checking') {
    return <PhantomLoader message={t('بنتأكد من جلسة العضو وصلاحية الجهاز...', 'Verifying the member session and device access...')} />;
  }
  return <>{children}</>;
}

export function memberAccessErrorMessage(): string {
  return memberAuthErrorMessage('IDENTITY_CONFLICT');
}

export { cleanupMemberState };
