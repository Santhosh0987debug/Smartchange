export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-slate-600 border-t-amber-400"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}

export default function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
      <Spinner /> {label}
    </div>
  );
}
