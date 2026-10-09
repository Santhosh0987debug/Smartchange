import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight, ClipboardCheck, Play, AlertTriangle, GitCompareArrows,
  ArrowLeftRight, CheckCircle2, OctagonAlert, Info,
} from 'lucide-react';
import { API, getApiError } from '../api';
import { MACHINE_ID, useChangeovers, useMachineState, useMachines, useProducts } from '../queries';
import { useUser } from '../use-user';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import TooltipTip from '../components/Tooltip';
import { SkeletonRows } from '../components/Skeleton';
import StepTimeline from '../components/StepTimeline';
import ProgressBar from '../components/ProgressBar';
import { useToast } from '../components/Toast';
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
        const changed = items.filter((r) => r.change_required).length;
        return (
          <div key={kind}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="eyebrow">{title}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
                changed > 0
                  ? 'border-blue-800 bg-blue-950/50 text-blue-200'
                  : 'border-emerald-800 bg-emerald-950/50 text-emerald-200'
              }`}>
                {changed} of {items.length} change{items.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="table-wrap border border-slate-800 rounded-lg overflow-hidden">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Current</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr key={d.key} className={d.change_required ? 'diff-row-change' : 'diff-row-same'}>
                      <td>
                        <span className="font-medium text-slate-200">{d.label}</span>
                        <span className="block text-[11px] text-slate-500 font-mono">{d.key}</span>
                      </td>
                      <td className="text-slate-400 tabular-nums">{String(d.current_value ?? '—')}</td>
                      <td className="font-semibold text-blue-200 tabular-nums">
                        {String(d.target_value ?? '—')}{' '}
                        <span className="text-[11px] font-normal text-slate-500">{d.unit}</span>
                      </td>
                      <td>
                        {d.change_required ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-950/70 border border-blue-800 text-blue-200 font-semibold whitespace-nowrap">
                            <ArrowLeftRight size={11} /> change required
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-200 font-semibold whitespace-nowrap">
                            <CheckCircle2 size={11} /> matching
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
  const toast = useToast();
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
  const [previewing, setPreviewing] = useState(false);

  const state = machineState.data;
  const machines: { id: string; name: string; status: string }[] = machinesQuery.data?.items ?? [];
  const products: { id: string; product_code: string; name: string }[] =
    productsQuery.data?.items ?? [];

  async function doPreview() {
    setErr('');
    setPreviewing(true);
    try {
      setPreview(await API.preview(mid, target, operatorId));
    } catch (e) {
      setErr(getApiError(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function doCreate() {
    if (creating) return;
    setErr('');
    setCreating(true);
    try {
      const co = await API.create(mid, target, operatorId);
      toast.success(`Changeover #${co.id} started — opening the operator workspace.`);
      navigate(`/changeovers/${co.id}`);
    } catch (e) {
      const msg = getApiError(e);
      setErr(msg);
      toast.error(msg);
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
    <div className="space-y-4">
      <PageHeader
        title="Changeover planning"
        subtitle="Compare configurations, review the generated plan, then execute it in the operator workspace."
      />
      {err && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg p-3 text-sm rise-in">
          <AlertTriangle size={16} className="mt-0.5 text-red-400 shrink-0" />
          <div className="break-words">{err}</div>
        </div>
      )}

      {/* Open changeovers -> workspace links */}
      <Card>
        <div className="card-title mb-0.5">
          <ClipboardCheck size={16} /> Open changeovers
        </div>
        <p className="card-sub mb-2">In progress or failed — resume execution in the operator workspace.</p>
        {openQuery.isLoading && <SkeletonRows count={3} />}
        {openQuery.isError && (
          <ErrorState error={openQuery.error} onRetry={() => openQuery.refetch()} />
        )}
        {openQuery.data && openItems.length === 0 && (
          <EmptyState
            title="No open changeovers"
            detail="Compare configurations below and start one — execution happens in the operator workspace."
          />
        )}
        {openItems.map((c) => {
          const pct = c.tasks_total ? Math.round((c.tasks_completed / c.tasks_total) * 100) : 0;
          return (
            <Link
              key={c.id}
              to={`/changeovers/${c.id}`}
              className="block border border-slate-700 hover:border-blue-600 hover:bg-slate-800/50 rounded-lg p-2.5 mb-2 text-sm transition-all hover:-translate-y-px"
            >
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold">#{c.id}</span>
                <span>
                  <b className="font-mono">{c.machine_id}</b> · {c.source_product_id} → {c.target_product_id}
                </span>
                <span className="ml-auto">
                  <StatusBadge value={c.status} />
                </span>
              </span>
              <span className="flex items-center gap-2 mt-2">
                <span className="flex-1 min-w-24">
                  <ProgressBar percent={pct} label={`Changeover ${c.id} progress`} />
                </span>
                <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                  {c.tasks_completed}/{c.tasks_total} steps · {pct}%
                </span>
                <span className="text-blue-300 text-xs font-medium whitespace-nowrap">Open workspace →</span>
              </span>
            </Link>
          );
        })}
      </Card>

      <Card>
        <div className="card-title mb-0.5">
          <ClipboardCheck size={16} /> Plan a changeover
        </div>
        <p className="card-sub mb-3">The backend diffs the latest verified state against the approved target configuration.</p>
        {/* Machine vs target comparison strip */}
        <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-2 items-stretch mb-3">
          <label className="rounded-lg border border-slate-700 bg-slate-800/50 p-2.5 block">
            <span className="eyebrow block mb-1">Current machine</span>
            <select
              value={mid}
              onChange={(e) => {
                setMid(e.target.value);
                setPreview(null);
                setErr('');
              }}
              aria-label="Select machine"
              className="input"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.name} ({m.status})
                </option>
              ))}
            </select>
            <span className="block text-xs text-slate-400 mt-1.5">
              Running product <b className="text-slate-200 font-mono">{state?.product_id ?? '?'}</b>
            </span>
          </label>
          <div className="flex sm:flex-col items-center justify-center gap-1 text-slate-500">
            <span className="rounded-full border border-slate-700 bg-slate-800 p-2">
              <ArrowLeftRight size={15} className="text-cyan-300" />
            </span>
            <span className="text-[10px] uppercase tracking-wider font-semibold hidden sm:block">to</span>
          </div>
          <label className="rounded-lg border border-blue-900/70 bg-blue-950/30 p-2.5 block">
            <span className="eyebrow block mb-1 !text-blue-300/80">Target product</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Select target product"
              className="input"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_code} — {p.name}
                </option>
              ))}
            </select>
            <span className="block text-xs text-slate-400 mt-1.5">
              Approved configuration revision applies on finalize.
            </span>
          </label>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" onClick={doPreview} loading={previewing}>
            <GitCompareArrows size={14} /> Compare configurations
          </Button>
          {preview && (
            <span className="text-xs text-slate-500 self-center">
              Preview is read-only — nothing is written until you start the changeover.
            </span>
          )}
        </div>

        {preview && (
          <div className="mt-4 space-y-3 rise-in">
            {preview.eligibility.errors.length > 0 && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg p-3 text-sm">
                <div className="font-semibold text-red-200 flex items-center gap-1.5">
                  <OctagonAlert size={15} /> Not eligible for changeover
                </div>
                {preview.eligibility.errors.map((w, i) => (
                  <div key={i} className="mt-0.5">→ {w}</div>
                ))}
              </div>
            )}
            {preview.eligibility.warnings.length > 0 && (
              <div className="bg-amber-950/60 border border-amber-800 rounded-lg p-3 text-sm text-amber-200">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={15} /> Warnings — proceed with care
                </div>
                {preview.eligibility.warnings.map((w, i) => (
                  <div key={i} className="mt-0.5">→ {w}</div>
                ))}
              </div>
            )}
            {preview.no_change_required ? (
              <div className="bg-emerald-950/60 border border-emerald-800 rounded-lg p-3 text-sm text-emerald-200">
                <div className="font-semibold flex items-center gap-1.5">
                  <CheckCircle2 size={15} /> No change required
                </div>
                {preview.machine.id} already matches {preview.target_product.id}.
                You may still start a changeover to record a verification-only run.
              </div>
            ) : (
              <>
                {/* Route summary strip */}
                <div className="flex items-center gap-2 flex-wrap rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm">
                  <span className="font-mono font-semibold">{preview.machine.id}</span>
                  <ArrowRight size={14} className="text-slate-500" />
                  <span className="font-semibold text-blue-200">{preview.target_product.id}</span>
                  <span className="text-xs text-slate-500">{preview.target_product.name}</span>
                  <TooltipTip label={preview.duration_estimate_note} icon>
                    <span className="ml-auto text-xs text-slate-400">
                      <b className="text-slate-100 tabular-nums">{preview.change_count}</b> changes ·{' '}
                      <b className="text-slate-100 tabular-nums">{preview.tasks.length}</b> steps · est.{' '}
                      <b className="text-slate-100 tabular-nums">{Math.round(preview.estimated_duration_seconds / 60)} min</b>
                    </span>
                  </TooltipTip>
                </div>
                <ComparisonTable rows={preview.comparison} />
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Info size={12} /> {preview.duration_estimate_note}
                </div>
                <h4 className="eyebrow mt-1">
                  Ordered plan — safety → components → parameters → verification
                </h4>
                <StepTimeline
                  steps={preview.tasks.map((t) => ({
                    id: t.step_id,
                    label: `${t.step_id} · ${t.description}`,
                    sub: `${t.category} · est. ${t.expected_duration_seconds}s${t.requires_confirmation ? ' · needs confirmation' : ''}`,
                    status: 'PENDING',
                  }))}
                />
              </>
            )}
            <Button
              onClick={doCreate}
              disabled={!eligible}
              loading={creating}
              title={eligible ? 'Start changeover' : 'Resolve eligibility errors first'}
            >
              <Play size={14} /> Start changeover
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
