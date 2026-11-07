interface SkeletonProps {
  className?: string;
  rows?: number;
}

export function Skeleton({ className = '', rows = 1 }: SkeletonProps) {
  return (
    <div className={`animate-pulse rounded-lg bg-[var(--surface-2)] ${className}`} aria-hidden="true">
      {rows > 1 && <span className="sr-only">بنحمّل...</span>}
    </div>
  );
}

export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="بنحمّل المحتوى">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-4 h-8 w-1/2" />
          <Skeleton className="mt-3 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
