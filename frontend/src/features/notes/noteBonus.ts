/** النقاط تُخزَّن داخل نص الملاحظة بالصيغة [B:+5] أو [B:-3] */
const BONUS_MARKER = /\[B:([+-]?\d+)\]/;

export function parseNoteBonus(text: string | null | undefined): { bonus: number | null; body: string } {
  const raw = text ?? '';
  const match = raw.match(BONUS_MARKER);
  if (!match) return { bonus: null, body: raw.trim() };
  return { bonus: parseInt(match[1], 10), body: raw.replace(BONUS_MARKER, '').replace(/\s{2,}/g, ' ').trim() };
}
