/** Animated progress bar with reduced-motion-safe CSS transition. */
export default function ProgressBar({
  percent,
  busy,
  label,
}: {
  percent: number;
  busy?: boolean;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div style={{ width: `${clamped}%` }} className={busy ? 'bar-busy' : undefined} />
      </div>
    </div>
  );
}
