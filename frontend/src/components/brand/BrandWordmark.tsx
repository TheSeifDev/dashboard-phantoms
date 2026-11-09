/**
 * =========================================================================
 * BrandWordmark — Official PHANTOMS Wordmark Typography
 * =========================================================================
 * Uses approved Montserrat typography, high-impact weight (900),
 * and exact brand proportions from the V1.0 Brand Identity System.
 * =========================================================================
 */

export type BrandWordmarkSize = 'sm' | 'md' | 'lg' | 'xl';
export type BrandThemeMode = 'auto' | 'light' | 'dark';

interface BrandWordmarkProps {
  size?: BrandWordmarkSize;
  subtitle?: string;
  showTagline?: boolean;
  themeMode?: BrandThemeMode;
  className?: string;
  italic?: boolean;
}

const SIZE_STYLES: Record<BrandWordmarkSize, { title: string; subtitle: string; letterSpacing: string }> = {
  sm: {
    title: 'text-sm font-black',
    subtitle: 'text-[9px] tracking-wider',
    letterSpacing: '0.04em',
  },
  md: {
    title: 'text-base sm:text-lg font-black',
    subtitle: 'text-[10px] tracking-widest',
    letterSpacing: '0.05em',
  },
  lg: {
    title: 'text-xl sm:text-2xl font-black',
    subtitle: 'text-xs tracking-widest',
    letterSpacing: '0.06em',
  },
  xl: {
    title: 'text-2xl sm:text-3xl font-black',
    subtitle: 'text-xs sm:text-sm tracking-widest',
    letterSpacing: '0.08em',
  },
};

export const BrandWordmark: React.FC<BrandWordmarkProps> = ({
  size = 'md',
  subtitle,
  showTagline = false,
  themeMode = 'auto',
  className = '',
  italic = true,
}) => {
  const styles = SIZE_STYLES[size];

  const textColorClass = {
    auto: 'text-[var(--text)]',
    light: 'text-[var(--phantom-black)]',
    dark: 'text-[var(--editorial-white)]',
  }[themeMode];

  const subColorClass = {
    auto: 'text-[var(--text-muted)]',
    light: 'text-[var(--concrete-grey)]',
    dark: 'text-[var(--soft-grey)]',
  }[themeMode];

  const effectiveSubtitle = subtitle || (showTagline ? 'DESIGN FROM THE SHADOW' : undefined);

  return (
    <div className={`flex flex-col justify-center min-w-0 leading-none select-none ${className}`}>
      <span
        className={`font-['Montserrat',sans-serif] uppercase leading-none ${italic ? 'italic font-black' : 'font-black'} ${styles.title} ${textColorClass}`}
        style={{ letterSpacing: styles.letterSpacing }}
      >
        PHANTOMS
      </span>
      {effectiveSubtitle && (
        <span
          className={`font-[var(--font-arabic)] font-bold uppercase truncate mt-1 ${styles.subtitle} ${subColorClass}`}
        >
          {effectiveSubtitle}
        </span>
      )}
    </div>
  );
};

export default BrandWordmark;
