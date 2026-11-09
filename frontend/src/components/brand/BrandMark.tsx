/**
 * =========================================================================
 * BrandMark — Official PHANTOMS Standalone Symbol
 * =========================================================================
 * Uses the approved layered red, black, and white phantom mask without
 * distortion, redrawing, or recoloring.
 * Native aspect ratio: 1302 × 1208 (1.0778:1)
 * =========================================================================
 */

export type BrandMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface BrandMarkProps {
  size?: BrandMarkSize;
  dimension?: number;
  className?: string;
  alt?: string;
  loading?: 'lazy' | 'eager';
}

const SIZE_MAP: Record<BrandMarkSize, { width: number; height: number }> = {
  xs: { width: 26, height: 24 },
  sm: { width: 35, height: 32 },
  md: { width: 43, height: 40 },
  lg: { width: 60, height: 56 },
  xl: { width: 86, height: 80 },
};

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 'md',
  dimension,
  className = '',
  alt = 'شعار PHANTOMS الرسمي',
  loading = 'eager',
}) => {
  const { width, height } = dimension
    ? { width: Math.round(dimension * (1302 / 1208)), height: dimension }
    : SIZE_MAP[size];

  return (
    <img
      src="/branding/phantoms-mark.png"
      srcSet="/branding/phantoms-mark-192.png 192w, /branding/phantoms-mark-512.png 512w"
      sizes={`${width}px`}
      width={width}
      height={height}
      alt={alt}
      loading={loading}
      className={`inline-block shrink-0 object-contain select-none transition-transform duration-200 ${className}`}
      style={{
        aspectRatio: '1302 / 1208',
      }}
      draggable={false}
    />
  );
};

export default BrandMark;
