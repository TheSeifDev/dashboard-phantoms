/** النقاط تُخزَّن داخل نص الملاحظة بالصيغة [B:+5] أو [B:-3] */
const BONUS_MARKER = /\[B:([+-]?\d+)\]/;

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
    bonus: Number.parseInt(match[1], 10),
    body: raw.slice(0, removeStart) + raw.slice(end),
  };
}
