import { useState } from 'react';
import { BarChart3, Download, Info } from 'lucide-react';
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

const PIE_COLORS = ['#34d399', '#f87171', '#fbbf24', '#94a3b8', '#60a5fa'];

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">{children}</div>;
}

function ChartEmpty({ label }: { label: string }) {
  return <div className="text-sm text-slate-500 py-6 text-center">{label}</div>;
}

const tooltipStyle = { background: '#0f172a', border: '1px solid #334155' };

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
      {/* Filters + export */}
      <Card>
        <div className="flex gap-2 flex-wrap items-end">
          <label className="text-sm">
            <span className="text-slate-400 block text-xs">Machine</span>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm" aria-label="Filter by machine">
              <option value="">All machines</option>
              {(machines.data?.items ?? []).map((m: { id: string }) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-400 block text-xs">Product</span>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm" aria-label="Filter by product">
              <option value="">All products</option>
              {(products.data?.items ?? []).map((p: { id: string }) => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-400 block text-xs">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm" aria-label="From date" />
          </label>
          <label className="text-sm">
            <span className="text-slate-400 block text-xs">To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm" aria-label="To date" />
          </label>
          <div className="ml-auto flex gap-2">
            <a href={reportUrl('/api/reports/changeovers', filters)} download className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm">
              <Download size={14} /> Changeovers CSV
            </a>
            <a href={reportUrl('/api/reports/summary', filters)} download className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm">
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
            {kpiCards.map((c) => (
              <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4" title={c.def}>
                <div className="text-xs text-slate-400 uppercase tracking-wide flex items-center gap-1">
                  {c.label} <Info size={11} className="text-slate-600" />
                </div>
                <div className="text-2xl font-bold text-amber-300">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <h3 className="font-semibold mb-2 flex items-center gap-2"><BarChart3 size={16} /> Changeovers over time</h3>
              {(overTime.data ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={overTime.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                      <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="completed" stackId="a" fill="#34d399" />
                      <Bar dataKey="failed" stackId="a" fill="#f87171" />
                      <Bar dataKey="abandoned" stackId="a" fill="#94a3b8" />
                      <Bar dataKey="in_progress" stackId="a" fill="#fbbf24" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Completed vs failed vs others</h3>
              {outcomePie.length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={outcomePie} dataKey="value" nameKey="name" outerRadius={80} label>
                        {outcomePie.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">
                Verification pass/fail {verification.data ? `(${verification.data.runs} runs)` : ''}
              </h3>
              {verification.isLoading ? (
                <Loading label="Loading verification…" />
              ) : verPie.length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={verPie} dataKey="value" nameKey="name" outerRadius={80} label>
                        {verPie.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Changeovers by machine</h3>
              {(machinePerf.data ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={machinePerf.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="machine_id" stroke="#94a3b8" fontSize={12} />
                      <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="completed" fill="#34d399" />
                      <Bar dataKey="failed" fill="#f87171" />
                      <Bar dataKey="total" fill="#60a5fa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Most frequently changed parameters</h3>
              {(common.data?.parameters ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={common.data?.parameters} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                      <YAxis type="category" dataKey="parameter" stroke="#94a3b8" fontSize={12} width={110} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#fbbf24" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Most common reported issues</h3>
              {(issues.data?.by_category ?? []).length === 0 ? (
                <ChartEmpty label="No recorded data in this range." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={issues.data?.by_category} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                      <YAxis type="category" dataKey="category" stroke="#94a3b8" fontSize={12} width={110} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="open" stackId="a" fill="#f87171" />
                      <Bar dataKey="resolved" stackId="a" fill="#34d399" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <h3 className="font-semibold mb-1">Estimated vs actual duration (completed)</h3>
            <div className="text-xs text-slate-400 mb-2">
              Estimated = application-generated plan totals; actual = recorded start→completion.
              {(durations.data?.items ?? []).length === 0
                ? ' No recorded data in this range.'
                : ''}
            </div>
            {(durations.data?.items ?? []).length > 0 && (
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={durations.data?.items}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                    <Bar dataKey="estimated_seconds" name="estimated (s)" fill="#94a3b8" />
                    <Bar dataKey="actual_seconds" name="actual (s)" fill="#fbbf24" />
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
