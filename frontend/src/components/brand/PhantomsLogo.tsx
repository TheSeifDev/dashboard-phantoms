import React from 'react';

/**
 * =========================================================================
 * PHANTOMS Brand Component (Reusable Single Source of Truth)
 * =========================================================================
 * 
 * PROVISIONAL IDENTITY NOTICE:
 * This component provides a neutral, high-precision typographic wordmark and
 * a clean geometric placeholder symbol for the PHANTOMS Operations Platform.
 * 
 * WHEN THE OFFICIAL APPROVED LOGO IS DELIVERED:
 * Replace the SVG mark inside `PhantomsSymbol` below with the approved vector
 * artwork. Do NOT modify individual pages or call sites; this component is the
 * single integration point for all logo placements across the entire application.
 * =========================================================================
 */

interface PhantomsLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  subtitle?: string;
  className?: string;
  symbolOnly?: boolean;
}

/**
 * Clean, temporary geometric placeholder mark.
 * Precise angular emblem with stylized geometric cuts.
 */
export function PhantomsSymbol({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dimension = {
    sm: 28,
    md: 36,
    lg: 44,
  }[size];

  return (
    <svg
      width={dimension}
      height={dimension}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-200 ${className}`}
      aria-hidden="true"
    >
      {/* Outer faceted geometric shield / prism */}
      <rect
        x="2"
        y="2"
        width="40"
        height="40"
        rx="10"
        className="fill-[var(--primary)] stroke-[var(--primary-hover)]"
        strokeWidth="1.5"
      />
      {/* Precision inner geometric cuts */}
      <path
        d="M14 12H26C29.3137 12 32 14.6863 32 18C32 21.3137 29.3137 24 26 24H20V32H14V12Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M20 17H25C25.5523 17 26 17.4477 26 18C26 18.5523 25.5523 19 25 19H20V17Z"
        className="fill-[var(--primary)]"
      />
      {/* Subtle bottom-right telemetry accent */}
      <circle cx="31" cy="31" r="2.5" fill="#38BDF8" />
    </svg>
  );
}

export function PhantomsLogo({
  size = 'md',
  showWordmark = true,
  subtitle,
  className = '',
  symbolOnly = false,
}: PhantomsLogoProps) {
  if (symbolOnly || !showWordmark) {
    return <PhantomsSymbol size={size} className={className} />;
  }

  const wordmarkClasses = {
    sm: 'text-sm tracking-wider',
    md: 'text-base sm:text-lg tracking-wider',
    lg: 'text-xl sm:text-2xl tracking-widest',
  }[size];

  const subtitleClasses = {
    sm: 'text-[10px]',
    md: 'text-[11px]',
    lg: 'text-xs',
  }[size];

  return (
    <div className={`inline-flex items-center gap-2.5 sm:gap-3 select-none ${className}`}>
      <PhantomsSymbol size={size} />
      <div className="flex flex-col justify-center min-w-0 leading-tight">
        <span
          className={`font-black uppercase text-[var(--text)] font-sans ${wordmarkClasses}`}
          style={{ letterSpacing: '0.08em' }}
        >
          PHANTOMS
        </span>
        {subtitle && (
          <span className={`text-[var(--text-muted)] font-bold truncate ${subtitleClasses}`}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

export default PhantomsLogo;
