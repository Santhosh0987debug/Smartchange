import { Link } from 'react-router';
import { BarChart3, Play, ArrowRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useSummary } from '../queries';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';

export default function DashboardPage() {
  const summary = useSummary();

  if (summary.isLoading) return <Loading label="Loading dashboard…" />;
  if (summary.isError)
    return (
      <ErrorState
        error={summary.error}
        onRetry={() => summary.refetch()}
        hint="Start the backend first: uvicorn app.main:app --port 8000 (in backend/)."
      />
    );

  const s = summary.data;
  const cards = [
    { label: 'Completed changeovers', value: s?.completed_changeovers ?? '—' },
    {
      label: 'Avg assisted time',
      value: s ? `${Math.round((s.avg_assisted_seconds ?? 0) / 60 * 10) / 10} min` : '—',
    },
    { label: 'Simulated time reduction', value: s ? `${s.simulated_time_reduction_pct}%` : '—' },
    { label: 'Verification failures', value: s?.verification_failures ?? '—' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide">{c.label}</div>
            <div className="text-2xl font-bold text-amber-300">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="text-xs text-slate-400 mb-1">Baseline note</div>
        <div className="text-sm text-slate-300">{s?.baseline_note}</div>
        <div className="text-sm text-slate-300 mt-1">
          Simulated manual baseline: 18 min · Assisted target ≈ 12 min → 33.3% (example;
          dashboard shows measured prototype runs).
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <BarChart3 size={16} /> Changeovers by transition
        </h3>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={s?.by_transition ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="transition" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Bar dataKey="count" fill="#fbbf24" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2">Demo shortcut: A → B with intentional pressure error</h3>
        <ol className="text-sm text-slate-300 list-decimal ml-5 space-y-1">
          <li>
            Go to <b>Changeovers</b>, target <b>Product B</b>, Preview → Create.
          </li>
          <li>Complete LOTO + nozzle + fixture tasks.</li>
          <li>
            Apply speed 120, temp 75, pressure <b>2.5 (wrong)</b> → Verify → see failure.
          </li>
          <li>Apply pressure <b>3.0</b> → Verify passes → Complete → dashboard updates.</li>
        </ol>
        <Link
          to="/changeovers"
          className="mt-2 inline-flex bg-amber-400 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm items-center gap-1"
        >
          <Play size={14} /> Open changeovers <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
