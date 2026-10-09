import { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { reportUrl } from '../api';
import {
  useOverview, useOverTime, useMachinePerf, useVerificationStats,
  useCommonChanges, useIssuesStats, useDurationComparison, useMachines, useProducts,
} from '../queries';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import TooltipTip from '../components/Tooltip';
import { Card, KpiCard, ChartTooltip } from '../components/Card';

const PIE_COLORS = ['#34d399', '#f87171', '#fbbf24', '#94a3b8', '#60a5fa'];

function ChartEmpty({ label }: { label: string }) {
  return <EmptyState title="No recorded data" detail={label} />;
}

export default function AnalyticsPage() {
  const [machineId, setMachineId] = useState('');
  const [productId, setProductId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const filters = { machine_id: machineId || undefined, product_id: productId || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined };

  const overview = useOverview(filters);
  const overTime = useOverTime(filters);
  const machinePerf = useMachinePerf({ date_from: filters.date_from, date_to: filters.date_to });
  const verification = useVerificationStats(filters);
  const common = useCommonChanges(filters);
  const issues = useIssuesStats({ machine_id: filters.machine_id, date_from: filters.date_from, date_to: filters.date_to });
  const durations = useDurationComparison(filters);
  const machines = useMachines({ page_size: 50 });
  const products = useProducts({ page_size: 50 });

  const loading = overview.isLoading || overTime.isLoading;
  const failed = overview.isError || overTime.isError;
  const k = overview.data?.kpis;
  const defs: Record<string, string> = overview.data?.definitions ?? {};

  const outcomePie = k
    ? [
        { name: 'Completed', value: k.completed_changeovers },
        { name: 'Failed', value: k.failed_changeovers },
        { name: 'Abandoned', value: k.abandoned_changeovers },
        { name: 'In progress', value: k.in_progress_changeovers },
      ].filter((s) => s.value > 0)
    : [];
  const verPie = verification.data
    ? [
        { name: 'Pass', value: verification.data.pass },
        { name: 'Fail', value: verification.data.fail },
      ].filter((s) => s.value > 0)
    : [];

  const kpiCards: { label: string; value: string; def: string }[] = k
    ? [
        { label: 'Total changeovers', value: String(k.total_changeovers), def: 'All recorded changeovers in scope' },
        { label: 'Completed', value: String(k.completed_changeovers), def: 'Status COMPLETED' },
        { label: 'Failed / blocked', value: `${k.failed_changeovers} / ${k.abandoned_changeovers}`, def: 'FAILED vs ABANDONED (given up, state preserved)' },
        { label: 'Success rate', value: `${k.success_rate}%`, def: defs.success_rate ?? '' },
        { label: 'Avg duration', value: k.avg_duration_seconds != null ? `${k.avg_duration_seconds}s` : 'No recorded data', def: defs.avg_duration_seconds ?? '' },
        { label: 'Avg changes', value: k.avg_changes != null ? String(k.avg_changes) : 'No recorded data', def: defs.avg_changes ?? '' },
        { label: 'Verification pass rate', value: `${k.verification_pass_rate}%`, def: defs.verification_pass_rate ?? '' },
        { label: 'Open issues', value: String(k.open_issues), def: 'Issues with resolution status OPEN' },
      ]
    : [];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Analytics"
        subtitle="Trends, verification, and durations — every figure is computed from persisted records."
      />
      {/* Filters + export */}
      <Card>
        <div className="flex gap-2 flex-wrap items-end">
          <label className="text-sm">
            <span className="eyebrow block mb-1">Machine</span>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="input !w-auto" aria-label="Filter by machine">
              <option value="">All machines</option>
              {(machines.data?.items ?? []).map((m: { id: string }) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="eyebrow block mb-1">Product</span>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input !w-auto" aria-label="Filter by product">
              <option value="">All products</option>
              {(products.data?.items ?? []).map((p: { id: string }) => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="eyebrow block mb-1">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input !w-auto" aria-label="From date" />
          </label>
          <label className="text-sm">
            <span className="eyebrow block mb-1">To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input !w-auto" aria-label="To date" />
          </label>
          <div className="ml-auto flex gap-2">
            <a href={reportUrl('/api/reports/changeovers', filters)} download className="btn btn-ghost text-sm">
              <Download size={14} /> Changeovers CSV
            </a>
            <a href={reportUrl('/api/reports/summary', filters)} download className="btn btn-ghost text-sm">
              <Download size={14} /> Summary CSV
            </a>
          </div>
        </div>
      </Card>

      {loading && <Loading label="Loading analytics…" />}
      {failed && <ErrorState error={overview.error ?? overTime.error} onRetry={() => overview.refetch()} />}

      {overview.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiCards.map((c, i) => (
              <div key={c.label} className={`rise-in rise-${Math.min(4, i + 1)}`}>
                <TooltipTip label={c.def}>
                  <div className="contents">
                    <KpiCard label={c.label} value={c.value} accent="text-slate-100" />
                  </div>
                </TooltipTip>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <div className="card-title mb-0.5"><BarChart3 size={16} /> Changeovers over time</div>
              <p className="card-sub mb-2">Stacked completions per day in the selected range.</p>
              {(overTime.data ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range — adjust filters or run a changeover." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={overTime.data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#22314f" vertical={false} />
                      <XAxis dataKey="date" stroke="#93a3bd" fontSize={11} tickLine={false} axisLine={{ stroke: '#22314f' }} />
                      <YAxis stroke="#93a3bd" fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(37 99 235 / 0.08)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="completed" stackId="a" fill="#34d399" radius={[0, 0, 0, 0]} animationDuration={600} />
                      <Bar dataKey="failed" stackId="a" fill="#f87171" animationDuration={600} />
                      <Bar dataKey="abandoned" stackId="a" fill="#64748b" animationDuration={600} />
                      <Bar dataKey="in_progress" stackId="a" fill="#fbbf24" radius={[5, 5, 0, 0]} animationDuration={600} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <div className="card-title mb-0.5">Completed vs failed vs others</div>
              <p className="card-sub mb-2">Outcome split across the filtered scope.</p>
              {outcomePie.length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={outcomePie} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 12 }} animationDuration={600}>
                        {outcomePie.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#0f172a" strokeWidth={2} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <div className="card-title mb-0.5">
                Verification pass/fail {verification.data ? `(${verification.data.runs} runs)` : ''}
              </div>
              <p className="card-sub mb-2">Append-only verification runs — reruns never erase history.</p>
              {verification.isLoading ? (
                <Loading label="Loading verification…" />
              ) : verPie.length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={verPie} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 12 }} animationDuration={600}>
                        {verPie.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#0f172a" strokeWidth={2} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <div className="card-title mb-0.5">Changeovers by machine</div>
              <p className="card-sub mb-2">Per-machine completions in scope.</p>
              {(machinePerf.data ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={machinePerf.data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#22314f" vertical={false} />
                      <XAxis dataKey="machine_id" stroke="#93a3bd" fontSize={12} tickLine={false} axisLine={{ stroke: '#22314f' }} />
                      <YAxis stroke="#93a3bd" fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(37 99 235 / 0.08)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="completed" fill="#34d399" radius={[5, 5, 0, 0]} animationDuration={600} />
                      <Bar dataKey="failed" fill="#f87171" radius={[5, 5, 0, 0]} animationDuration={600} />
                      <Bar dataKey="total" fill="#60a5fa" radius={[5, 5, 0, 0]} animationDuration={600} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <div className="card-title mb-0.5">Most frequently changed parameters</div>
              <p className="card-sub mb-2">Counts of parameter changes across recorded runs.</p>
              {(common.data?.parameters ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={common.data?.parameters} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#22314f" horizontal={false} />
                      <XAxis type="number" stroke="#93a3bd" fontSize={12} allowDecimals={false} tickLine={false} axisLine={{ stroke: '#22314f' }} />
                      <YAxis type="category" dataKey="parameter" stroke="#93a3bd" fontSize={12} width={110} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(37 99 235 / 0.08)' }} />
                      <Bar dataKey="count" fill="#fbbf24" radius={[0, 5, 5, 0]} animationDuration={600} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <div className="card-title mb-0.5">Most common reported issues</div>
              <p className="card-sub mb-2">Open vs resolved by category.</p>
              {(issues.data?.by_category ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={issues.data?.by_category} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#22314f" horizontal={false} />
                      <XAxis type="number" stroke="#93a3bd" fontSize={12} allowDecimals={false} tickLine={false} axisLine={{ stroke: '#22314f' }} />
                      <YAxis type="category" dataKey="category" stroke="#93a3bd" fontSize={12} width={110} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(37 99 235 / 0.08)' }} />
                      <Bar dataKey="open" stackId="a" fill="#f87171" animationDuration={600} />
                      <Bar dataKey="resolved" stackId="a" fill="#34d399" radius={[0, 5, 5, 0]} animationDuration={600} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <div className="card-title mb-0.5">Estimated vs actual duration (completed)</div>
            <p className="card-sub mb-2">
              Estimated = application-generated plan totals (labeled estimates); actual = recorded start→completion.
              {(durations.data?.items ?? []).length === 0
                ? ' No recorded data in this range.'
                : ''}
            </p>
            {(durations.data?.items ?? []).length > 0 && (
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={durations.data?.items} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#22314f" vertical={false} />
                    <XAxis dataKey="label" stroke="#93a3bd" fontSize={11} tickLine={false} axisLine={{ stroke: '#22314f' }} />
                    <YAxis stroke="#93a3bd" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(37 99 235 / 0.08)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="estimated_seconds" name="estimated (s)" fill="#64748b" radius={[5, 5, 0, 0]} animationDuration={600} />
                    <Bar dataKey="actual_seconds" name="actual (s)" fill="#fbbf24" radius={[5, 5, 0, 0]} animationDuration={600} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {(overview.data as { definitions?: Record<string, string> }).definitions && (
            <Card>
              <h3 className="font-semibold mb-1 text-sm">Metric definitions</h3>
              <ul className="text-xs text-slate-400 list-disc ml-5 space-y-0.5">
                {Object.entries(defs).map(([kk, vv]) => (
                  <li key={kk}>
                    <span className="text-slate-300">{kk}</span>: {vv}
                  </li>
                ))}
                <li>Records attributed to the demo-seed operator are labeled simulated.</li>
              </ul>
            </Card>
          )}
        </>
      )}
      {overview.data && (overview.data.kpis?.total_changeovers ?? 0) === 0 && (
        <EmptyState title="No changeovers in scope" detail="Adjust filters or run a changeover — metrics compute from persisted records only." />
      )}
    </div>
  );
}
