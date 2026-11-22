// =====================================================
// دعم iOS: كشف الجهاز وخطوات التثبيت من Safari
// =====================================================
// مفيش APK لـ iOS، فالتثبيت بيتم كـ PWA من Safari:
// "مشاركة" → "إضافة إلى الشاشة الرئيسية".
// =====================================================

export type InstallPlatform = 'android' | 'ios' | 'desktop';

export interface IOSDetectionOptions {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  native?: boolean;
}

const IOS_UA_RE = /iPad|iPhone|iPod/;
const IOS_NON_SAFARI_RE = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|YaBrowser|GSA\//;

function readUserAgent(options: IOSDetectionOptions): string {
  if (typeof options.userAgent === 'string') return options.userAgent;
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent;
}

function readPlatform(options: IOSDetectionOptions): string {
  if (typeof options.platform === 'string') return options.platform;
  if (typeof navigator === 'undefined') return '';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform ?? navigator.platform ?? '';
}

function readMaxTouchPoints(options: IOSDetectionOptions): number {
  if (typeof options.maxTouchPoints === 'number') return options.maxTouchPoints;
  if (typeof navigator === 'undefined') return 0;
  return navigator.maxTouchPoints ?? 0;
}

/**
 * يكشف أجهزة iPhone/iPad — بما فيها iPadOS 13+ اللي بيقدّم نفسه كـ Mac.
 */
export function isIOSDevice(options: IOSDetectionOptions = {}): boolean {
  const userAgent = readUserAgent(options);
  if (IOS_UA_RE.test(userAgent)) return true;
  const platform = readPlatform(options);
  return /Mac/i.test(platform) && readMaxTouchPoints(options) > 1 && /Safari/i.test(userAgent);
}

/**
 * هل المتصفح هو Safari الحقيقي؟ التثبيت على iOS مسموح من Safari بس
 * (وفي iOS 17.4+ كمان من متصفحات تانية، لكن Safari هو المسار المضمون).
 */
export function isIOSSafari(options: IOSDetectionOptions = {}): boolean {
  if (!isIOSDevice(options)) return false;
  const userAgent = readUserAgent(options);
  if (IOS_NON_SAFARI_RE.test(userAgent)) return false;
  return /Safari/i.test(userAgent) || /AppleWebKit/i.test(userAgent);
}

/** هل التطبيق مفتوح أصلاً من الشاشة الرئيسية (standalone)؟ */
export function isIOSStandalone(options: IOSDetectionOptions = {}): boolean {
  if (options.standalone !== undefined) return options.standalone;
  if (typeof window === 'undefined') return false;
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

export interface InstallStep {
  title: { ar: string; en: string };
  body: { ar: string; en: string };
}

/** خطوات التثبيت على iOS — نصوص ثابتة قابلة للاختبار. */
export const IOS_INSTALL_STEPS: InstallStep[] = [
  {
    title: { ar: 'افتح الصفحة في Safari', en: 'Open this page in Safari' },
    body: {
      ar: 'التثبيت على iPhone و iPad بيتم من Safari. لو فاتح من Chrome أو أي متصفح تاني، انسخ الرابط وافتحه في Safari.',
      en: 'Installing on iPhone and iPad happens from Safari. If you are in Chrome or another browser, copy the link and open it in Safari.',
    },
  },
  {
    title: { ar: 'اضغط زر المشاركة', en: 'Tap the Share button' },
    body: {
      ar: 'زر المشاركة هو المربع اللي فيه سهم طالع لفوق، موجود في شريط Safari تحت (أو جنب العنوان على iPad).',
      en: 'The Share button is the square with an arrow pointing up, in the Safari toolbar at the bottom (or beside the address bar on iPad).',
    },
  },
  {
    title: { ar: 'إضافة إلى الشاشة الرئيسية', en: 'Add to Home Screen' },
    body: {
      ar: 'اختار «إضافة إلى الشاشة الرئيسية» ثم «إضافة». هتلاقي أيقونة PHANTOMS على شاشتك وتفتح زي أي تطبيق.',
      en: 'Choose “Add to Home Screen”, then “Add”. The PHANTOMS icon appears on your home screen and opens like a native app.',
    },
  },
];

/** منصة التثبيت المناسبة للجهاز الحالي. */
export function detectInstallPlatform(options: IOSDetectionOptions & { androidUserAgent?: string } = {}): InstallPlatform {
  if (options.native) return 'desktop';
  if (isIOSDevice(options)) return 'ios';
  const userAgent = options.androidUserAgent ?? readUserAgent(options);
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}
