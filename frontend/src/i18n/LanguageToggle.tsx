import { Languages } from 'lucide-react';
import { useLocale } from './useLocale';

/**
 * `iconOnly` keeps the control to a single square icon (workspace header); the language
 * name stays available to screen readers and in the tooltip.
 */
export function LanguageToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const { locale, t, setLocale } = useLocale();
  return (
    <button type="button" className={iconOnly ? 'language-toggle language-toggle--icon' : 'language-toggle'}
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={t('التبديل للإنجليزية', 'Switch to Arabic')}
      title={t(`التبديل إلى ${locale === 'ar' ? 'الإنجليزية' : 'العربية'}`, `Switch to ${locale === 'ar' ? 'English' : 'Arabic'}`)}>
      <Languages size={iconOnly ? 18 : 16} aria-hidden="true" />
      <span className={iconOnly ? 'sr-only' : undefined}>{locale === 'ar' ? 'EN' : 'عربي'}</span>
    </button>
  );
}
