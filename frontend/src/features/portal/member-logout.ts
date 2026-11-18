export type MemberLogoutResult = {
  deviceLogout: 'skipped' | 'revoked' | 'failed';
  localSignOut: 'completed' | 'failed';
};

export type MemberLogoutOperations = {
  deviceLogout?: () => Promise<void>;
  localSignOut: () => Promise<unknown>;
  clearMemberState: () => void;
  navigateToLogin: () => void;
  onDeviceLogoutFailure?: (cause: unknown) => void;
  onLocalSignOutFailure?: (cause: unknown) => void;
};

function reportFailure(reporter: ((cause: unknown) => void) | undefined, cause: unknown): void {
  // Error reporting must never prevent local cleanup or the logout redirect.
  try {
    reporter?.(cause);
  } catch {
    // Keep the logout lifecycle authoritative even if a UI reporter fails.
  }
}

/**
 * Finish member logout locally even when either remote operation rejects.
 * Device-token revocation is intentionally reported separately from app cleanup.
 */
export async function logoutMemberWithCleanup({
  deviceLogout,
  localSignOut,
  clearMemberState,
  navigateToLogin,
  onDeviceLogoutFailure,
  onLocalSignOutFailure,
}: MemberLogoutOperations): Promise<MemberLogoutResult> {
  let deviceLogoutStatus: MemberLogoutResult['deviceLogout'] = 'skipped';

  if (deviceLogout) {
    try {
      await deviceLogout();
      deviceLogoutStatus = 'revoked';
    } catch (cause) {
      deviceLogoutStatus = 'failed';
      reportFailure(onDeviceLogoutFailure, cause);
    }
  }

  let localSignOutStatus: MemberLogoutResult['localSignOut'] = 'completed';
  try {
    await localSignOut();
  } catch (cause) {
    localSignOutStatus = 'failed';
    reportFailure(onLocalSignOutFailure, cause);
  } finally {
    try {
      clearMemberState();
    } finally {
      navigateToLogin();
    }
  }

  return {
    deviceLogout: deviceLogoutStatus,
    localSignOut: localSignOutStatus,
  };
}
