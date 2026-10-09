import { CheckCircle2, XCircle, Play, Circle, ShieldCheck, Wrench, Gauge, ClipboardCheck } from 'lucide-react';
import StatusBadge from './StatusBadge';

export interface TimelineStep {
  id: string | number;
  label: string;
  sub?: string;
  status: string;
  active?: boolean;
  onSelect?: () => void;
}

function iconFor(status: string, label: string) {
  if (status === 'COMPLETED') return <CheckCircle2 size={17} className="text-emerald-400" />;
  if (status === 'FAILED') return <XCircle size={17} className="text-red-400" />;
  if (status === 'IN_PROGRESS')
    return (
      <span className="relative flex">
        <Play size={15} className="text-cyan-300" />
        <span className="absolute -inset-1 rounded-full border border-cyan-400/40 animate-ping" aria-hidden="true" />
      </span>
    );
  const l = label.toLowerCase();
  if (l.includes('loto') || l.includes('safety')) return <ShieldCheck size={15} className="text-slate-500" />;
  if (l.includes('speed') || l.includes('temp') || l.includes('press') || l.includes('param'))
    return <Gauge size={15} className="text-slate-500" />;
  if (l.includes('verif')) return <ClipboardCheck size={15} className="text-slate-500" />;
  if (l.includes('nozzle') || l.includes('fixture') || l.includes('component'))
    return <Wrench size={15} className="text-slate-500" />;
  return <Circle size={14} className="text-slate-600" />;
}

/** Vertical step timeline with connectors and state styling. */
export default function StepTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.id} className="relative flex gap-3 pb-2.5 last:pb-0">
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={`absolute left-[8px] top-6 bottom-0 w-0.5 rounded-full ${
                s.status === 'COMPLETED'
                  ? 'bg-gradient-to-b from-emerald-500/70 to-emerald-900/40'
                  : s.status === 'IN_PROGRESS'
                    ? 'bg-gradient-to-b from-cyan-400/70 to-slate-800'
                    : 'bg-slate-800'
              }`}
            />
          )}
          <span
            className={`relative z-10 mt-1 shrink-0 rounded-full ring-1 p-0.5 ${
              s.status === 'COMPLETED'
                ? 'bg-emerald-950/60 ring-emerald-800'
                : s.active
                  ? 'bg-blue-950/60 ring-blue-700'
                  : 'bg-slate-900 ring-slate-800'
            }`}
          >
            {iconFor(s.status, s.label)}
          </span>
          <button
            onClick={s.onSelect}
            disabled={!s.onSelect}
            aria-current={s.active ? 'step' : undefined}
            className={`flex-1 min-w-0 text-left rounded-lg px-2.5 py-1.5 transition-all ${
              s.active
                ? 'bg-blue-950/40 border border-blue-800/70 shadow-[0_0_0_1px_rgb(37_99_235/0.25)]'
                : 'border border-transparent hover:bg-slate-800/60 hover:border-slate-700'
            } ${s.onSelect ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[13px] truncate ${s.active ? 'font-semibold text-white' : ''}`}>
                {s.label}
              </span>
              <span className="ml-auto shrink-0">
                <StatusBadge value={s.status} />
              </span>
            </div>
            {s.sub && <div className="text-xs text-slate-500 truncate mt-0.5">{s.sub}</div>}
          </button>
        </li>
      ))}
    </ol>
  );
}
