import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Flame, GitMerge, History, Moon, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/theme';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { useLocale } from '../../i18n/useLocale';
import { AuthHive } from '../motion/AuthHive';
import { PhantomsLogo } from '../brand/PhantomsLogo';

interface AuthShellProps {
  title: string;
  description: string;
  badge: string;
  audience: 'admin' | 'member';
  children: ReactNode;
  footer: ReactNode;
}

export function AuthShell({ title, description, badge, audience, children, footer }: AuthShellProps) {
  const { theme, toggle } = useThemeStore();
  const { locale, dir, t } = useLocale();
  const BadgeIcon = audience === 'admin' ? ShieldCheck : Sparkles;

  return (
    <div className="auth-shell" dir={dir} lang={locale}>
      <header className="auth-topbar">
        <Link className="auth-brand" to="/login" aria-label={t('PHANTOMS — الرئيسية', 'PHANTOMS — Home')}>
          <PhantomsLogo size="md" />
          <span className="sr-only"><strong>PHANTOMS</strong></span>
        </Link>
        <span className="auth-topbar-caption">{t('نظام إدارة العمليات والتكليفات', 'Operations and task management')}</span>
        <div className="auth-controls">
          <LanguageToggle />
          <button type="button" onClick={toggle} className="auth-theme-toggle" aria-label={theme === 'dark' ? t('شغّل الوضع الفاتح', 'Switch to light mode') : t('شغّل الوضع الداكن', 'Switch to dark mode')}>
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>
      <main className="auth-layout">
        <section className="auth-story" aria-label={t('عن PHANTOMS', 'About PHANTOMS')}>
          <div className="auth-story-copy-block">
            <p className="auth-eyebrow">DESIGN FROM THE SHADOW <span>•</span> IDEAS INTO IMPACT.</p>
            <h1>{t('فريق واحد. تأثير أبعد.', 'One team. Greater impact.')}</h1>
            <p className="auth-story-copy">{t('وصّل الناس بالأفكار. نظّم المهام، وتابع الإنجاز مع PHANTOMS.', 'Connect people and ideas. Organise tasks and track progress with PHANTOMS.')}</p>
          </div>
          <AuthHive />
          <ul className="auth-features">
            <li><i><GitMerge size={15} aria-hidden="true" /></i><span>{t('تسليمات المهام وGitHub في خلية واحدة', 'Task deliveries and GitHub in one hive')}</span></li>
            <li><i><Flame size={15} aria-hidden="true" /></i><span>{t('اللون يسخن كل ما زاد عدد المشاركين', 'Cells heat up as more people pitch in')}</span></li>
            <li><i><History size={15} aria-hidden="true" /></i><span>{t('سجل كامل لكل يوم بضغطة', 'Full history of any day in one click')}</span></li>
          </ul>
        </section>
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-heading">
            <span className="auth-badge"><BadgeIcon size={16} aria-hidden="true" />{badge}</span>
            <h2 id="auth-title">{title}</h2>
            <p>{description}</p>
          </div>
          {children}
          <div className="auth-footer">{footer}</div>
        </section>
      </main>
      <footer className="auth-page-footer" dir="ltr" lang="en">DESIGN FROM THE SHADOW <span>•</span> IDEAS INTO IMPACT. <strong>© 2026 PHANTOMS</strong></footer>
    </div>
  );
}
