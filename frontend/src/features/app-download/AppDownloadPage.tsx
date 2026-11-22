import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ArrowUpRight, Check, Download, ExternalLink, Loader2, RefreshCw, Share, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useReducedMotion } from '../../components/motion/useReducedMotion';
import { useLocale } from '../../i18n/useLocale';
import { isRunningInNativeApk } from '../../lib/capacitor';
import { Capacitor } from '@capacitor/core';
import { toast } from '../../store/toast';
import {
  IOS_INSTALL_STEPS,
  detectInstallPlatform,
  isIOSDevice,
  isIOSSafari,
  isIOSStandalone,
} from './ios-install';
import type { InstallPlatform } from './ios-install';
import './app-download.css';

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

// المنصة اللي المفروض يظهر لها تنبيه التثبيت: أندرويد (APK) أو iOS (PWA).
// بيرجع null لو الجهاز مش محتاج تنبيه أو التطبيق مفتوح أصلاً كتطبيق مثبّت.
export function resolveAppInstallBannerPlatform(
  pathname: string,
  options: AndroidBrowserOptions = {},
): 'android' | 'ios' | null {
  if (isDownloadBannerBlockedPath(pathname)) return null;
  if (hasAuthCallbackMaterial(options.search, options.hash)) return null;
  if (isAppDownloadBannerEligible(pathname, options)) return 'android';
  const userAgent = options.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const native = options.native ?? isNativePlatform();
  const standalone = options.standalone ?? isStandaloneDisplayMode();
  if (native || standalone) return null;
  return isIOSDevice({ userAgent, standalone }) ? 'ios' : null;
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
  const [platform, setPlatform] = useState<InstallPlatform>(() => {
    if (typeof window !== 'undefined') {
      const requested = new URLSearchParams(window.location.search).get('platform');
      if (requested === 'ios') return 'ios';
      if (requested === 'android') return 'android';
    }
    return detectInstallPlatform();
  });
  const isIOSPlatform = platform === 'ios';

  useEffect(() => {
    mountedRef.current = true;
    setIsAndroid(isAndroidBrowser());
    setPlatform((current) => {
      if (typeof window === 'undefined') return current;
      const requested = new URLSearchParams(window.location.search).get('platform');
      if (requested === 'ios' || requested === 'android') return requested;
      const detected = detectInstallPlatform();
      return detected === 'desktop' ? current : detected;
    });
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
    gsap.from(pageRef.current.querySelectorAll('.download-head, .download-card, .download-foot'), {
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


  return (
    <div ref={pageRef} dir={dir} className="download-workspace">
      <header className="download-head">
        <div className="download-head__copy">
          <p className="download-eyebrow">
            <Smartphone size={14} aria-hidden="true" />
            {isIOSPlatform ? t('تطبيق PHANTOMS / iOS', 'PHANTOMS APP / iOS') : t('تطبيق PHANTOMS / أندرويد', 'PHANTOMS APP / ANDROID')}
          </p>
          <h1 className="download-title">
            {isIOSPlatform
              ? t('ثبّت PHANTOMS على iPhone و iPad', 'Install PHANTOMS on iPhone and iPad')
              : t('تطبيق PHANTOMS على أندرويد', 'PHANTOMS for Android')}
          </h1>
          <p className="download-subtitle">
            {isIOSPlatform
              ? t('مفيش ملف APK لنظام iOS. التثبيت بيتم من Safari في 3 خطوات، وبعدها التطبيق يفتح من شاشتك الرئيسية زي أي تطبيق تاني — بنفس حسابك وبياناتك.', 'There is no APK for iOS. Installation happens from Safari in three steps, then the app opens from your home screen like any other app — same account, same data.')
              : t('نزّل أحدث ملف APK الرسمي لأجهزة أندرويد. التثبيت يتم يدوياً على جهازك، ولا يتم تثبيت أي شيء من داخل المتصفح.', 'Download the latest official APK for Android. Installation is completed manually on your device; the browser never installs anything for you.')}
          </p>
        </div>
        <div className="download-tabs" role="tablist" aria-label={t('اختار نظام جهازك', 'Choose your platform')}>
          <button
            type="button"
            role="tab"
            aria-selected={!isIOSPlatform}
            onClick={() => setPlatform('android')}
            className={`download-tab${!isIOSPlatform ? ' is-active' : ''}`}
          >
            <Download size={15} aria-hidden="true" />
            {t('أندرويد', 'Android')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isIOSPlatform}
            onClick={() => setPlatform('ios')}
            className={`download-tab${isIOSPlatform ? ' is-active' : ''}`}
          >
            <Share size={15} aria-hidden="true" />
            {t('آيفون / آيباد', 'iPhone / iPad')}
          </button>
        </div>
      </header>

      <div className="download-grid">
        <section className="download-card download-card--action" aria-label={t('التنزيل', 'Download')}>
          {isIOSPlatform ? (
            <>
              <h2 className="download-card__title">{t('تثبيت من Safari', 'Install from Safari')}</h2>
              <p className="download-card__body">
                {isIOSSafari()
                  ? t('أنت فاتح من Safari — تقدر تثبّت دلوقتي من زر المشاركة.', 'You are in Safari — install right now from the Share button.')
                  : t('لو فاتح من Chrome أو متصفح تاني على iOS، انسخ الرابط وافتحه في Safari الأول.', 'If you are in Chrome or another browser on iOS, copy this link and open it in Safari first.')}
              </p>
              <a href="#ios-install-steps" className="download-cta">
                <Share size={18} aria-hidden="true" />
                {t('خطوات التثبيت على iOS', 'iOS installation steps')}
              </a>
              {isIOSStandalone() && (
                <p className="download-note download-note--ok">
                  <Check size={16} aria-hidden="true" />
                  {t('التطبيق مثبّت على جهازك بالفعل.', 'The app is already installed on this device.')}
                </p>
              )}
            </>
          ) : (
            <>
              <h2 className="download-card__title">{t('ملف APK الرسمي', 'Official APK')}</h2>
              <p className="download-card__body">
                {isAndroid
                  ? t('متاح لمتصفح أندرويد. لا يوجد APK لنظام iOS.', 'Available for Android browsers. There is no iOS APK.')
                  : t('هذا الملف لأجهزة أندرويد. أصحاب iPhone و iPad يفتحون تبويب iOS بالأعلى للتثبيت من Safari.', 'This package is for Android. iPhone and iPad users can switch to the iOS tab above to install from Safari.')}
              </p>
              <button
                type="button"
                data-testid="download-apk"
                onClick={needsDirectDownload ? onDirectDownload : onDownloadClick}
                disabled={isDownloading || isNativePlatform()}
                aria-busy={isDownloading || undefined}
                className="download-cta"
              >
                {isDownloading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
                {isDownloading
                  ? progress === null ? t('جارٍ التحضير…', 'Preparing…') : t(`جارٍ التنزيل ${progress}%`, `Downloading ${progress}%`)
                  : isNativePlatform() ? t('أنت داخل التطبيق', 'You are already in the app') : needsDirectDownload ? t('التنزيل المباشر', 'Direct download') : t('تنزيل ملف APK', 'Download APK')}
              </button>
              {isDownloading && (
                <div className="download-progress" aria-live="polite">
                  <div
                    role="progressbar"
                    aria-label={t('تقدم تنزيل ملف APK', 'APK download progress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress ?? undefined}
                    aria-valuetext={progress === null ? t('جارٍ القياس', 'Measuring') : `${progress}%`}
                  >
                    <span className={progress === null ? 'is-indeterminate' : undefined} style={progress === null ? undefined : { width: `${progress}%` }} />
                  </div>
                  <p className="download-progress__hint">
                    {progress === null
                      ? t('يتم تجهيز التنزيل. قد يظهر شريط غير محدد إذا لم يرسل الخادم حجم الملف.', 'Preparing the download. The bar stays indeterminate when the server does not expose a file size.')
                      : t('التقدم مبني على البايتات المقروءة فعلياً.', 'Progress is based on bytes actually read.')}
                  </p>
                </div>
              )}
              <div className="download-actions">
                {isDownloading && (
                  <button type="button" onClick={cancelDownload} className="download-ghost-btn">
                    <X size={17} aria-hidden="true" />
                    {t('إلغاء', 'Cancel')}
                  </button>
                )}
                <a href={APK_RELEASE_URL} target="_blank" rel="noreferrer" className="download-link">
                  {t('فتح أحدث إصدار', 'Open latest release')}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
              {needsDirectDownload && (
                <p className="download-note">
                  {t('اضغط التنزيل المباشر ليفتح المتصفح الملف الرسمي. تابِع التقدم من إشعارات جهازك؛ لا نعلن اكتماله هنا.', 'Press Direct download to open the official file in your browser. Follow progress in your device notifications; completion is not reported here.')}
                </p>
              )}
            </>
          )}
        </section>

        <section className="download-card" aria-label={t('معلومات التثبيت', 'Installation details')}>
          <div className="download-card__head">
            <h2 className="download-card__title">{isIOSPlatform ? t('تثبيت من Safari', 'Install from Safari') : t('تثبيت يدوي واضح', 'Manual install, clearly explained')}</h2>
            <ShieldCheck size={22} className="download-card__badge" aria-hidden="true" />
          </div>
          <ol id="ios-install-steps" className="download-steps">
            {(isIOSPlatform
              ? IOS_INSTALL_STEPS.map((step) => ({ title: t(step.title.ar, step.title.en), body: t(step.body.ar, step.body.en) }))
              : [
                { title: t('ابدأ التنزيل من الزر المجاور.', 'Start the download with the button beside this card.'), body: '' },
                { title: t('افتح الملف من إشعار المتصفح أو مجلد التنزيلات.', 'Open the file from the browser notification or Downloads.'), body: '' },
                { title: t('اتبع شاشة أندرويد لإكمال التثبيت يدوياً.', 'Follow Android’s screen to complete the manual install.'), body: '' },
              ]
            ).map((step, index) => (
              <li key={step.title}>
                <span className="download-step__index">{index + 1}</span>
                <span>
                  {step.title}
                  {step.body ? <span className="download-step__body">{step.body}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="download-card" aria-label={t('التحديث والصيانة', 'Updates and upkeep')}>
          <h2 className="download-card__title">{t('التحديثات', 'Updates')}</h2>
          <div className="download-facts">
            <div className="download-fact" data-testid="auto-update-note">
              <RefreshCw size={16} aria-hidden="true" />
              <p>
                {t(
                  'من نسخة 1.2.0 التطبيق بيحمّل آخر نسخة من السيرفر كل مرة تفتحه — مش هتحتاج تنزّل الـ APK تاني. لو فيه تحديث مهم هيظهرلك زر «تحديث الآن» جوه التطبيق.',
                  'From version 1.2.0 the app loads the latest build from the server every time it opens — no more re-downloading the APK. When a critical update ships, an in-app “Update now” button appears.'
                )}
              </p>
            </div>
            <div className="download-fact">
              <ShieldCheck size={16} aria-hidden="true" />
              <p>
                {isIOSPlatform
                  ? t('التطبيق بيفضل محدّث تلقائياً من نفس الرابط، وبياناتك وجلسة الدخول بتتحفظ على جهازك.', 'The app stays up to date from the same link, and your session is kept on your device.')
                  : t('الملف رسمي من إصدار PHANTOMS على GitHub، والمتصفح هو اللي بيعالجه — مش بنسجّل نقرة التنزيل كتثبيت ناجح.', 'The file comes from the official PHANTOMS release on GitHub and is handled by your browser — a download click is never recorded as a successful install.')}
              </p>
            </div>
            <div className="download-fact">
              <Download size={16} aria-hidden="true" />
              <p>{t('نقيس البايتات فقط عندما يسمح الخادم بذلك، عشان شريط التقدم يبقى صادق.', 'Bytes are measured only when the server permits it, so the progress bar stays honest.')}</p>
            </div>
          </div>
        </section>
      </div>

      <footer className="download-foot">
        <span>{t('تحتاج إلى المتابعة الآن؟', 'Need to continue right now?')}</span>
        <Link to="/login" className="download-link">
          {t('المتابعة من المتصفح', 'Continue in browser')}
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
