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
          <span className="sr-only"><strong>PHANTOMS</strong></span>
        </Link>
        <span className="auth-topbar-caption">نظام إدارة العمليات والتكليفات</span>
      </header>
      <main className="auth-layout">
        <section className="auth-story" aria-label="عن PHANTOMS">
          <p className="auth-eyebrow">DESIGN FROM THE SHADOW • IDEAS INTO IMPACT.</p>
          <h1>أهلاً بيك في<br /><span>PHANTOMS</span></h1>
          <p className="auth-story-copy">فريق تقني يجمع العقول والتخصصات لبناء حلول وتجارب تقنية وتحويل الأفكار إلى تأثير حقيقي في إدارة العمليات والتكليفات.</p>
          <div className="auth-benefits">
            <span className="auth-benefit-pill">PEOPLE • الناس</span>
            <span className="auth-benefit-pill">IDEAS • الأفكار</span>
            <span className="auth-benefit-pill">IMPACT • التأثير</span>
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
      <footer className="auth-page-footer" dir="ltr" lang="en">DESIGN FROM THE SHADOW • IDEAS INTO IMPACT. <span>© 2026 PHANTOMS</span></footer>
    </div>
  );
}
