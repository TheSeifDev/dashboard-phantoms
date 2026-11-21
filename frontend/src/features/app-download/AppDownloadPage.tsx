import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ArrowUpRight, Check, Download, ExternalLink, Loader2, ShieldCheck, Smartphone, X } from 'lucide-react';
import { BrandLockup } from '../../components/brand/BrandLockup';
import { useReducedMotion } from '../../components/motion/useReducedMotion';
import { useLocale } from '../../i18n/useLocale';
import { isRunningInNativeApk } from '../../lib/capacitor';
import { Capacitor } from '@capacitor/core';
import { toast } from '../../store/toast';

export const APK_DOWNLOAD_URL = 'https://github.com/TheSeifDev/dashboard-phantoms/releases/download/latest-apk/phantoms-app.apk';
export const APK_RELEASE_URL = 'https://github.com/TheSeifDev/dashboard-phantoms/releases/tag/latest-apk';
export const APK_MEMORY_CAP_BYTES = 50 * 1024 * 1024;
export const APP_DOWNLOAD_BANNER_DISMISSAL_KEY = 'phantoms_app_download_banner_dismissed_at';
export const APP_DOWNLOAD_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type DownloadToastKind = 'loading' | 'success' | 'error' | 'info' | 'warning';
type DownloadToastApi = {
  loading?: (message: string, options?: { task?: string; progress?: number | null }) => number;
  update?: (id: number, options: { kind: DownloadToastKind; progress: number | null; message: string; durationMs?: number }) => void;
  dismiss?: (id: number) => void;
  info: (message: string, options?: { durationMs?: number }) => void;
};

const downloadToast = toast as unknown as DownloadToastApi;

export interface AndroidBrowserOptions {
  userAgent?: string;
  native?: boolean;
  standalone?: boolean;
  search?: string;
  hash?: string;
}

/** Android browsers are the only supported installation surface for this APK. */
export function isAndroidBrowser(options: AndroidBrowserOptions = {}): boolean {
  const userAgent = options.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const native = options.native ?? isNativePlatform();
  const standalone = options.standalone ?? isStandaloneDisplayMode();
  return /Android/i.test(userAgent) && !native && !standalone;
}

/** Capacitor can report a non-web platform even when its native flag is unavailable. */
export function isNativePlatform(): boolean {
  try {
    return isRunningInNativeApk() || Capacitor.getPlatform() !== 'web';
  } catch {
    return false;
  }
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    return navigatorWithStandalone.standalone === true
      || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

export const APP_DOWNLOAD_BANNER_BLOCKED_PATHS = [
  '/download',
  '/recovery',
  '/reset',
  '/reset-password',
  '/join',
  '/forgot-password',
  '/admin/forgot-password',
  '/admin/recovery',
  '/admin/set-password',
  '/member',
];

export function isDownloadBannerBlockedPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return APP_DOWNLOAD_BANNER_BLOCKED_PATHS.some((path) => normalized === path || normalized.startsWith(`${path}/`));
}

