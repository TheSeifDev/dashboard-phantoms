/**
 * النقاط تُخزَّن داخل نص الملاحظة بالصيغة [B:+5] أو [B:-3].
 * المدى مقفول على 18 رقم بالظبط زي regex الـ SQL في get_member_leaderboard،
 * عشان لوحة الأدمن والبورتال ما يطلعوش رقمين مختلفين لنفس الملاحظة.
 */
export const BONUS_MARKER = /\[B:([+-]?\d{1,18})\]/;

/** يشيل وسم النقاط من النص من غير ما يلمس باقي الكلام. */
export const BONUS_MARKER_GLOBAL = /\[B:[+-]?\d{1,18}\]\s*/g;

/** يقرأ قيمة البونص من نص الملاحظة، أو null لو مفيش وسم. */
export function readBonusPoints(text: string | null | undefined): number | null {
  const match = BONUS_MARKER.exec(text ?? '');
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** يخفي وسم النقاط التقني في البطاقة دون تطبيع أو إعادة كتابة نص المستخدم. */
export function parseNoteBonus(text: string | null | undefined): { bonus: number | null; body: string } {
  const raw = text ?? '';
  const match = raw.match(BONUS_MARKER);
  if (!match) return { bonus: null, body: raw };

  const start = match.index ?? 0;
  const end = start + match[0].length;
  // الملاحظة الجديدة تلحق الوسم بمسافة واحدة؛ احذف فاصل النظام فقط، لا مسافات النص الأصلية.
  const removeStart = end === raw.length && start > 0 && raw[start - 1] === ' ' ? start - 1 : start;
  return {
    bonus: Number(match[1]),
    body: raw.slice(0, removeStart) + raw.slice(end),
  };
}
