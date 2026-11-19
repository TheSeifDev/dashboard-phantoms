import { create } from 'zustand';

export type Locale = 'ar' | 'en';
const STORAGE_KEY = 'phantoms_locale';
export const parseLocale = (raw: unknown): Locale => raw === 'en' ? 'en' : 'ar';

function readLocale(): Locale {
  try { return parseLocale(localStorage.getItem(STORAGE_KEY)); } catch { return 'ar'; }
}

export function applyLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

const initialLocale = readLocale();
applyLocale(initialLocale);

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}
export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    const next = parseLocale(locale);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* preference remains usable in memory */ }
    applyLocale(next);
    set({ locale: next });
  },
}));

/** Translated UI copy is explicit; user-authored names and content must not be passed here. */
export function useLocale() {
  const { locale, setLocale } = useLocaleStore();
  const languageTag = locale === 'ar' ? 'ar-EG' : 'en-GB';
  return {
    locale,
    dir: (locale === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    setLocale,
    t: (arabic: string, english: string) => locale === 'ar' ? arabic : english,
    number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(languageTag, options).format(value),
    date: (value: Date | string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(languageTag, { timeZone: 'Africa/Cairo', ...options }).format(new Date(value)),
  };
}