export function hasAuthCallbackMaterial(search = '', hash = ''): boolean {
  return /(?:^|[?#&])(code|access_token|refresh_token|token_hash|type|error|error_code)=/i.test(`${search}${hash}`);
}

export function isAppDownloadBannerEligible(
  pathname: string,
  options: AndroidBrowserOptions = {},
): boolean {
  return !isDownloadBannerBlockedPath(pathname)
    && !hasAuthCallbackMaterial(options.search, options.hash)
    && isAndroidBrowser(options);
}

export function isBannerDismissedWithinCooldown(rawValue: string | null, now = Date.now()): boolean {
  if (!rawValue) return false;
  const dismissedAt = Number(rawValue);
  if (!Number.isFinite(dismissedAt) || dismissedAt < 0 || dismissedAt > now) return false;
  return now - dismissedAt < APP_DOWNLOAD_BANNER_COOLDOWN_MS;
}

export function readAppDownloadBannerDismissal(storage: Storage | null | undefined, now = Date.now()): boolean {
  try {
    return isBannerDismissedWithinCooldown(storage?.getItem(APP_DOWNLOAD_BANNER_DISMISSAL_KEY) ?? null, now);
  } catch {
    return false;
  }
}

export function dismissAppDownloadBanner(storage: Storage | null | undefined, now = Date.now()): boolean {
  try {
    storage?.setItem(APP_DOWNLOAD_BANNER_DISMISSAL_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function parseContentLength(rawValue: string | null): number | null {
  if (!rawValue || !/^\d+$/.test(rawValue.trim())) return null;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Keep a determinate bar at 99 until the reader has actually reported done. */
export function calculateDownloadProgress(loaded: number, total: number | null, done = false): number | null {
  if (total === null) return null;
  if (done) return 100;
  if (loaded <= 0) return 0;
  return Math.min(99, Math.max(0, Math.floor((loaded / total) * 100)));
}

function announceLoading(message: string): number | null {
  if (typeof downloadToast.loading === 'function') {
    return downloadToast.loading(message, { task: 'download', progress: null });
  }
  downloadToast.info(message, { durationMs: 0 });
  return null;
}

function announceUpdate(id: number | null, options: { kind: DownloadToastKind; progress: number | null; message: string; durationMs?: number }): void {
  if (id !== null && typeof downloadToast.update === 'function') {
    downloadToast.update(id, options);
  }
}

function dismissAnnouncement(id: number | null): void {
  if (id !== null && typeof downloadToast.dismiss === 'function') downloadToast.dismiss(id);
}

function triggerDirectBrowserDownload(): void {
  const anchor = document.createElement('a');
  anchor.href = APK_DOWNLOAD_URL;
  anchor.download = 'phantoms-app.apk';
  anchor.rel = 'noopener';
  anchor.click();
}

function revokeObjectUrl(url: string | null): void {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

export default function AppDownloadPage() {
  const { dir, t } = useLocale();
  const prefersReducedMotion = useReducedMotion();
  const pageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toastIdRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const revokeTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [needsDirectDownload, setNeedsDirectDownload] = useState(false);
  const [isAndroid, setIsAndroid] = useState(() => isAndroidBrowser());

  useEffect(() => {
    mountedRef.current = true;
    setIsAndroid(isAndroidBrowser());
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      dismissAnnouncement(toastIdRef.current);
      toastIdRef.current = null;
      revokeObjectUrl(objectUrlRef.current);
      objectUrlRef.current = null;
      if (revokeTimerRef.current !== null) window.clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = null;
    };
  }, []);

  useGSAP(() => {
    if (prefersReducedMotion || !pageRef.current) return;
    gsap.from(pageRef.current.querySelectorAll('[data-download-reveal]'), {
      y: 12,
      opacity: 0,
      duration: 0.34,
      stagger: 0.055,
      ease: 'power2.out',
      clearProps: 'transform,opacity',
    });
  }, { scope: pageRef, dependencies: [prefersReducedMotion], revertOnUpdate: true });

  const cancelDownload = () => {
    if (!isDownloading) return;
    const activeToastId = toastIdRef.current;
    toastIdRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    dismissAnnouncement(activeToastId);
    setIsDownloading(false);
    setProgress(null);
  };

  const handleDownload = async () => {
    if (abortRef.current || !mountedRef.current || isNativePlatform()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const activeToastId = announceLoading(t('جارٍ تجهيز تنزيل تطبيق PHANTOMS…', 'Preparing the PHANTOMS download…'));
    toastIdRef.current = activeToastId;
    setIsDownloading(true);
    setProgress(null);
    setNeedsDirectDownload(false);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const response = await fetch(APK_DOWNLOAD_URL, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
      if (!response.ok || !response.body) throw new Error('DOWNLOAD_STREAM_UNAVAILABLE');

      const total = parseContentLength(response.headers.get('content-length'));
      if (total !== null && total > APK_MEMORY_CAP_BYTES) throw new Error('DOWNLOAD_TOO_LARGE');
      reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (!mountedRef.current || controller.signal.aborted) return;
        if (done) {
          if (loaded === 0 || (total !== null && loaded !== total)) throw new Error('DOWNLOAD_LENGTH_MISMATCH');
          setProgress(calculateDownloadProgress(loaded, total, true));
          break;
        }
        if (!value) continue;
        loaded += value.byteLength;
        if (loaded > APK_MEMORY_CAP_BYTES) throw new Error('DOWNLOAD_TOO_LARGE');
        chunks.push(value.slice());
        const nextProgress = calculateDownloadProgress(loaded, total);
        if (mountedRef.current) {
          setProgress(nextProgress);
          announceUpdate(activeToastId, {
            kind: 'loading',
            progress: nextProgress,
            message: t('جارٍ تنزيل ملف APK…', 'Downloading the APK…'),
          });
        }
      }

      if (!mountedRef.current) return;
      const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
      revokeObjectUrl(objectUrlRef.current);
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'phantoms-app.apk';
      anchor.rel = 'noopener';
      anchor.click();
      if (revokeTimerRef.current !== null) window.clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = window.setTimeout(() => {
        if (objectUrlRef.current === objectUrl) {
          revokeObjectUrl(objectUrl);
          objectUrlRef.current = null;
        } else {
          revokeObjectUrl(objectUrl);
        }
        revokeTimerRef.current = null;
      }, 60_000);
      announceUpdate(activeToastId, {
        kind: 'success',
        progress: total === null ? null : 100,
        message: t('تم تجهيز ملف APK. افتحه من إشعارات المتصفح لإكمال التثبيت يدوياً.', 'APK download is ready. Open it from your browser notifications to install it manually.'),
        durationMs: 7000,
      });
    } catch {
      if (!mountedRef.current || controller.signal.aborted) return;
      controller.abort();
      setNeedsDirectDownload(true);
      announceUpdate(activeToastId, {
        kind: 'warning',
        progress: null,
        message: t('تعذر قياس التنزيل من المصدر. استخدم زر التنزيل المباشر؛ لم نتحقق من اكتمال الملف أو تثبيته.', 'The source download could not be measured. Use direct download; file completion and installation are not verified.'),
        durationMs: 7000,
      });
    } finally {
      if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (mountedRef.current && abortRef.current === controller) {
        abortRef.current = null;
        toastIdRef.current = null;
        setIsDownloading(false);
        setProgress(null);
      }
    }
  };

  const onDownloadClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void handleDownload();
  };

  const onDirectDownload = () => {
    triggerDirectBrowserDownload();
    downloadToast.info(t('تم تمرير رابط APK إلى المتصفح؛ تقدم التنزيل والتثبيت غير قابلين للقياس هنا.', 'The APK link was handed to your browser; download progress and installation cannot be measured here.'));
  };

  const featureCards = [
    { Icon: ShieldCheck, title: t('ملف رسمي', 'Official file'), body: t('الرابط يقود إلى إصدار PHANTOMS المنشور على GitHub.', 'The link points to the PHANTOMS release published on GitHub.') },
    { Icon: Download, title: t('تقدم صادق', 'Honest progress'), body: t('نقيس البايتات فقط عندما يسمح الخادم بذلك.', 'Bytes are measured only when the server permits it.') },
    { Icon: Smartphone, title: t('أندرويد فقط', 'Android only'), body: t('لا يوجد APK لنظام iOS؛ استخدم تسجيل الدخول من المتصفح.', 'There is no iOS APK; continue with browser sign-in.') },
  ];

  return (
    <div ref={pageRef} dir={dir} className="min-h-[100dvh] overflow-hidden bg-[var(--bg)] px-4 pb-12 pt-5 text-[var(--text)] sm:px-6 sm:pt-8">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8">
        <header data-download-reveal className="flex items-center justify-between gap-4">
          <BrandLockup layout="horizontal" size="sm" themeMode="auto" />
          <Link to="/login" className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-[var(--border)] px-3.5 text-xs font-black text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]">
            {t('تسجيل الدخول', 'Sign in')}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </header>

        <section data-download-reveal className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-xl)] sm:p-8 lg:p-12">
          <div className="pointer-events-none absolute -end-20 -top-24 size-64 rounded-full bg-[var(--crimson)]/10 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-24 -start-16 size-64 rounded-full bg-[var(--emerald)]/10 blur-3xl" aria-hidden="true" />
          <div className="relative grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:gap-12">
            <div className="max-w-2xl">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <Smartphone size={14} className="text-[var(--emerald)]" aria-hidden="true" />
                {t('تطبيق PHANTOMS / أندرويد', 'PHANTOMS APP / ANDROID')}
              </p>
              <h1 className="max-w-xl text-3xl font-black leading-[1.08] tracking-tight text-[var(--text)] sm:text-5xl">
                {t('مساحة PHANTOMS معك أينما تعمل.', 'PHANTOMS, in your pocket when the work moves.')}
              </h1>
              <p className="mt-5 max-w-xl text-sm font-semibold leading-7 text-[var(--text-muted)] sm:text-base">
                {t('نزّل أحدث ملف APK الرسمي لأجهزة أندرويد. التثبيت يتم يدوياً على جهازك، ولا يتم تثبيت أي شيء من داخل المتصفح.', 'Download the latest official APK for Android. Installation is completed manually on your device; the browser never installs anything for you.')}
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button type="button" onClick={needsDirectDownload ? onDirectDownload : onDownloadClick} disabled={isDownloading || isNativePlatform()} aria-busy={isDownloading || undefined} className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-[var(--crimson)] px-5 text-sm font-black text-white shadow-[0_10px_30px_rgba(220,20,60,.2)] transition-[transform,background-color] hover:bg-[var(--primary-hover)] hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0">
                  {isDownloading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
                  {isDownloading
                    ? progress === null ? t('جارٍ التحضير…', 'Preparing…') : t(`جارٍ التنزيل ${progress}%`, `Downloading ${progress}%`)
                    : isNativePlatform() ? t('أنت داخل التطبيق', 'You are already in the app') : needsDirectDownload ? t('التنزيل المباشر', 'Direct download') : t('تنزيل ملف APK', 'Download APK')}
                </button>
                {isDownloading && (
                  <button type="button" onClick={cancelDownload} className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl border border-[var(--border)] px-5 text-sm font-black text-[var(--text-2)] hover:bg-[var(--surface-2)]">
                    <X size={17} aria-hidden="true" />
                    {t('إلغاء', 'Cancel')}
                  </button>
                )}
                <a href={APK_RELEASE_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center justify-center gap-1 px-2 text-xs font-black text-[var(--link)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--link-hover)]">
                  {t('فتح أحدث إصدار', 'Open latest release')}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
              {isDownloading && (
                <div className="mt-4" aria-live="polite">
                  <div
                    role="progressbar"
                    aria-label={t('تقدم تنزيل ملف APK', 'APK download progress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress ?? undefined}
                    aria-valuetext={progress === null ? t('جارٍ القياس', 'Measuring') : `${progress}%`}
                    className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
                  >
                    <div
                      className={`h-full rounded-full bg-[var(--emerald)] transition-[width] duration-200 ${progress === null ? 'w-[42%] animate-pulse' : ''}`}
                      style={progress === null ? undefined : { width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs font-semibold leading-5 text-[var(--text-muted)]" role="status" aria-live="polite">
                {isDownloading
                  ? progress === null ? t('يتم تجهيز التنزيل. قد يظهر شريط غير محدد إذا لم يرسل الخادم حجم الملف.', 'Preparing the download. The bar stays indeterminate when the server does not expose a file size.') : t('التقدم مبني على البايتات المقروءة فعلياً.', 'Progress is based on bytes actually read.')
                  : isAndroid ? t('متاح لمتصفح أندرويد. لا يوجد APK لنظام iOS.', 'Available for Android browsers. There is no iOS APK.') : t('هذا الملف لأجهزة أندرويد فقط. افتح الصفحة على جهاز أندرويد للتثبيت.', 'This package is for Android only. Open this page on an Android device to install it.')}
              </p>
              {needsDirectDownload && <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{t('اضغط التنزيل المباشر ليفتح المتصفح الملف الرسمي. تابِع التقدم من إشعارات جهازك؛ لا نعلن اكتماله هنا.', 'Press Direct download to open the official file in your browser. Follow progress in your device notifications; completion is not reported here.')}</p>}
            </div>

            <aside className="rounded-3xl border border-[var(--border)] bg-[var(--graphite-950)] p-5 text-[var(--editorial-white)] shadow-[var(--shadow-lg)] sm:p-6" aria-label={t('معلومات التثبيت', 'Installation details')}>
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--soft-grey)]">PHANTOMS APK</p>
                  <p className="mt-1 text-xl font-black">{t('تثبيت يدوي واضح', 'Manual install, clearly explained')}</p>
                </div>
                <ShieldCheck size={24} className="shrink-0 text-[var(--emerald)]" aria-hidden="true" />
              </div>
              <ol className="grid gap-4 text-sm font-semibold leading-6 text-[var(--soft-grey)]">
                <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--crimson)] text-xs font-black text-white">1</span><span>{t('ابدأ التنزيل من الزر أعلاه.', 'Start the download with the button above.')}</span></li>
                <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--crimson)] text-xs font-black text-white">2</span><span>{t('افتح الملف من إشعار المتصفح أو مجلد التنزيلات.', 'Open the file from the browser notification or Downloads.')}</span></li>
                <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--crimson)] text-xs font-black text-white">3</span><span>{t('اتبع شاشة أندرويد لإكمال التثبيت يدوياً.', 'Follow Android’s screen to complete the manual install.')}</span></li>
              </ol>
              <div className="mt-6 flex items-start gap-2 border-t border-white/10 pt-4 text-xs font-semibold leading-5 text-[var(--soft-grey)]">
                <Check size={16} className="mt-0.5 shrink-0 text-[var(--emerald)]" aria-hidden="true" />
                <span>{t('المتصفح يعالج الملف؛ لا نسجّل نقرة التنزيل كتثبيت ناجح.', 'The browser handles the file; a download click is never recorded as a successful install.')}</span>
              </div>
            </aside>
          </div>
        </section>

        <section data-download-reveal className="grid gap-4 sm:grid-cols-3">
          {featureCards.map(({ Icon, title, body }) => (
            <article key={String(title)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
              <Icon size={19} className="mb-3 text-[var(--emerald)]" aria-hidden="true" />
              <h2 className="text-sm font-black">{title}</h2>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">{body}</p>
            </article>
          ))}
        </section>

        <footer data-download-reveal className="flex flex-col items-center justify-between gap-3 border-t border-[var(--border)] pt-5 text-center text-xs font-semibold text-[var(--text-muted)] sm:flex-row sm:text-start">
          <span>{t('تحتاج إلى المتابعة الآن؟', 'Need to continue right now?')}</span>
          <Link to="/login" className="inline-flex min-h-[44px] items-center gap-1 font-black text-[var(--link)] underline underline-offset-4 hover:text-[var(--link-hover)]">
            {t('المتابعة من المتصفح', 'Continue in browser')}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </footer>
      </main>
    </div>
  );
}
