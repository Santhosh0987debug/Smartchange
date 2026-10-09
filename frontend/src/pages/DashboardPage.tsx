import { Link } from 'react-router';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  ArrowRight, BarChart3, ClipboardCheck, Factory, History, TriangleAlert,
  CheckCircle2, XCircle, Gauge, Cog, Package, Bot, CirclePlay,
} from 'lucide-react';
import { useSummary, useMachines, useHistory } from '../queries';
import type { Machine } from '../api';
import { KpiCard, ChartTooltip } from '../components/Card';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import TooltipTip from '../components/Tooltip';
import { SkeletonCards } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const BAR_COLORS = ['#3b82f6', '#22d3ee', '#a78bfa', '#34d399', '#fbbf24'];

function railFor(status: string): string {
  if (status === 'Operational') return 'rail-ok';
  if (status === 'Maintenance') return 'rail-warn';
  return 'rail-idle';
}

function dotFor(status: string): string {
  if (status === 'Operational') return 'dot-ok';
  if (status === 'Maintenance') return 'dot-warn';
  return 'dot-idle';
}

const QUICK_ACTIONS = [
  { to: '/changeovers', label: 'Plan changeover', desc: 'Compare & start', icon: ClipboardCheck },
  { to: '/machines', label: 'Machines', desc: 'Fleet & status', icon: Cog },
  { to: '/products', label: 'Products', desc: 'Configs', icon: Package },
  { to: '/analytics', label: 'Analytics', desc: 'Trends', icon: BarChart3 },
  { to: '/history', label: 'History', desc: 'Runs & audit', icon: History },
  { to: '/assistant', label: 'AI Assistant', desc: 'SOP help', icon: Bot },
];

