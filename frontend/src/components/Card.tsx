import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

export function Card({
  children,
  hover,
  className = '',
}: {
  children: ReactNode;
  hover?: boolean;
  className?: string;
}) {
  return <div className={`card ${hover ? 'card-hover' : ''} ${className}`}>{children}</div>;
}

/** Animated number that eases toward `value`; static when reduced-motion is preferred. */
export function useAnimatedNumber(value: number, duration = 600): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    let frame = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return display;
}

export function KpiCard({
  label,
  value,
  display,
  definition,
  accent = 'text-blue-200',
  icon,
  sub,
}: {
  label: string;
  value: number | string;
  display?: string;
  definition?: string;
  accent?: string;
  icon?: ReactNode;
  sub?: string;
}) {
  const numericValue = typeof value === 'number' ? value : 0;
  const animated = useAnimatedNumber(numericValue);
  const shown = display ?? (typeof value === 'number' ? String(Math.round(animated)) : String(value));
  return (
    <div className="card card-hover" title={definition}>
      <div className="flex items-center gap-2">
        {icon && (
          <span className="rounded-lg bg-slate-800 border border-slate-700 p-1.5 text-slate-300">
            {icon}
          </span>
        )}
        <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1 leading-tight">
          {label}
          {definition && <Info size={11} className="text-slate-600 shrink-0" aria-hidden="true" />}
        </div>
      </div>
      <div className={`text-[26px] font-bold tabular-nums tracking-tight mt-1.5 ${accent}`}>{shown}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

/** Chart tooltip shared by Recharts charts (real backend data only). */
export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tip px-2.5 py-2">
      {label != null && label !== '' && (
        <div className="font-semibold text-slate-200 mb-1">{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-slate-300 tabular-nums">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: p.color ?? '#3b82f6' }}
            aria-hidden="true"
          />
          <span>{p.name ?? p.dataKey}:</span>
          <b className="ml-auto pl-3">{String(p.value)}</b>
        </div>
      ))}
    </div>
  );
}
