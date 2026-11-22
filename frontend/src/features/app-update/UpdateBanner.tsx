import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  LOCAL_BUILD_ID,
  LOCAL_BUILT_AT,
  UPDATE_BANNER_COPY,
  formatBuiltAt,
  isNewerBuild,
  parseRemoteBuildInfo,
  type RemoteBuildInfo,
} from './app-version';
import './app-update.css';

const VERSION_ENDPOINT = '/version.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DISMISS_KEY = 'phantoms_update_dismissed';

function readDismissed(): string {
  try {
    return sessionStorage.getItem(DISMISS_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDismissed(buildId: string) {
  try {
    sessionStorage.setItem(DISMISS_KEY, buildId);
  } catch {
    /* private mode — نتجاهل */
  }
}

async function fetchRemoteBuild(signal: AbortSignal): Promise<RemoteBuildInfo | null> {
  const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return null;
  return parseRemoteBuildInfo(await response.json());
}

export function UpdateBanner() {
  const [remote, setRemote] = useState<RemoteBuildInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dismissedRef = useRef<string>('');
  const checkingRef = useRef(false);

  useEffect(() => {
    dismissedRef.current = readDismissed();
  }, []);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const info = await fetchRemoteBuild(controller.signal);
      if (!info) return;
      if (!isNewerBuild(LOCAL_BUILD_ID, info.buildId)) {
        setRemote(null);
        return;
      }
      if (info.buildId === dismissedRef.current) return;
      setRemote(info);
    } catch {
      /* مفيش نت أو الـ endpoint مش موجود — نسيب الحالة زي ما هي */
    } finally {
      window.clearTimeout(timer);
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [check]);

  if (!remote) return null;

  const builtAtLabel = formatBuiltAt(remote.builtAt);

  const applyUpdate = () => {
    setRefreshing(true);
    try {
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => void registration.update());
        });
      }
    } catch {
      /* مش مشكلة */
    }
    window.setTimeout(() => window.location.reload(), 250);
  };

  const dismiss = () => {
    dismissedRef.current = remote.buildId;
    writeDismissed(remote.buildId);
    setRemote(null);
  };

  return (
    <div className="app-update" role="status" aria-live="polite" data-testid="app-update-banner">
      <span className="app-update__icon" aria-hidden="true">
        <RefreshCw size={18} />
      </span>
      <div className="app-update__text">
        <p className="app-update__title">{UPDATE_BANNER_COPY.title}</p>
        <p className="app-update__body">
          {UPDATE_BANNER_COPY.body}
          {builtAtLabel ? <span className="app-update__stamp"> · {builtAtLabel}</span> : null}
        </p>
      </div>
      <div className="app-update__actions">
        <button
          type="button"
          className="app-update__cta"
          onClick={applyUpdate}
          disabled={refreshing}
          data-testid="app-update-now"
        >
          {refreshing ? UPDATE_BANNER_COPY.refreshing : UPDATE_BANNER_COPY.action}
        </button>
        <button
          type="button"
          className="app-update__dismiss"
          onClick={dismiss}
          aria-label={UPDATE_BANNER_COPY.later}
          title={UPDATE_BANNER_COPY.later}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export const CURRENT_BUILD = { buildId: LOCAL_BUILD_ID, builtAt: LOCAL_BUILT_AT };
