/**
 * صياغة الأعداد بالعربية مع المعدود (مفرد/مثنى/جمع قلة/تمييز مفرد).
 * 1 → "مهمة واحدة"، 2 → "مهمتان"، 3..10 → "3 مهام"، 11+ → "11 مهمة".
 */
export interface ArabicCountForms {
  one: string;
  two: string;
  few: string;
  many: string;
  /** صيغة الصفر — افتراضياً "0 + many" */
  zero?: string;
}

export function arCount(n: number, forms: ArabicCountForms): string {
  const value = Math.max(0, Math.trunc(n));
  if (value === 0) return forms.zero ?? `0 ${forms.many}`;
  if (value === 1) return forms.one;
  if (value === 2) return forms.two;
  const lastTwo = value % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `${value} ${forms.few}`;
  return `${value} ${forms.many}`;
}

export const AR = {
  task: { one: 'مهمة واحدة', two: 'مهمتين', few: 'مهام', many: 'مهمة', zero: 'مفيش مهام' },
  member: { one: 'عضو واحد', two: 'عضوين', few: 'أعضاء', many: 'عضو', zero: 'مفيش أعضاء' },
  /** بعد حرف جر أو مضاف: "إلى عضوين" / "اختيار عضوين" */
  memberGen: { one: 'عضو واحد', two: 'عضوين', few: 'أعضاء', many: 'عضو', zero: 'أي عضو' },
  submission: { one: 'تسليم واحد', two: 'تسليمين', few: 'تسليمات', many: 'تسليم', zero: 'مفيش تسليمات' },
  note: { one: 'ملاحظة واحدة', two: 'ملاحظتين', few: 'ملاحظات', many: 'ملاحظة', zero: 'مفيش ملاحظات' },
  announcement: { one: 'إعلان واحد', two: 'إعلانين', few: 'إعلانات', many: 'إعلان', zero: 'مفيش إعلانات' },
  point: { one: 'نقطة واحدة', two: 'نقطتين', few: 'نقط', many: 'نقطة', zero: '0 نقطة' },
} satisfies Record<string, ArabicCountForms>;

/**
 * رقم بإشارة (+10 / −5) معزول باتجاه LTR حتى لا ينقلب داخل النص العربي إلى "10+" أو "5-".
 */
export function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `\u2066${sign}${Math.abs(value)}\u2069`;
}

/** "بعد ..." / "منذ ..." بصيغة الأيام الصحيحة نحوياً (المثنى المجرور: يومين) */
export function arDaysPhrase(days: number): string {
  const value = Math.abs(Math.trunc(days));
  if (value === 1) return 'يوم';
  if (value === 2) return 'يومين';
  const lastTwo = value % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `${value} أيام`;
  return `${value} يوم`;
}

/** "خلال ..." بالساعات أو الدقائق (المثنى المجرور: ساعتين / دقيقتين) */
export function arDurationPhrase(hours: number): string {
  const totalMinutes = Math.max(1, Math.round(Math.abs(hours) * 60));
  if (totalMinutes < 60) {
    if (totalMinutes === 1) return 'دقيقة';
    if (totalMinutes === 2) return 'دقيقتين';
    if (totalMinutes <= 10) return `${totalMinutes} دقائق`;
    return `${totalMinutes} دقيقة`;
  }
  const h = Math.round(totalMinutes / 60);
  if (h === 1) return 'ساعة';
  if (h === 2) return 'ساعتين';
  if (h <= 10) return `${h} ساعات`;
  return `${h} ساعة`;
}

/** توحيد الكتابة العربية للبحث: إزالة التشكيل وتوحيد الألف والتاء المربوطة والياء */
export function normalizeArabic(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim();
}
