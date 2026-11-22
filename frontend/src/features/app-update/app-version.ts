export const APK_DOWNLOAD_URL =
  'https://github.com/TheSeifDev/dashboard-phantoms/releases/download/latest-apk/phantoms-app.apk';

export const APK_RELEASE_URL = 'https://github.com/TheSeifDev/dashboard-phantoms/releases/tag/latest-apk';

/** نسخة الواجهة المبنية جوه التطبيق/المتصفح دلوقتي. */
export const LOCAL_BUILD_ID: string =
  typeof __PHANTOMS_BUILD_ID__ === 'string' && __PHANTOMS_BUILD_ID__.trim()
    ? __PHANTOMS_BUILD_ID__.trim()
    : 'dev';

export const LOCAL_BUILT_AT: string =
  typeof __PHANTOMS_BUILT_AT__ === 'string' ? __PHANTOMS_BUILT_AT__ : '';

export type RemoteBuildInfo = {
  buildId: string;
  builtAt: string;
};

const DEV_BUILD_PREFIXES = ['dev', 'local-'];

function isDevBuild(buildId: string): boolean {
  const value = buildId.trim().toLowerCase();
  return value === '' || DEV_BUILD_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** بيقرأ version.json اللي بيتولد مع كل build. بيرجع null لو الشكل مش سليم. */
export function parseRemoteBuildInfo(payload: unknown): RemoteBuildInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const buildId = typeof record.buildId === 'string' ? record.buildId.trim() : '';
  if (!buildId) return null;
  const builtAt = typeof record.builtAt === 'string' ? record.builtAt.trim() : '';
  return { buildId, builtAt };
}

/**
 * هل في نسخة أحدث على السيرفر؟
 * بنتجاهل نسخ التطوير عشان مانزعجش المطوّرين ببانر وهمي.
 */
export function isNewerBuild(localBuildId: string, remoteBuildId: string): boolean {
  if (!remoteBuildId || !remoteBuildId.trim()) return false;
  if (isDevBuild(localBuildId)) return false;
  return localBuildId.trim() !== remoteBuildId.trim();
}

export function formatBuiltAt(builtAt: string): string {
  if (!builtAt) return '';
  const date = new Date(builtAt);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Africa/Cairo',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export const UPDATE_BANNER_COPY = {
  title: 'فيه نسخة جديدة من PHANTOMS',
  body: 'حدّث دلوقتي عشان تاخد آخر إصلاحات تسجيل الدخول من غير ما تنزّل التطبيق تاني.',
  action: 'تحديث الآن',
  later: 'بعدين',
  refreshing: 'بنحدّث…',
} as const;
