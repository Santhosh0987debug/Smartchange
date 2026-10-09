import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle,
  ShieldCheck, Wrench, Gauge, Play, ArrowLeft, FileText, History as HistoryIcon,
} from 'lucide-react';
import { API, getApiError, type AuditEntry, type Issue } from '../api';
import { queryClient, useSession, useSimulation, useVerification } from '../queries';
import { useUser } from '../use-user';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ConfirmDialog, Field, Modal, inputCls } from '../components/Dialog';

const SEVERITIES = ['info', 'minor', 'major', 'critical'];

function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m} min${s % 60 ? ` ${s % 60}s` : ''}`;
}

export default function ExecutionPage() {
  const { id } = useParams();
  const cid = Number(id);
  const { operatorId } = useUser();
  const sessionQuery = useSession(Number.isFinite(cid) ? cid : null);
  const simQuery = useSimulation(Number.isFinite(cid) ? cid : null);
  const verQuery = useVerification(Number.isFinite(cid) ? cid : null);

  const [stepIdx, setStepIdx] = useState(0);
  const [params, setParams] = useState<Record<string, string>>({});
  const [verifyRes, setVerifyRes] = useState<{
    checks: { check_name: string; expected_value: string; actual_value: string; result: string }[];
    guidance?: string[];
  } | null>(null);
  const [report, setReport] = useState<{
    status: string;
    machine_id: string;
    new_product: string;
    actual_duration_seconds: number;
    note: string;
  } | null>(null);
  const [err, setErr] = useState('');
  const [issueText, setIssueText] = useState('');
  const [issueSeverity, setIssueSeverity] = useState('minor');
  const [failReason, setFailReason] = useState('');
  const [showFail, setShowFail] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [resolving, setResolving] = useState<number | null>(null);

  const session = sessionQuery.data;

  // Focus the first eligible pending step when a session loads.
  useEffect(() => {
    if (session) {
      const firstOpen = session.tasks.findIndex(
        (t: { status: string }) => t.status !== 'COMPLETED',
      );
      setStepIdx(firstOpen >= 0 ? firstOpen : 0);
      const wc: Record<string, unknown> = (session.working_config?.parameters ?? {}) as Record<string, unknown>;
      setParams({
        speed_rpm: String(wc.speed_rpm ?? ''),
        temperature_c: String(wc.temperature_c ?? ''),
        pressure_bar: String(wc.pressure_bar ?? ''),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['session', cid] });
    queryClient.invalidateQueries();
  }

  const busy = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setErr('');
      refresh();
    },
    onError: (e) => setErr(getApiError(e)),
  });

  async function runVerify() {
    setErr('');
    try {
      setVerifyRes(await API.verify(cid));
      refresh();
    } catch (e) {
      setErr(getApiError(e));
    }
  }

  async function finish() {
    setErr('');
    try {
      setReport(await API.complete(cid, operatorId));
      refresh();
    } catch (e) {
      setErr(getApiError(e));
      refresh();
    }
  }

  if (!Number.isFinite(cid)) return <ErrorState error="Invalid changeover ID in URL." />;
  if (sessionQuery.isLoading) return <Loading label="Loading workspace…" />;
  if (sessionQuery.isError)
    return <ErrorState error={sessionQuery.error} onRetry={() => sessionQuery.refetch()} />;
  if (!session) return <EmptyState title="Changeover not found" />;

  const tasks = session.tasks ?? [];
  const cur = tasks[stepIdx];
  const progress = session.progress ?? {
    total: tasks.length,
    completed: 0,
    in_progress: 0,
    failed: 0,
    pending: tasks.length,
    percent: 0,
    estimated_remaining_seconds: 0,
  };
  const openIssues: Issue[] = (session.issues ?? []).filter(
    (i: Issue) => i.resolution_status === 'OPEN',
  );
  const criticalOpen = openIssues.filter((i) => i.severity === 'critical');

  return (
    <div className="space-y-3">
      <Link to="/changeovers" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft size={14} /> Back to changeovers
      </Link>
      {err && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg p-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 text-red-400" />
          <div className="break-words">{err}</div>
        </div>
      )}

      {/* Workspace header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        {(session.status === 'COMPLETED' || session.status === 'ABANDONED') && (
          <div className="mb-2 text-sm text-slate-300 bg-slate-800 rounded-lg p-2.5">
            This changeover is {session.status.toLowerCase()} — the workspace is read-only. History,
            verification runs, and the audit trail below remain available.
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-lg">Changeover #{session.id}</h2>
          <StatusBadge value={session.status} />
          <span className="text-xs text-slate-400 ml-auto">
            {progress.completed}/{progress.total} done · {progress.percent}% · est. remaining{' '}
            {fmtSecs(progress.estimated_remaining_seconds)}
          </span>
        </div>
        <div className="text-sm text-slate-300 mt-1">
          {session.machine_id} · {session.source_product_id} → {session.target_product_id} ·
          operator {session.operator_id}
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
          <div className="h-full bg-amber-400 transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="flex gap-3 mt-1.5 text-xs text-slate-400">
          <span>{progress.pending} pending</span>
          <span className="text-sky-300">{progress.in_progress} in progress</span>
          {progress.failed > 0 && <span className="text-red-300">{progress.failed} failed</span>}
        </div>
        {criticalOpen.length > 0 && (
          <div className="mt-2 bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-sm text-red-200">
            Execution blocked — {criticalOpen.length} open critical issue(s). Resolve them below to
            continue.
          </div>
        )}
      </div>

      {/* Active task + task list */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2">Steps</h3>
        {tasks.length === 0 && (
          <div className="text-sm text-emerald-200 bg-emerald-950/50 rounded-lg p-2.5">
            No change required — run verification below to confirm the state still matches, then
            complete.
          </div>
        )}
        {cur && (
          <div className="border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
              <span>
                Step {stepIdx + 1} of {tasks.length} · {cur.task_type} · {cur.step_id}
              </span>
              <StatusBadge value={cur.status} />
            </div>
            <div className="font-semibold text-lg">{cur.description}</div>
            {cur.instructions && <div className="text-sm text-slate-300">{cur.instructions}</div>}
            {(cur.current_value != null || cur.target_value != null) && (
              <div className="text-sm text-amber-200 mt-1">
                {cur.current_value ?? '—'} → {cur.target_value ?? '—'}
              </div>
            )}
            {cur.verification_criteria && (
              <div className="text-xs text-slate-400 mt-1">Acceptance: {cur.verification_criteria}</div>
            )}
            {cur.safety_notes && (
              <div className="text-xs text-red-300 mt-1 flex gap-1">
                <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                {cur.safety_notes}
              </div>
            )}
            {cur.prerequisites?.length > 0 && (
              <div className="text-xs text-slate-400 mt-1">
                Prerequisites: steps {cur.prerequisites.join(', ')}
                {cur.requires_confirmation ? ' · operator confirmation required' : ''}
              </div>
            )}
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
                disabled={stepIdx === 0}
                className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              {cur.status === 'PENDING' && (
                <button
                  onClick={() => busy.mutate(() => API.stepStart(cid, cur.id, operatorId))}
                  disabled={busy.isPending}
                  className="flex items-center gap-1 bg-sky-600 hover:bg-sky-500 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  <Play size={14} /> Start step
                </button>
              )}
              {cur.status === 'IN_PROGRESS' && (
                <>
                  <button
                    onClick={() => busy.mutate(() => API.stepComplete(cid, cur.id, operatorId))}
                    disabled={busy.isPending}
                    className="flex items-center gap-1 bg-emerald-500 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    <Wrench size={14} /> Confirm completion
                  </button>
                  <button
                    onClick={() => {
                      setFailReason('');
                      setShowFail(true);
                    }}
                    className="flex items-center gap-1 bg-slate-800 border border-red-800 text-red-300 rounded-lg px-3 py-1.5 text-sm"
                  >
                    <XCircle size={14} /> Record failure
                  </button>
                </>
              )}
              {cur.status === 'FAILED' && (
                <button
                  onClick={() => busy.mutate(() => API.stepStart(cid, cur.id, operatorId))}
                  disabled={busy.isPending}
                  className="flex items-center gap-1 bg-sky-600 hover:bg-sky-500 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  <Play size={14} /> Retry step
                </button>
              )}
              {cur.status === 'COMPLETED' && (
                <span className="flex items-center gap-1 text-sm text-emerald-300">
                  <CheckCircle2 size={14} /> Confirmed
                </span>
              )}
              <button
                onClick={() => setStepIdx(Math.min(tasks.length - 1, stepIdx + 1))}
                disabled={stepIdx >= tasks.length - 1}
                className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
            {/* Execution note */}
            <div className="flex gap-2 mt-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add an execution note to this step…"
                aria-label="Execution note"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
              />
              <button
                onClick={() =>
                  busy.mutate(async () => {
                    await API.stepNote(cid, cur.id, noteText, operatorId);
                    setNoteText('');
                  })
                }
                disabled={busy.isPending || !noteText.trim()}
                className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Add note
              </button>
            </div>
          </div>
        )}
        {tasks.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {tasks.map((t: { id: number; step_id: string; description: string; status: string }, i: number) => (
              <li key={t.id}>
                <button
                  onClick={() => setStepIdx(i)}
                  className={`w-full text-left px-2 py-1 rounded flex items-center gap-2 text-[13px] ${i === stepIdx ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
                >
                  {t.status === 'COMPLETED' ? (
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  ) : t.status === 'FAILED' ? (
                    <XCircle size={14} className="text-red-400 shrink-0" />
                  ) : t.status === 'IN_PROGRESS' ? (
                    <Play size={14} className="text-sky-400 shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-slate-500 inline-block shrink-0" />
                  )}
                  <span className="text-slate-400 font-mono">{t.step_id}</span>
                  <span className="truncate">{t.description}</span>
                  <span className="ml-auto">
                    <StatusBadge value={t.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Simulator: initial vs target vs simulated */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Gauge size={16} /> Simulation — initial vs target vs simulated
        </h3>
        <div className="text-xs text-amber-200/90 mb-2">
          SIMULATED values only — the official machine state changes solely on finalize, after
          verification passes.
        </div>
        {simQuery.isLoading && <Loading label="Loading simulation…" />}
        {simQuery.isError && <ErrorState error={simQuery.error} onRetry={() => simQuery.refetch()} />}
        {simQuery.data && (
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            {(
              [
                ['Initial (at start)', simQuery.data.initial],
                ['Target (approved)', simQuery.data.target],
                [
                  `Simulated (${simQuery.data.simulated_status})`,
                  simQuery.data.simulated,
                ],
              ] as const
            ).map(([title, cfg]) => (
              <div key={title} className="bg-slate-800 rounded-lg p-2.5">
                <div className="font-semibold text-slate-200 mb-1">{title}</div>
                <div className="text-slate-400">Nozzle: {String(cfg.components.nozzle)}</div>
                <div className="text-slate-400">Fixture: {String(cfg.components.fixture)}</div>
                <div className="text-slate-400">
                  Speed: {String(cfg.parameters.speed_rpm)} RPM · Temp:{' '}
                  {String(cfg.parameters.temperature_c)}°C · Press:{' '}
                  {String(cfg.parameters.pressure_bar)} bar
                </div>
              </div>
            ))}
          </div>
        )}
        {simQuery.data?.simulated_at && (
          <div className="text-[11px] text-slate-500 mt-1">
            Last simulated application: {simQuery.data.simulated_at}
          </div>
        )}
      </div>

      {/* Simulator editor + verification */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Gauge size={16} /> Simulated configuration editor
          </h3>
          <div className="text-xs text-slate-400 mb-2">
            Requested ≠ applied ≠ verified. Values validate against approved ranges server-side,
            and only an explicit Apply touches the simulation.
          </div>
          {session.working_config ? (
            <>
              {[
                ['speed_rpm', 'Speed (RPM)'],
                ['temperature_c', 'Temperature (°C)'],
                ['pressure_bar', 'Pressure (bar)'],
              ].map(([k, label]) => (
                <label key={k} className="block text-sm mb-2">
                  <span className="text-slate-300">
                    {label} — target {String(session.target_config?.parameters?.[k] ?? '?')}
                  </span>
                  <input
                    value={params[k] ?? ''}
                    onChange={(e) => setParams({ ...params, [k]: e.target.value })}
                    inputMode="decimal"
                    className="mt-0.5 w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5"
                  />
                </label>
              ))}
              <button
                onClick={() =>
                  busy.mutate(async () => {
                    const nums: Record<string, number> = {};
                    for (const [k, v] of Object.entries(params)) if (v !== '') nums[k] = Number(v);
                    await API.applyConfig(cid, nums, operatorId);
                  })
                }
                disabled={busy.isPending}
                className="bg-sky-500 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Apply configuration
              </button>
              <div className="text-xs text-slate-400 mt-2">
                Working: {JSON.stringify(session.working_config?.parameters)}{' '}
              </div>
            </>
          ) : (
            <EmptyState title="Nothing to simulate" detail="This plan has no parameter steps." />
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck size={16} /> Verification &amp; finalization
          </h3>
          <div className="flex items-center gap-2 text-sm mb-2">
            <span className="text-slate-400">Overall status:</span>
            {verQuery.isLoading ? (
              <span className="text-xs text-slate-500">checking…</span>
            ) : verQuery.isError ? (
              <span className="text-xs text-red-300">unavailable</span>
            ) : (
              <StatusBadge value={verQuery.data?.overall ?? 'PENDING'} />
            )}
          </div>
          <div className="text-xs text-slate-400 mb-2">
            Task confirmations alone never complete a changeover — final verification must pass.
            Software simulation only.
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={runVerify}
              className="bg-violet-500 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm"
            >
              Run verification
            </button>
            <button
              onClick={() => setShowFinalize(true)}
              className="bg-emerald-400 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm"
            >
              Finalize changeover
            </button>
            <button
              onClick={() => busy.mutate(() => API.abandon(cid))}
              disabled={busy.isPending}
              className="bg-slate-700 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Abandon
            </button>
          </div>
          {(verifyRes ?? (session.verification && session.verification.length > 0)) && (
            <div className="mt-2 space-y-1 text-sm max-h-56 overflow-auto">
              {(verifyRes?.checks ?? session.verification ?? []).map(
                (
                  c: { check_name: string; expected_value: string; actual_value: string; result: string; reason?: string | null },
                  i: number,
                ) => (
                <div
                  key={i}
                  className={`rounded px-2 py-1 ${c.result === 'PASS' ? 'bg-emerald-950/50 text-emerald-200' : 'bg-red-950/50 text-red-200'}`}
                >
                  <div className="flex items-center gap-2">
                    {c.result === 'PASS' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    <span className="font-mono text-xs">{c.check_name}</span>
                    <span className="ml-auto text-xs">
                      exp {c.expected_value} / got {c.actual_value ?? '—'}
                    </span>
                  </div>
                  {c.reason && <div className="text-xs mt-0.5 ml-5">→ {c.reason}</div>}
                </div>
              ))}
            </div>
          )}
          {(verQuery.data?.runs ?? []).length > 1 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-slate-400">
                Verification history ({verQuery.data?.runs.length} runs — reruns never erase history)
              </summary>
              <ul className="mt-1 space-y-1 text-xs">
                {(verQuery.data?.runs ?? []).map((r) => (
                  <li key={r.run} className="border border-slate-800 rounded px-2 py-1">
                    <span className="font-mono">run {r.run}</span> · {r.at} ·{' '}
                    <StatusBadge value={r.passed ? 'VERIFIED' : 'FAILED'} /> · {r.checks.length} checks
                  </li>
                ))}
              </ul>
            </details>
          )}
          {verifyRes?.guidance?.map((g, i) => (
            <div key={i} className="text-xs text-amber-200 mt-1">
              → {g}
            </div>
          ))}
          {report && (
            <div className="mt-2 bg-emerald-950/60 border border-emerald-800 rounded-lg p-2.5 text-sm">
              <div className="font-semibold text-emerald-200 flex items-center gap-1">
                <CheckCircle2 size={15} /> Changeover report — {report.status}
              </div>
              <div>
                Machine {report.machine_id} now on Product {report.new_product} ·{' '}
                {report.actual_duration_seconds}s
              </div>
              <div className="text-xs text-slate-400">{report.note}</div>
            </div>
          )}
        </div>
      </div>

      {/* Issues */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle size={16} /> Issues {openIssues.length > 0 && `(${openIssues.length} open)`}
        </h3>
        {openIssues.length === 0 && (
          <div className="text-sm text-slate-500">No open issues on this changeover.</div>
        )}
        {openIssues.map((i) => (
          <div key={i.id} className="border border-slate-700 rounded-lg p-2.5 mb-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-slate-400">#{i.id}</span>
              <StatusBadge value={i.severity === 'critical' ? 'FAILED' : 'OPEN'} />
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                {i.severity} · {i.category}
                {i.task_id ? ` · step task ${i.task_id}` : ''}
              </span>
              <button
                onClick={() => setResolving(i.id)}
                className="ml-auto text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-2 py-1"
              >
                Resolve
              </button>
            </div>
            <div className="mt-1">{i.description}</div>
            <div className="text-xs text-slate-500">Opened {i.created_at}</div>
          </div>
        ))}
        <IssueForm
          cid={cid}
          taskId={cur?.id}
          operatorId={operatorId}
          issueText={issueText}
          setIssueText={setIssueText}
          severity={issueSeverity}
          setSeverity={setIssueSeverity}
          onDone={refresh}
          onError={setErr}
        />
        {(session.issues ?? []).filter((i: Issue) => i.resolution_status !== 'OPEN').length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-slate-400">Resolved issues</summary>
            <ul className="mt-1 text-xs text-slate-500 list-disc ml-5">
              {(session.issues ?? [])
                .filter((i: Issue) => i.resolution_status !== 'OPEN')
                .map((i: Issue) => (
                  <li key={i.id}>
                    #{i.id} [{i.severity}] {i.description}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>

      {/* Audit trail */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <HistoryIcon size={16} /> Audit trail ({(session.audit_trail ?? []).length})
        </h3>
        {(session.audit_trail ?? []).length === 0 && (
          <div className="text-sm text-slate-500">No audit entries yet.</div>
        )}
        <ul className="text-xs space-y-1 max-h-64 overflow-auto">
          {(session.audit_trail ?? []).map((a: AuditEntry, i: number) => (
            <li key={i} className="flex gap-2 border-b border-slate-800/60 pb-1">
              <span className="text-slate-500 shrink-0">{a.at}</span>
              <span className="font-mono text-slate-300 shrink-0">{a.action}</span>
              <span className="text-slate-400 truncate">
                {a.entity} {a.entity_id} · {a.actor}
                {a.details && typeof a.details.seq === 'number' ? ` · step ${a.details.seq}` : ''}
                {typeof a.details?.previous === 'string' ? ` · ${a.details.previous} → ${a.details.new}` : ''}
                {typeof a.details?.reason === 'string' ? ` · reason: ${a.details.reason}` : ''}
                {typeof a.details?.note === 'string' ? ` · “${(a.details.note as string).slice(0, 120)}”` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {showFail && cur && (
        <Modal title={`Record failure — ${cur.step_id}`} onClose={() => setShowFail(false)}>
          <Field label="Failure reason (required)">
            <textarea
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              rows={3}
              placeholder="What went wrong?"
              className={inputCls}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowFail(false)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                busy.mutate(async () => {
                  await API.stepFail(cid, cur.id, failReason, operatorId);
                  setShowFail(false);
                  setFailReason('');
                })
              }
              disabled={busy.isPending || !failReason.trim()}
              className="bg-red-500 hover:bg-red-400 text-slate-950 font-semibold rounded-lg px-4 py-1.5 text-sm disabled:opacity-50"
            >
              Confirm failure
            </button>
          </div>
        </Modal>
      )}

      {showFinalize && (
        <ConfirmDialog
          title="Finalize changeover?"
          message="Finalization re-verifies everything and, only if all checks pass, writes the simulated values as the new official machine state. This cannot be undone."
          confirmLabel="Finalize"
          busy={busy.isPending}
          onCancel={() => setShowFinalize(false)}
          onConfirm={() =>
            busy.mutate(async () => {
              await finish();
              setShowFinalize(false);
            })
          }
        />
      )}

      {resolving !== null && (
        <ConfirmDialog
          title="Resolve issue?"
          message="Resolution in this prototype is simulated and attributed in the audit log — there is no role-based authorization yet."
          confirmLabel="Resolve"
          busy={busy.isPending}
          onCancel={() => setResolving(null)}
          onConfirm={() =>
            busy.mutate(async () => {
              await API.resolveIssue(resolving, operatorId);
              setResolving(null);
            })
          }
        />
      )}
    </div>
  );
}

function IssueForm({
  cid,
  taskId,
  operatorId,
  issueText,
  setIssueText,
  severity,
  setSeverity,
  onDone,
  onError,
}: {
  cid: number;
  taskId?: number;
  operatorId: string;
  issueText: string;
  setIssueText: (v: string) => void;
  severity: string;
  setSeverity: (v: string) => void;
  onDone: () => void;
  onError: (v: string) => void;
}) {
  const [confirmCritical, setConfirmCritical] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!issueText.trim() || busy) return;
    if (severity === 'critical' && !confirmCritical) {
      setConfirmCritical(true);
      return;
    }
    setBusy(true);
    try {
      await API.reportIssue(cid, issueText, taskId, 'general', severity, operatorId);
      setIssueText('');
      setConfirmCritical(false);
      onDone();
    } catch (e) {
      onError(getApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2 flex-wrap">
        <input
          value={issueText}
          onChange={(e) => setIssueText(e.target.value)}
          placeholder="Describe the issue…"
          aria-label="Issue description"
          className="flex-1 min-w-40 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label="Issue severity"
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={submit}
          disabled={busy || !issueText.trim()}
          className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? 'Reporting…' : 'Report issue'}
        </button>
      </div>
      {confirmCritical && (
        <div className="mt-2 bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-sm">
          <div className="flex items-start gap-2">
            <FileText size={15} className="text-red-300 mt-0.5" />
            <div>
              A <b>critical</b> issue blocks all further execution until resolved. Confirm?
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setConfirmCritical(false)}
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-1 text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="bg-red-500 text-slate-950 font-semibold rounded px-3 py-1 text-xs disabled:opacity-50"
                >
                  Confirm critical issue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
