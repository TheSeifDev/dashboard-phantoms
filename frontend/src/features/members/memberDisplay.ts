/**
 * تحليل النص المدمج "التخصص: ... | ملاحظات: ..." للعرض فقط.
 * لا يغير أي بيانات — يفصل أجزاء السيرة لعرضها في أماكنها.
 */
export interface ParsedBio {
  specialization: string;
  notes: string;
}

export function parseBio(raw: string | null | undefined): ParsedBio {
  const text = (raw ?? '').trim();
  if (!text) return { specialization: '', notes: '' };
  const notesMarker = 'ملاحظات:';
  const specMarker = 'التخصص:';
  let specialization = text;
  let notes = '';
  const notesIndex = text.indexOf(notesMarker);
  if (notesIndex >= 0) {
    notes = text.slice(notesIndex + notesMarker.length).replace(/^[|\s:ـ-]+/, '').trim();
    specialization = text.slice(0, notesIndex);
  }
  if (specialization.includes(specMarker)) {
    specialization = specialization.split(specMarker).slice(1).join(specMarker);
  }
  specialization = specialization.replace(/^[|\s:ـ-]+/, '').replace(/[|\s:ـ-]+$/, '').trim();
  return { specialization, notes };
}

export type DeviceKind = 'laptop' | 'desktop' | 'phone' | 'tablet' | 'none';

const DEVICE_PATTERNS: { kind: Exclude<DeviceKind, 'none'>; test: RegExp }[] = [
  { kind: 'laptop', test: /لاب|لابتوب|laptop/i },
  { kind: 'desktop', test: /مكتبي|كمبيوتر|ديسكتوب|pc|desktop/i },
  { kind: 'phone', test: /هاتف|موبايل|جوال|فون|phone|mobile/i },
  { kind: 'tablet', test: /تابلت|تاب|tablet|ipad/i },
];

/** يستخرج أنواع الأجهزة من نص الحقل — للعرض فقط. */
export function detectDevices(raw: string | null | undefined): DeviceKind[] {
  const text = (raw ?? '').trim();
  if (!text || /بدون|لا يوجد|لا يمتلك|none/i.test(text)) return ['none'];
  const found = DEVICE_PATTERNS.filter(({ test }) => test.test(text)).map(({ kind }) => kind);
  return found.length ? [...new Set(found)] : ['none'];
}
