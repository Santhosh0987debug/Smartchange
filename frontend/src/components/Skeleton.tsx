export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Skeleton for card grids (KPIs, lists) while queries load. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <Skeleton className="h-3 w-2/3 mb-2" />
          <Skeleton className="h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows for tables. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2 py-2" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
