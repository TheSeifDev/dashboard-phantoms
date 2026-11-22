// =====================================================
// منطق إسناد المهام النقي (بدون React) — قابل للاختبار مباشرة.
// البونص بقى تقييم نجوم 1..5، وكل نجمة = 5 نقاط، فالمدى 5..25 نقطة.
// =====================================================

/** نقاط البونص لكل نجمة. */
export const POINTS_PER_STAR = 5;
/** أقصى عدد نجوم في تقييم بونص المهمة. */
export const STAR_MAX = 5;

export type TaskAssignMode = 'all' | 'specific' | 'leads' | 'heads';

export interface AudienceSource {
  memberIds: number[];
  leadIds: number[];
  headIds: number[];
}

/**
 * تحويل النجوم لتقييم بونص بالنقاط.
 * أي قيمة خارج 0..5 أو كسرية بتتظبط، فمستحيل نبعت بونص أكبر من 25.
 */
export function starsToBonusPoints(stars: number): number {
  if (!Number.isFinite(stars)) return 0;
  const clamped = Math.max(0, Math.min(STAR_MAX, Math.trunc(stars)));
  return clamped * POINTS_PER_STAR;
}

/** نص مساعد: "3 نجوم" / "بدون بونص". */
export function starsLabel(stars: number, locale: 'ar' | 'en'): string {
  const value = Math.max(0, Math.min(STAR_MAX, Math.trunc(Number.isFinite(stars) ? stars : 0)));
  if (value === 0) return locale === 'ar' ? 'بدون بونص' : 'No bonus';
  return locale === 'ar' ? `${value} من ${STAR_MAX} نجوم` : `${value} of ${STAR_MAX} stars`;
}

/**
 * يحوّل وضع الإسناد لقائمة معرّفات نصية كما تُخزن في tasks.assigned_to.
 * "all" بيرجع سلسلة ALL، والمجموعات (leads/heads) بتتحول لأعضاء الفريق الفعليين
 * اللي موجودين في القائمة الحالية، فمفيش إسناد لعضو مش في الفريق.
 */
export function resolveAudienceIds(mode: TaskAssignMode, source: AudienceSource, selected: string[] = []): string[] | 'ALL' {
  if (mode === 'all') return 'ALL';
  const allowed = new Set(source.memberIds.map(String));
  const pick = (ids: number[]) => [...new Set(ids.map(String).filter((id) => allowed.has(id)))];
  if (mode === 'leads') return pick(source.leadIds);
  if (mode === 'heads') return pick(source.headIds);
  return [...new Set(selected.filter((id) => allowed.has(id)))];
}

/** عدد الأعضاء اللي هتتسند لهم المهمة فعليًا (للتحقق وللملخص). */
export function audienceCount(mode: TaskAssignMode, source: AudienceSource, selected: string[] = []): number {
  const resolved = resolveAudienceIds(mode, source, selected);
  return resolved === 'ALL' ? source.memberIds.length : resolved.length;
}