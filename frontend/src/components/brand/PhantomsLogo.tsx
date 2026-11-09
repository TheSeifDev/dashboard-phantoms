import { BrandMark, type BrandMarkSize } from './BrandMark';
import { BrandWordmark, type BrandWordmarkSize, type BrandThemeMode } from './BrandWordmark';
import { BrandLockup, type BrandLockupProps, type BrandLayout } from './BrandLockup';

export { BrandMark, BrandWordmark, BrandLockup };
export type { BrandMarkSize, BrandWordmarkSize, BrandThemeMode, BrandLockupProps, BrandLayout };

/**
 * =========================================================================
 * PhantomsLogo — Primary Central Integration Entry Point
 * =========================================================================
 * Delegates directly to official BrandLockup / BrandMark components.
 * =========================================================================
 */

interface PhantomsLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  subtitle?: string;
  className?: string;
  symbolOnly?: boolean;
  themeMode?: BrandThemeMode;
  showTagline?: boolean;
}

export function PhantomsSymbol({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  return <BrandMark size={size} className={className} />;
}

export function PhantomsLogo({
  size = 'md',
  showWordmark = true,
  subtitle,
  className = '',
  symbolOnly = false,
  themeMode = 'auto',
  showTagline = false,
}: PhantomsLogoProps) {
  if (symbolOnly || !showWordmark) {
    return <BrandMark size={size} className={className} />;
  }

  return (
    <BrandLockup
      layout="horizontal"
      size={size}
      subtitle={subtitle}
      showTagline={showTagline}
      themeMode={themeMode}
      className={className}
    />
  );
}

export default PhantomsLogo;
