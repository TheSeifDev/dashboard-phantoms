import { format, formatDistance, isValid, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';

/**
 * تنسيق التاريخ بالعربية
 * @param dateString - تاريخ ISO أو string
 * @param formatStr - صيغة التنسيق (افتراضي: dd MMMM yyyy)
 */
export function formatDate(dateString: string | null | undefined, formatStr = 'd MMMM yyyy'): string {
  if (!dateString) return '—';
  
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
    if (!isValid(date)) return dateString;
    
    return format(date, formatStr, { locale: ar });
  } catch {
    return dateString;
  }
}

/**
 * تنسيق التاريخ والوقت بالعربية
 */
export function formatDateTime(dateString: string | null | undefined): string {
  return formatDate(dateString, 'd MMMM yyyy، h:mm a');
}

/**
 * المسافة الزمنية النسبية (منذ 3 أيام، قبل ساعتين...)
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
    if (!isValid(date)) return dateString;
    
    return formatDistance(date, new Date(), { 
      locale: ar, 
      addSuffix: true 
    });
  } catch {
    return dateString;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * يحوّل موعداً نهائياً إلى لحظة زمنية.
 * التاريخ بدون وقت (YYYY-MM-DD — صيغة عمود deadline_date) يعني نهاية ذلك اليوم
 * بالتوقيت المحلي، وليس منتصف ليلته — وإلا ظهرت مهمة "اليوم" كمتأخرة من الصباح.
 */
export function parseDeadline(deadlineString: string | null | undefined): Date | null {
  if (!deadlineString) return null;
  try {
    if (DATE_ONLY.test(deadlineString)) {
      const [y, m, d] = deadlineString.split('-').map(Number);
      const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
      return isValid(endOfDay) ? endOfDay : null;
    }
    const parsed = parseISO(deadlineString);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * تحقق من انتهاء الموعد
 */
export function isOverdue(deadlineString: string | null | undefined): boolean {
  const deadline = parseDeadline(deadlineString);
  return deadline ? deadline.getTime() < Date.now() : false;
}

/**
 * عدد الأيام التقويمية المتبقية: 0 = اليوم، 1 = غداً، سالب = متأخر.
 */
export function daysRemaining(deadlineString: string | null | undefined): number | null {
  const deadline = parseDeadline(deadlineString);
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(deadline);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

/** تاريخ محلي بصيغة YYYY-MM-DD (المتوافقة مع input[type=date] وعمود deadline_date) */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** تاريخ اليوم المحلي + n يوم بصيغة YYYY-MM-DD */
export function addDaysISO(days: number, from: Date = new Date()): string {
  const date = new Date(from);
  date.setHours(12, 0, 0, 0); // منتصف النهار يتفادى قفزات التوقيت الصيفي
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** هل يحمل الموعد ساعة محددة؟ (YYYY-MM-DD وحده = نهاية اليوم) */
export function hasDeadlineTime(deadlineString: string | null | undefined): boolean {
  return Boolean(deadlineString && !DATE_ONLY.test(deadlineString) && parseDeadline(deadlineString));
}

/**
 * يدمج تاريخاً (YYYY-MM-DD) وساعة (HH:mm) محليين في ISO بإزاحة المنطقة الزمنية:
 * "2026-10-29" + "18:00" → "2026-10-29T18:00:00+03:00" — لحظة واحدة لا لبس فيها لأي جهاز أو خادم.
 */
export function combineLocalDateTime(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const local = new Date(y, m - 1, d, hh, mm, 0, 0);
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date}T${pad2(hh)}:${pad2(mm)}:00${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** الساعة المتبقية حتى الموعد (سالبة إن فات) */
export function hoursRemaining(deadlineString: string | null | undefined): number | null {
  const deadline = parseDeadline(deadlineString);
  return deadline ? (deadline.getTime() - Date.now()) / 3_600_000 : null;
}

/** وقت الموعد فقط: "6:00 م" — أو null إن كان الموعد نهاية اليوم */
export function formatDeadlineTime(deadlineString: string | null | undefined): string | null {
  if (!hasDeadlineTime(deadlineString)) return null;
  const deadline = parseDeadline(deadlineString);
  return deadline ? format(deadline, 'h:mm a', { locale: ar }) : null;
}

/**
 * تنسيق موعد نهائي للعرض:
 *   بدون ساعة → "الخميس 29 أكتوبر"            (+ السنة إن لم تكن الحالية)
 *   بساعة    → "الخميس 29 أكتوبر، 6:00 م"
 */
export function formatDeadline(
  deadlineString: string | null | undefined,
  { weekday = false, year = 'auto' }: { weekday?: boolean; year?: 'auto' | 'always' | 'never' } = {},
): string {
  const deadline = parseDeadline(deadlineString);
  if (!deadline) return deadlineString || '—';
  const showYear = year === 'always' || (year === 'auto' && deadline.getFullYear() !== new Date().getFullYear());
  const datePart = format(deadline, `${weekday ? 'EEEE ' : ''}d MMMM${showYear ? ' yyyy' : ''}`, { locale: ar });
  const timePart = formatDeadlineTime(deadlineString);
  return timePart ? `${datePart}، ${timePart}` : datePart;
}
