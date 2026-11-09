import { BrandMark, type BrandMarkSize } from './BrandMark';
import { BrandWordmark, type BrandWordmarkSize, type BrandThemeMode } from './BrandWordmark';

/**
 * =========================================================================
 * BrandLockup — Official PHANTOMS Unified Brand Component
 * =========================================================================
 * Supports horizontal lockups (header/sidebar/portal), vertical stacked lockups
 * (auth/hero), or mark-only (rail navigation).
 * =========================================================================
 */

export type BrandLayout = 'horizontal' | 'vertical' | 'mark-only';

export interface BrandLockupProps {
  layout?: BrandLayout;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  subtitle?: string;
  showTagline?: boolean;
  themeMode?: BrandThemeMode;
  className?: string;
  symbolClassName?: string;
  wordmarkClassName?: string;
}

export const BrandLockup: React.FC<BrandLockupProps> = ({
  layout = 'horizontal',
  size = 'md',
  subtitle,
  showTagline = false,
  themeMode = 'auto',
  className = '',
  symbolClassName = '',
  wordmarkClassName = '',
}) => {
  if (layout === 'mark-only' || size === 'xs') {
    return <BrandMark size={size} className={className} />;
  }

  const markSize: BrandMarkSize = size === 'xl' ? 'xl' : size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md';
  const wordmarkSize: BrandWordmarkSize = size === 'xl' ? 'xl' : size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md';

  if (layout === 'vertical') {
    return (
      <div className={`inline-flex flex-col items-center text-center gap-3 select-none ${className}`}>
        <BrandMark size={markSize} className={symbolClassName} />
        <BrandWordmark
          size={wordmarkSize}
          subtitle={subtitle}
          showTagline={showTagline}
          themeMode={themeMode}
          className={wordmarkClassName}
        />
      </div>
    );
  }

  // Horizontal layout
  return (
    <div className={`inline-flex items-center gap-2.5 sm:gap-3.5 select-none ${className}`}>
      <BrandMark size={markSize} className={symbolClassName} />
      <BrandWordmark
        size={wordmarkSize}
        subtitle={subtitle}
        showTagline={showTagline}
        themeMode={themeMode}
        className={wordmarkClassName}
      />
    </div>
  );
};

export default BrandLockup;
