import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, ClipboardCheck, Play, AlertTriangle } from 'lucide-react';
import { API, getApiError } from '../api';
import { MACHINE_ID, useChangeovers, useMachineState, useMachines, useProducts } from '../queries';
import { useUser } from '../use-user';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import type { Comparison, PlanStep, Preview } from './ChangeoversTypes';

export type { Comparison, PlanStep, Preview };

function ComparisonTable({ rows }: { rows: Comparison[] }) {
  const groups: [string, string][] = [
    ['component', 'Component replacements'],
    ['parameter', 'Parameter adjustments'],
  ];
  return (
    <div className="space-y-3">
      {groups.map(([kind, title]) => {
        const items = rows.filter((r) => r.kind === kind);
        if (items.length === 0) return null;
        return (
          <div key={kind}>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              {title}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 text-xs uppercase">
                    <th className="py-1 pr-3">Parameter</th>
                    <th className="pr-3">Current</th>
                    <th className="pr-3">Target</th>
                    <th className="pr-3">Status</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr key={d.key} className="border-t border-slate-800">
                      <td className="py-1 pr-3">{d.label}</td>
                      <td className="pr-3 text-slate-400">{String(d.current_value ?? '—')}</td>
                      <td className="pr-3 font-semibold text-amber-200">
                        {String(d.target_value ?? '—')} {d.unit}
                      </td>
                      <td className="pr-3">
                        {d.change_required ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900 text-violet-200">
                            change required
                          </span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-200">
                            matching
                          </span>
                        )}
                      </td>
                      <td
                        className={`text-xs ${d.validation.status === 'valid' ? 'text-slate-500' : 'text-red-300'}`}
                      >
                        {d.validation.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ChangeoversPage() {
  const { operatorId } = useUser();
  const navigate = useNavigate();
  const machinesQuery = useMachines({ page_size: 50 });
  const productsQuery = useProducts({ page_size: 50 });
  const openQuery = useChangeovers({ page_size: 20 });
  const openItems = (openQuery.data?.items ?? []).filter((c: { status: string }) =>
    c.status === 'IN_PROGRESS' || c.status === 'FAILED');

  const [mid, setMid] = useState(MACHINE_ID);
  const machineState = useMachineState(mid);

  const [target, setTarget] = useState('B');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);

  const state = machineState.data;
  const machines: { id: string; name: string; status: string }[] = machinesQuery.data?.items ?? [];
  const products: { id: string; product_code: string; name: string }[] =
    productsQuery.data?.items ?? [];

  async function doPreview() {
    setErr('');
    try {
      setPreview(await API.preview(mid, target, operatorId));
    } catch (e) {
      setErr(getApiError(e));
    }
  }

  async function doCreate() {
    if (creating) return;
    setErr('');
    setCreating(true);
    try {
      const co = await API.create(mid, target, operatorId);
      navigate(`/changeovers/${co.id}`);
    } catch (e) {
      setErr(getApiError(e));
    } finally {
      setCreating(false);
    }
  }

  if (machinesQuery.isLoading || productsQuery.isLoading || machineState.isLoading)
    return <Loading label="Loading changeover data…" />;
  if (machinesQuery.isError)
    return <ErrorState error={machinesQuery.error} onRetry={() => machinesQuery.refetch()} />;
  if (productsQuery.isError)
    return <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />;
  if (machineState.isError)
    return <ErrorState error={machineState.error} onRetry={() => machineState.refetch()} />;

  const eligible = preview?.eligibility.eligible ?? true;

  return (
    <div className="space-y-3">
      {err && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg p-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 text-red-400" />
          <div className="break-words">{err}</div>
        </div>
      )}

      {/* Open changeovers -> workspace links */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2">Open changeovers (in progress or failed — resume in the workspace)</h3>
        {openQuery.isLoading && <Loading label="Loading open changeovers…" />}
        {openQuery.isError && (
          <ErrorState error={openQuery.error} onRetry={() => openQuery.refetch()} />
        )}
        {openQuery.data && openItems.length === 0 && (
          <EmptyState
            title="No open changeovers"
            detail="Compare configurations below and start one — execution happens in the operator workspace."
          />
        )}
        {openItems.map((c) => (
          <Link
            key={c.id}
            to={`/changeovers/${c.id}`}
            className="flex items-center gap-2 border border-slate-700 hover:border-amber-400 rounded-lg p-2.5 mb-2 text-sm"
          >
            <span className="font-mono">#{c.id}</span>
            <span>
              {c.machine_id} · {c.source_product_id} → {c.target_product_id}
            </span>
            <span className="text-xs text-slate-400">
              {c.tasks_completed}/{c.tasks_total} steps
            </span>
            <StatusBadge value={c.status} />
            <span className="ml-auto text-amber-300 text-xs">Open workspace →</span>
          </Link>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <ClipboardCheck size={16} /> Plan a changeover
        </h3>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={mid}
            onChange={(e) => {
              setMid(e.target.value);
              setPreview(null);
              setErr('');
            }}
            aria-label="Select machine"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          >
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} — {m.name} ({m.status})
              </option>
            ))}
          </select>
          <div className="text-sm text-slate-300">
            Current: <b>{state?.product_id ?? '?'}</b>
          </div>
          <ArrowRight size={16} className="text-slate-500" />
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Select target product"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.product_code} — {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={doPreview}
            className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm"
          >
            Compare configurations
          </button>
        </div>

        {preview && (
          <div className="mt-4 space-y-3">
            {preview.eligibility.errors.length > 0 && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-sm">
                <div className="font-semibold text-red-200">Not eligible for changeover</div>
                {preview.eligibility.errors.map((w, i) => (
                  <div key={i}>→ {w}</div>
                ))}
              </div>
            )}
            {preview.eligibility.warnings.length > 0 && (
              <div className="bg-amber-950/60 border border-amber-800 rounded-lg p-2.5 text-sm text-amber-200">
                {preview.eligibility.warnings.map((w, i) => (
                  <div key={i}>→ {w}</div>
                ))}
              </div>
            )}
            {preview.no_change_required ? (
              <div className="bg-emerald-950/60 border border-emerald-800 rounded-lg p-3 text-sm text-emerald-200">
                No change required — {preview.machine.id} already matches {preview.target_product.id}.
                You may still start a changeover to record a verification-only run.
              </div>
            ) : (
              <>
                <ComparisonTable rows={preview.comparison} />
                <div className="text-sm">
                  <span className="font-semibold">{preview.change_count} changes required</span>
                  <span className="text-slate-400">
                    {' '}
                    · {preview.tasks.length} planned steps · est.{' '}
                    {Math.round(preview.estimated_duration_seconds / 60)} min
                  </span>
                </div>
                <div className="text-xs text-slate-500">{preview.duration_estimate_note}</div>
                <div className="border border-slate-700 rounded-lg divide-y divide-slate-800">
                  {preview.tasks.map((t) => (
                    <div key={t.step_id} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-slate-400">{t.step_id}</span>
                        <span className="font-medium">{t.description}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {t.category}
                        </span>
                        <span className="ml-auto text-xs text-slate-400">
                          est. {t.expected_duration_seconds}s
                          {t.requires_confirmation ? ' · needs confirmation' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button
              onClick={doCreate}
              disabled={!eligible || creating}
              title={eligible ? 'Start changeover' : 'Resolve eligibility errors first'}
              className="bg-amber-400 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-40"
            >
              <Play size={14} /> {creating ? 'Starting…' : 'Start changeover'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
