import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Search, ArrowUpDown } from 'lucide-react';
import { reportUrl, type HistoryRow } from '../api';
import { useHistory, useMachines, useProducts } from '../queries';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';

const PAGE_SIZE = 15;

export default function HistoryPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [machineId, setMachineId] = useState('');
  const [productId, setProductId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('-started_at');
  const [page, setPage] = useState(1);

  const filters = {
    q: q || undefined,
    status: status || undefined,
    machine_id: machineId || undefined,
    product_id: productId || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  };
  const history = useHistory(filters);
  const machines = useMachines({ page_size: 50 });
  const products = useProducts({ page_size: 50 });

  function resetPage() {
    setPage(1);
  }

  const items: HistoryRow[] = history.data?.items ?? [];
  const total: number = history.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="font-semibold">Changeover history ({total})</h3>
        <a
          href={reportUrl('/api/reports/changeovers', filters)}
          download
          className="ml-auto flex items-center gap-1 bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm"
        >
          <Download size={14} /> Export CSV (filtered)
        </a>
      </div>
      <div className="flex gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
            placeholder="Search machine, operator…"
            aria-label="Search history"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-sm"
          />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} aria-label="Filter by status" className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="ABANDONED">Abandoned</option>
        </select>
        <select value={machineId} onChange={(e) => { setMachineId(e.target.value); resetPage(); }} aria-label="Filter by machine" className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm">
          <option value="">All machines</option>
          {(machines.data?.items ?? []).map((m: { id: string }) => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
        <select value={productId} onChange={(e) => { setProductId(e.target.value); resetPage(); }} aria-label="Filter by product" className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm">
          <option value="">All products</option>
          {(products.data?.items ?? []).map((p: { id: string }) => (
            <option key={p.id} value={p.id}>{p.id}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetPage(); }} aria-label="From date" className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetPage(); }} aria-label="To date" className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm" />
        <button onClick={() => setSort(sort === '-started_at' ? 'started_at' : '-started_at')} title="Toggle start-time sort" className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-sm">
          <ArrowUpDown size={13} /> {sort === '-started_at' ? 'Newest' : 'Oldest'}
        </button>
      </div>

      {history.isLoading && <Loading label="Loading history…" />}
      {history.isError && <ErrorState error={history.error} onRetry={() => history.refetch()} />}
      {history.data && items.length === 0 && (
        <EmptyState title="No changeovers match" detail="Adjust filters — records persist even after machines or products are edited." />
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase">
                <th className="pr-3 py-1">ID</th>
                <th className="pr-3">Machine</th>
                <th className="pr-3">Route</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Started</th>
                <th className="pr-3">Duration</th>
                <th className="pr-3">Changes</th>
                <th className="pr-3">Verification</th>
                <th className="pr-3">Issues</th>
                <th className="text-right">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="border-t border-slate-800">
                  <td className="pr-3 py-1">#{h.id}</td>
                  <td className="pr-3">{h.machine_id}</td>
                  <td className="pr-3">
                    {h.source} → {h.target}
                  </td>
                  <td className="pr-3">
                    <StatusBadge value={h.status} />
                    {h.simulated && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-900 text-violet-200">
                        simulated
                      </span>
                    )}
                  </td>
                  <td className="pr-3 text-xs text-slate-400">{h.started_at}</td>
                  <td className="pr-3 text-xs">
                    {h.actual_duration_seconds != null ? `${h.actual_duration_seconds}s` : '—'}
                    <span className="text-slate-500"> (est plan, base {h.baseline_duration_seconds}s)</span>
                  </td>
                  <td className="pr-3">{h.changes}</td>
                  <td className="pr-3">
                    <StatusBadge value={h.verification === 'NOT_RUN' ? 'PENDING' : h.verification} />
                  </td>
                  <td className="pr-3">{h.issues_open}</td>
                  <td className="text-right">
                    <Link to={`/changeovers/${h.id}`} className="text-amber-300 hover:text-amber-200 text-xs">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-sm">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 disabled:opacity-40">
            Prev
          </button>
          <span className="text-slate-400">
            Page {page} of {pages}
          </span>
          <button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page >= pages} className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
