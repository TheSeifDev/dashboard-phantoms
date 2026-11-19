import { Languages } from 'lucide-react';
import { useLocale } from './useLocale';

export function LanguageToggle() {
  const { locale, t, setLocale } = useLocale();
  return (
    <button type="button" className="language-toggle" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={t('التبديل للإنجليزية', 'Switch to Arabic')} title={t('English', 'العربية')}>
      <Languages size={16} aria-hidden="true" /><span>{locale === 'ar' ? 'EN' : 'عربي'}</span>
    </button>
  );
}
