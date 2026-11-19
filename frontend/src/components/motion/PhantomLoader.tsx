import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useLocale } from '../../i18n/useLocale';

gsap.registerPlugin(useGSAP);

interface PhantomLoaderProps {
  message?: string;
  className?: string;
}

export function PhantomLoader({ message, className = '' }: PhantomLoaderProps) {
  const { locale, dir, t } = useLocale();
  const scope = useRef<HTMLDivElement>(null);
  const label = message ?? t('بنحمّل الصفحة...', 'Loading page...');

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });
      timeline.fromTo('.phantom-loader__path', { strokeDashoffset: 72 }, { strokeDashoffset: 0, duration: 0.85, ease: 'power2.inOut' })
        .fromTo('.phantom-loader__node', { scale: 0.65, opacity: 0.35 }, { scale: 1, opacity: 1, duration: 0.42, stagger: 0.09, ease: 'back.out(1.8)' }, 0.28);
      return () => timeline.kill();
    });
    return () => media.revert();
  }, { scope });

  return (
    <div className={`phantom-loader ${className}`.trim()} ref={scope} role="status" aria-live="polite" aria-busy="true" dir={dir} lang={locale}>
      <svg className="phantom-loader__mark" viewBox="0 0 64 48" aria-hidden="true" focusable="false">
        <path className="phantom-loader__path" d="M9 24h13l7-13 9 26 7-13h10" />
        <rect className="phantom-loader__node" x="5" y="20" width="8" height="8" rx="1.5" />
        <rect className="phantom-loader__node" x="24" y="7" width="8" height="8" rx="1.5" />
        <rect className="phantom-loader__node" x="34" y="33" width="8" height="8" rx="1.5" />
        <rect className="phantom-loader__node" x="51" y="20" width="8" height="8" rx="1.5" />
      </svg>
      <span className="phantom-loader__brand" aria-hidden="true">PHANTOMS <i>WORKSPACE</i></span>
      <span className="phantom-loader__label">{label}</span>
    </div>
  );
}
