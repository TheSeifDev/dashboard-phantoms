import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Moon, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/theme';
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
  const BadgeIcon = audience === 'admin' ? ShieldCheck : Sparkles;

  return (
    <div className="auth-shell" dir="rtl">
      <header className="auth-topbar">
        <Link className="auth-brand" to="/login" aria-label="PHANTOMS — الرئيسية">
          <PhantomsLogo size="md" />
        </Link>
        <span className="auth-topbar-caption">نظام إدارة العمليات والتكليفات</span>
      </header>
      <main className="auth-layout">
        <section className="auth-story" aria-label="عن PHANTOMS">
          <p className="auth-eyebrow">منصة متطورة لإدارة وتنسيق مهام وفرق العمليات.</p>
          <h1>أهلاً بيك<br /><span>في منصة PHANTOMS</span></h1>
          <p className="auth-story-copy">في PHANTOMS، بنمكّن الفرق من إنجاز العمليات وتتبع المهام بدقة وسرعة فائقة.</p>
          <div className="auth-benefits">
            <span>عمليات متكاملة</span><span>كفاءة عالية</span><span>أداء متميز</span>
          </div>
        </section>
        <section className="auth-panel" aria-labelledby="auth-title">
          <button type="button" onClick={toggle} className="auth-theme-toggle" aria-label={theme === 'dark' ? 'شغّل الوضع الفاتح' : 'شغّل الوضع الداكن'}>
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <div className="auth-heading">
            <span className="auth-badge"><BadgeIcon size={16} aria-hidden="true" />{badge}</span>
            <h2 id="auth-title">{title}</h2>
            <p>{description}</p>
          </div>
          {children}
          <div className="auth-footer">{footer}</div>
        </section>
      </main>
      <footer className="auth-page-footer" dir="ltr" lang="en">Code. Build. Innovate. Impact. <span>© 2026 PHANTOMS</span></footer>
    </div>
  );
}