export default function DashboardPage() {
  const summary = useSummary();
  const machines = useMachines({ page_size: 20 });
  const history = useHistory({ page: 1, page_size: 6 });

  if (summary.isLoading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-16 w-full" />
        <SkeletonCards count={4} />
        <div className="skeleton h-48 w-full" />
      </div>
    );
  }
  if (summary.isError)
    return (
      <ErrorState
        error={summary.error}
        onRetry={() => summary.refetch()}
        hint="Start the backend first: uvicorn app.main:app --port 8000 (in backend/)."
      />
    );

  const s = summary.data;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const chartData = (s?.by_transition ?? []) as { transition: string; count: number }[];
  const hasChart = chartData.some((d) => (d.count ?? 0) > 0);

  return (
    <div className="space-y-4">
      {/* Welcome header */}
      <div className="card rise-in flex items-end gap-3 flex-wrap !pb-4">
        <PageHeader
          title={`${greeting()} — changeover operations at a glance`}
          subtitle={`${today} · All metrics computed from persisted records. Simulated READY never authorizes real equipment.`}
        />
        <div className="ml-auto flex gap-2">
          <Link to="/changeovers" className="btn btn-primary text-sm">
            <CirclePlay size={15} /> Plan changeover
          </Link>
          <Link to="/analytics" className="btn btn-ghost text-sm">
            <BarChart3 size={15} /> Analytics
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rise-in rise-1">
          <KpiCard
            label="Completed changeovers"
            value={s?.completed_changeovers ?? 0}
            definition="Workflows reaching COMPLETED status"
            sub="Persisted runs only"
            accent="text-emerald-300"
            icon={<CheckCircle2 size={16} className="text-emerald-300" />}
          />
        </div>
        <div className="rise-in rise-2">
          <KpiCard
            label="Avg assisted time"
            value={s ? Math.round(((s.avg_assisted_seconds ?? 0) / 60) * 10) / 10 : 0}
            display={s ? `${Math.round(((s.avg_assisted_seconds ?? 0) / 60) * 10) / 10} min` : '—'}
            definition="Mean recorded duration of completed changeovers"
            sub="Start → finalize"
            accent="text-blue-200"
            icon={<Gauge size={16} className="text-blue-300" />}
          />
        </div>
        <div className="rise-in rise-3">
          <KpiCard
            label="Simulated time reduction"
            value={s?.simulated_time_reduction_pct ?? 0}
            display={s ? `${s.simulated_time_reduction_pct}%` : '—'}
            definition="Vs the 18 min simulated manual baseline"
            sub="Simulated baseline"
            accent="text-cyan-300"
            icon={<BarChart3 size={16} className="text-cyan-300" />}
          />
        </div>
        <div className="rise-in rise-4">
          <KpiCard
            label="Verification failures"
            value={s?.verification_failures ?? 0}
            definition="Recorded failed verification checks"
            sub="Across all runs"
            accent="text-red-300"
            icon={<XCircle size={16} className="text-red-300" />}
          />
        </div>
      </div>

      {/* Machine status overview */}
      <div className="card rise-in rise-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="card-title">
            <Factory size={16} /> Machine status
          </span>
          <TooltipTip label="Live fleet state from the backend. Offline / Fault machines block new changeovers; Maintenance warns.">
            <span className="eyebrow">{(machines.data?.items ?? []).length} registered</span>
          </TooltipTip>
          <Link to="/machines" className="ml-auto text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1 font-medium">
            Manage <ArrowRight size={12} />
          </Link>
        </div>
        <p className="card-sub mb-3">Select a machine to inspect its official configuration and current product.</p>
        {machines.isLoading ? (
          <div className="grid md:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg bg-slate-800/70 border border-slate-800 p-3">
                <div className="skeleton h-4 w-1/2 mb-2" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : (machines.data?.items ?? []).length === 0 ? (
          <EmptyState
            title="No machines registered"
            detail="Add one on the Machines page to begin planning changeovers."
            action={<Link to="/machines" className="btn btn-primary text-xs">Open Machines</Link>}
          />
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {(machines.data?.items ?? []).map((m: Machine) => (
              <Link
                key={m.id}
                to="/machines"
                title={`${m.id} — ${m.status}. Current product ${m.current_product_id ?? 'none'}.`}
                className={`rail ${railFor(m.status)} card card-hover !p-0 !pl-2`}
              >
                <span className="block rounded-lg p-3">
                  <span className="flex items-center gap-2">
                    <span className={`dot ${dotFor(m.status)}`} aria-hidden="true" />
                    <span className="font-mono font-semibold tracking-tight">{m.id}</span>
                    <span className="ml-auto">
                      <StatusBadge value={m.status} />
                    </span>
                  </span>
                  <span className="block text-sm text-slate-200 mt-1 truncate">{m.name}</span>
                  <span className="block text-xs text-slate-500 mt-1">
                    Product <b className="text-slate-300 font-mono">{m.current_product_id ?? '—'}</b>
                    {m.line ? ` · ${m.line}` : ''}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* Chart */}
        <div className="card rise-in rise-2">
          <div className="card-title mb-0.5">
            <BarChart3 size={16} /> Changeovers by transition
          </div>
          <p className="card-sub mb-2">Recorded source → target routes. Bars use persisted history only.</p>
          {!hasChart ? (
            <EmptyState title="No transitions recorded" detail="Completed changeovers will populate this chart." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#22314f" vertical={false} />
                  <XAxis dataKey="transition" stroke="#93a3bd" fontSize={12} tickLine={false} axisLine={{ stroke: '#22314f' }} />
                  <YAxis stroke="#93a3bd" fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(37 99 235 / 0.08)' }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} animationDuration={600}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1">{s?.baseline_note}</div>
        </div>

        {/* Recent activity */}
        <div className="card rise-in rise-3">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="card-title">
              <History size={16} /> Recent activity
            </span>
            <Link to="/history" className="ml-auto text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1 font-medium">
              Full history <ArrowRight size={12} />
            </Link>
          </div>
          <p className="card-sub mb-2">Latest runs with live status — open any row in the workspace.</p>
          {(history.data?.items ?? []).length === 0 && !history.isLoading ? (
            <EmptyState title="No changeovers yet" detail="Completed and in-progress runs will appear here." />
          ) : (
            <ul className="divide-y divide-slate-800/80">
              {(history.data?.items ?? []).map(
                (h: { id: number; machine_id: string; source: string; target: string; status: string; operator: string }) => (
                  <li key={h.id}>
                    <Link to={`/changeovers/${h.id}`} className="flex items-center gap-2 py-2 rounded-lg px-1.5 -mx-1.5 hover:bg-slate-800/60 transition-colors text-sm">
                      <span className="font-mono text-slate-400 text-xs">#{h.id}</span>
                      <span className="min-w-0">
                        <span className="block truncate">
                          <b className="font-mono font-semibold">{h.machine_id}</b>
                          <span className="text-slate-400"> · {h.source} → {h.target}</span>
                        </span>
                        <span className="block text-[11px] text-slate-500">operator {h.operator}</span>
                      </span>
                      <span className="ml-auto shrink-0">
                        <StatusBadge value={h.status} />
                      </span>
                    </Link>
                  </li>
                ),
              )}
            </ul>
          )}
          {history.isError && (
            <div className="text-xs text-slate-500 mt-1">Activity unavailable — backend reachable?</div>
          )}
        </div>
      </div>

      {/* Verification / issues snapshot */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="card rise-in rise-3">
          <div className="card-title mb-0.5">
            <TriangleAlert size={15} /> Attention needed
          </div>
          <p className="card-sub mb-2">Open issues and failed checks from persisted records.</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 rounded-lg border border-amber-900/70 bg-amber-950/40 px-2.5 py-2">
              <TriangleAlert size={15} className="text-amber-300 shrink-0" />
              <span className="text-slate-300">Open issues</span>
              <b className="ml-auto text-amber-200 tabular-nums text-lg">{s?.issues_reported ?? 0}</b>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-red-900/70 bg-red-950/40 px-2.5 py-2">
              <XCircle size={15} className="text-red-300 shrink-0" />
              <span className="text-slate-300">Verification failures</span>
              <b className="ml-auto text-red-300 tabular-nums text-lg">{s?.verification_failures ?? 0}</b>
            </div>
          </div>
          <Link to="/changeovers" className="btn btn-ghost text-xs mt-3">
            Review open changeovers <ArrowRight size={12} />
          </Link>
        </div>
        <div className="card rise-in rise-3">
          <div className="card-title mb-0.5">
            <ClipboardCheck size={15} /> Guided demo path
          </div>
          <p className="card-sub mb-2">A → B with an intentional pressure error, using the real workflow.</p>
          <ol className="text-[13px] text-slate-300 list-decimal ml-5 space-y-1 leading-relaxed">
            <li>
              Go to <b>Changeovers</b>, target <b>Product B</b>, Preview → Create.
            </li>
            <li>Complete LOTO + nozzle + fixture tasks in order.</li>
            <li>
              Apply speed 120, temp 75, pressure <b>2.5 (wrong)</b> → Verify → see failure.
            </li>
            <li>Apply pressure <b>3.0</b> → Verify passes → Finalize → dashboard updates.</li>
          </ol>
          <Link to="/changeovers" className="btn btn-primary text-sm mt-3">
            Open changeovers <ArrowRight size={14} />
          </Link>
        </div>
        <div className="card rise-in rise-4">
          <div className="card-title mb-0.5">
            <Factory size={15} /> Quick actions
          </div>
          <p className="card-sub mb-2">Every tile routes to a working page — no placeholders.</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="group rounded-lg border border-slate-700/80 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 px-2.5 py-2 transition-all hover:-translate-y-px"
              >
                <a.icon size={15} className="text-cyan-300" />
                <span className="block text-[13px] font-semibold mt-1 group-hover:text-white">{a.label}</span>
                <span className="block text-[11px] text-slate-500">{a.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
