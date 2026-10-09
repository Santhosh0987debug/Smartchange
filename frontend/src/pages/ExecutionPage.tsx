import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle,
  ShieldCheck, Wrench, Gauge, Play, ArrowLeft, ArrowRight as ArrowRightIcon,
  History as HistoryIcon, ClipboardCheck, Flag, FlaskConical, FileText,
} from 'lucide-react';
import { API, getApiError, type AuditEntry, type Issue } from '../api';
import { queryClient, useSession, useSimulation, useVerification } from '../queries';
import { useUser } from '../use-user';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import TooltipTip from '../components/Tooltip';
import Button from '../components/Button';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ProgressBar from '../components/ProgressBar';
import StepTimeline from '../components/StepTimeline';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Field, Modal, inputCls } from '../components/Dialog';

const SEVERITIES = ['info', 'minor', 'major', 'critical'];

function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m} min${s % 60 ? ` ${s % 60}s` : ''}`;
}

function taskIcon(taskType: string, label: string) {
  const t = `${taskType} ${label}`.toLowerCase();
  if (t.includes('safety') || t.includes('loto')) return <ShieldCheck size={18} className="text-red-300" />;
  if (t.includes('verif')) return <ClipboardCheck size={18} className="text-emerald-300" />;
  if (t.includes('param') || t.includes('speed') || t.includes('temp') || t.includes('press'))
    return <Gauge size={18} className="text-cyan-300" />;
  return <Wrench size={18} className="text-blue-300" />;
}

const PARAM_META: Record<string, { label: string; unit: string }> = {
  speed_rpm: { label: 'Speed', unit: 'RPM' },
  temperature_c: { label: 'Temperature', unit: '°C' },
  pressure_bar: { label: 'Pressure', unit: 'bar' },
};

/** Workflow stage rail: Plan → Execute → Simulate → Verify → Finalize. */
function StageRail({
  stage,
}: {
  stage: number; // 0..4 index of current stage
}) {
  const stages = ['Plan', 'Execute', 'Simulate', 'Verify', 'Finalize'];
  return (
    <div className="stage-rail mt-3" aria-label="Workflow progress">
      {stages.map((s, i) => (
        <div key={s} className={`stage-node ${i > 0 ? 'flex-1' : ''}`} style={i > 0 ? { display: 'contents' } : undefined}>
          {i > 0 && (
            <span className={`stage-link ${i <= stage ? 'done' : i === stage + 1 ? 'now' : ''}`} aria-hidden="true" />
          )}
          <span
            className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-full border px-2.5 py-1 whitespace-nowrap ${
              i < stage
                ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
                : i === stage
                  ? 'border-blue-600 bg-blue-600/20 text-white'
                  : 'border-slate-700 bg-slate-800/60 text-slate-400'
            }`}
            aria-current={i === stage ? 'step' : undefined}
          >
            {i < stage ? <CheckCircle2 size={12} /> : <span className="tabular-nums">{i + 1}</span>}
            {s}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ExecutionPage() {
  const { id } = useParams();
  const cid = Number(id);
  const { operatorId } = useUser();
  const toast = useToast();
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
      const v = await API.verify(cid);
      setVerifyRes(v);
      if (v.passed) toast.success(`Verification run ${v.run}: all checks passed.`);
      else toast.error(`Verification run ${v.run}: ${v.failures?.length ?? 0} check(s) failed.`);
      refresh();
    } catch (e) {
      const msg = getApiError(e);
      setErr(msg);
      toast.error(msg);
    }
  }

  async function finish() {
    setErr('');
    try {
      setReport(await API.complete(cid, operatorId));
      toast.success(`Changeover #${cid} finalized — machine is READY (simulated).`);
      refresh();
    } catch (e) {
      const msg = getApiError(e);
      setErr(msg);
      toast.error(msg);
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
  const readOnly = session.status === 'COMPLETED' || session.status === 'ABANDONED';

  // Derive workflow stage from real state (never fabricated).
  const verOverall: string | undefined = verQuery.data?.overall;
  const simApplied = Boolean(simQuery.data?.simulated_at);
  const verPassed = verOverall === 'VERIFIED' || verOverall === 'READY';
  const stage =
    session.status === 'COMPLETED' ? 4
    : verPassed ? 3
    : simApplied ? 2
    : progress.completed > 0 || progress.in_progress > 0 ? 1
    : 0;

  // Parameter relevant to the selected step (highlights the matching simulator row).
  const relevantParam: string | null =
    (cur?.parameter as string | null) ??
    (/speed/i.test(cur?.description ?? '') ? 'speed_rpm'
      : /temp/i.test(cur?.description ?? '') ? 'temperature_c'
      : /press/i.test(cur?.description ?? '') ? 'pressure_bar'
      : null);

  const sim = simQuery.data;
  const targetParams = (sim?.target?.parameters ?? {}) as Record<string, unknown>;
  const simulatedParams = (sim?.simulated?.parameters ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <Link to="/changeovers" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors">
        <ArrowLeft size={14} /> Back to changeovers
      </Link>
      {err && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg p-3 text-sm rise-in">
          <AlertTriangle size={16} className="mt-0.5 text-red-400 shrink-0" />
          <div className="break-words">{err}</div>
        </div>
      )}

      {/* Workspace header */}
      <Card>
        {readOnly && (
          <div className="mb-2 text-sm text-slate-300 bg-slate-800/80 border border-slate-700 rounded-lg p-2.5">
            This changeover is {session.status.toLowerCase()} — the workspace is read-only. History,
            verification runs, and the audit trail below remain available.
          </div>
        )}
        <PageHeader
          title={`Changeover #${session.id}`}
          subtitle={`${session.machine_id} · ${session.source_product_id} → ${session.target_product_id} · operator ${session.operator_id}`}
          actions={<StatusBadge value={session.status} />}
        />
        {/* Route strip: current vs target */}
        <div className="flex items-center gap-2 mt-2 rounded-lg border border-slate-700/80 bg-slate-800/40 px-3 py-2 text-sm flex-wrap">
          <span className="font-mono font-semibold">{session.machine_id}</span>
          <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-300">
            {session.source_product_id}
          </span>
          <ArrowRightIcon size={14} className="text-cyan-300" />
          <span className="rounded border border-blue-800 bg-blue-950/50 px-1.5 py-0.5 font-mono text-xs text-blue-100 font-semibold">
            {session.target_product_id}
          </span>
          <span className="ml-auto text-xs text-slate-400 tabular-nums">
            {progress.completed}/{progress.total} done · est. remaining {fmtSecs(progress.estimated_remaining_seconds)}
          </span>
        </div>
        <StageRail stage={stage} />
        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1">
            <ProgressBar percent={progress.percent} label={`Changeover ${session.id} progress`} />
          </div>
          <span className="text-sm font-bold tabular-nums text-blue-200">{progress.percent}%</span>
        </div>
        <div className="flex gap-3 mt-1.5 text-xs text-slate-400 flex-wrap">
          <span>{progress.pending} pending</span>
          <span className="text-sky-300">{progress.in_progress} in progress</span>
          {progress.failed > 0 && <span className="text-red-300">{progress.failed} failed</span>}
        </div>
        {criticalOpen.length > 0 && (
          <div className="mt-2 bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              Execution blocked — {criticalOpen.length} open critical issue(s). Resolve them below to
              continue.
            </span>
          </div>
        )}
      </Card>

      {/* Active task + task list */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-3">
        <Card>
          <div className="card-title mb-2">
            <Wrench size={16} /> Operator task
            <span className="ml-auto text-xs font-normal text-slate-500">
              {tasks.length > 0 ? `Step ${stepIdx + 1} of ${tasks.length}` : 'No steps'}
            </span>
          </div>
          {tasks.length === 0 && (
            <div className="text-sm text-emerald-200 bg-emerald-950/50 border border-emerald-800 rounded-lg p-2.5">
              No change required — run verification below to confirm the state still matches, then
              complete.
            </div>
          )}
          {cur && (
            <div className="border border-slate-700 rounded-xl p-3.5 bg-slate-800/30 rise-in" key={cur.id}>
              <div className="flex items-start gap-2.5">
                <span className="rounded-lg bg-slate-800 border border-slate-700 p-2 shrink-0">
                  {taskIcon(cur.task_type, cur.description)}
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap font-mono">
                    <span>{cur.task_type}</span>·<span>{cur.step_id}</span>
                    <StatusBadge value={cur.status} />
                  </div>
                  <div className="font-semibold text-[17px] tracking-tight mt-0.5">{cur.description}</div>
                  {cur.instructions && <div className="text-sm text-slate-300 mt-0.5">{cur.instructions}</div>}
                </div>
              </div>
              {(cur.current_value != null || cur.target_value != null) && (
                <div className="grid grid-cols-2 gap-2 mt-3 max-w-md">
                  <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2.5">
                    <div className="eyebrow">Current</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5 tabular-nums">{cur.current_value ?? '—'}</div>
                  </div>
                  <div className="rounded-lg border border-blue-800 bg-blue-950/40 p-2.5">
                    <div className="eyebrow !text-blue-300/80">Target</div>
                    <div className="text-sm font-semibold text-blue-100 mt-0.5 tabular-nums">{cur.target_value ?? '—'}</div>
                  </div>
                </div>
              )}
              {cur.verification_criteria && (
                <div className="text-xs text-slate-400 mt-2 flex gap-1.5">
                  <ClipboardCheck size={13} className="mt-0.5 shrink-0 text-emerald-300" />
                  <span><b className="text-slate-300">Acceptance:</b> {cur.verification_criteria}</span>
                </div>
              )}
              {cur.safety_notes && (
                <div className="text-xs text-red-200 mt-1.5 flex gap-1.5 rounded-lg border border-red-900/60 bg-red-950/40 px-2 py-1.5">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0 text-red-300" />
                  {cur.safety_notes}
                </div>
              )}
              {cur.prerequisites?.length > 0 && (
                <div className="text-xs text-slate-400 mt-1.5">
                  Prerequisites: steps {cur.prerequisites.join(', ')}
                  {cur.requires_confirmation ? ' · operator confirmation required' : ''}
                </div>
              )}
              {!readOnly && (
                <>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Button
                      variant="ghost"
                      onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
                      disabled={stepIdx === 0}
                    >
                      <ChevronLeft size={14} /> Prev
                    </Button>
                    {cur.status === 'PENDING' && (
                      <Button
                        variant="accent"
                        loading={busy.isPending}
                        onClick={() =>
                          busy.mutate(() => API.stepStart(cid, cur.id, operatorId), {
                            onSuccess: () => toast.info(`Step ${cur.step_id} started.`),
                          })
                        }
                      >
                        <Play size={14} /> Start step
                      </Button>
                    )}
                    {cur.status === 'IN_PROGRESS' && (
                      <>
                        <Button
                          variant="success"
                          loading={busy.isPending}
                          onClick={() =>
                            busy.mutate(() => API.stepComplete(cid, cur.id, operatorId), {
                              onSuccess: () => toast.success(`Step ${cur.step_id} confirmed complete.`),
                            })
                          }
                        >
                          <CheckCircle2 size={14} /> Confirm completion
                        </Button>
                        <Button
                          variant="danger-ghost"
                          onClick={() => {
                            setFailReason('');
                            setShowFail(true);
                          }}
                        >
                          <XCircle size={14} /> Record failure
                        </Button>
                      </>
                    )}
                    {cur.status === 'FAILED' && (
                      <Button
                        variant="accent"
                        loading={busy.isPending}
                        onClick={() =>
                          busy.mutate(() => API.stepStart(cid, cur.id, operatorId), {
                            onSuccess: () => toast.info(`Retrying step ${cur.step_id}.`),
                          })
                        }
                      >
                        <Play size={14} /> Retry step
                      </Button>
                    )}
                    {cur.status === 'COMPLETED' && (
                      <span className="flex items-center gap-1 text-sm text-emerald-300 font-medium">
                        <CheckCircle2 size={14} /> Confirmed
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => setStepIdx(Math.min(tasks.length - 1, stepIdx + 1))}
                      disabled={stepIdx >= tasks.length - 1}
                    >
                      Next <ChevronRight size={14} />
                    </Button>
                  </div>
                  {/* Execution note */}
                  <div className="flex gap-2 mt-2">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add an execution note to this step…"
                      aria-label="Execution note"
                      className="input flex-1"
                    />
                    <Button
                      variant="ghost"
                      loading={busy.isPending}
                      disabled={!noteText.trim()}
                      onClick={() =>
                        busy.mutate(
                          async () => {
                            await API.stepNote(cid, cur.id, noteText, operatorId);
                            setNoteText('');
                          },
                          { onSuccess: () => toast.success('Execution note recorded.') },
                        )
                      }
                    >
                      Add note
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
        {/* Step timeline rail */}
        <Card className="!p-3.5">
          <div className="card-title mb-2 !text-[13px]">
            <Flag size={14} /> Step timeline
          </div>
          {tasks.length > 0 ? (
            <div className="max-h-[520px] overflow-auto pr-1">
              <StepTimeline
                steps={tasks.map(
                  (t: { id: number; step_id: string; description: string; status: string; task_type: string }, i: number) => ({
                    id: t.id,
                    label: `${t.step_id} · ${t.description}`,
                    sub: t.task_type,
                    status: t.status,
                    active: i === stepIdx,
                    onSelect: () => setStepIdx(i),
                  }),
                )}
              />
            </div>
          ) : (
            <EmptyState title="No steps" detail="Verification-only run." />
          )}
        </Card>
      </div>

      {/* Simulator: initial vs target vs simulated */}
      <Card>
        <div className="card-title mb-0.5">
          <FlaskConical size={16} /> Configuration simulator
          <TooltipTip label="SIMULATED values only. The official machine state changes solely on finalize, after verification passes." icon>
            <span className="eyebrow">initial → target → simulated</span>
          </TooltipTip>
        </div>
        <p className="card-sub mb-2">
          {relevantParam
            ? <>Highlighted row matches the selected step (<b className="font-mono text-cyan-300">{relevantParam}</b>).</>
            : 'Apply values to the simulation — official state is untouched until finalize.'}
        </p>
        {simQuery.isLoading && <Loading label="Loading simulation…" />}
        {simQuery.isError && <ErrorState error={simQuery.error} onRetry={() => simQuery.refetch()} />}
        {sim && (
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            {(
              [
                ['Initial · at start', sim.initial, false],
                ['Target · approved', sim.target, false],
                [`Simulated · ${sim.simulated_status}`, sim.simulated, true],
              ] as const
            ).map(([title, cfg]) => (
              <div
                key={title}
                className={`rounded-xl border p-3 ${
                  String(title).startsWith('Simulated')
                    ? 'border-cyan-900/70 bg-cyan-950/20'
                    : String(title).startsWith('Target')
                      ? 'border-blue-900/70 bg-blue-950/20'
                      : 'border-slate-700 bg-slate-800/50'
                }`}
              >
                <div className="font-semibold text-slate-100 mb-2 text-[13px]">{title}</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Nozzle</span>
                    <span className="font-mono text-slate-200 text-right">{String(cfg.components.nozzle)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Fixture</span>
                    <span className="font-mono text-slate-200 text-right">{String(cfg.components.fixture)}</span>
                  </div>
                  <div className="h-px bg-slate-700/60" />
                  {Object.entries(PARAM_META).map(([k, meta]) => {
                    const val = (cfg.parameters as Record<string, unknown>)[k];
                    const isSim = String(title).startsWith('Simulated');
                    const matches = String(simulatedParams[k] ?? '') === String(targetParams[k] ?? '') || !isSim
                      ? null
                      : String(val) === String(targetParams[k]);
                    const hot = relevantParam === k;
                    return (
                      <div
                        key={k}
                        className={`flex justify-between gap-2 rounded-md px-1.5 py-1 ${
                          hot ? 'bg-cyan-950/50 border border-cyan-800/60' : 'border border-transparent'
                        }`}
                      >
                        <span className="text-slate-500">
                          {meta.label}
                          {hot && <span className="ml-1 text-cyan-300">●</span>}
                        </span>
                        <span className="font-mono text-slate-100 tabular-nums text-right">
                          {String(val)} <span className="text-slate-500">{meta.unit}</span>
                          {isSim && matches !== null && (
                            <span className={`ml-1.5 text-[10px] font-sans font-semibold ${matches ? 'text-emerald-300' : 'text-amber-300'}`}>
                              {matches ? '✓' : 'Δ'}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {sim?.simulated_at && (
          <div className="text-[11px] text-slate-500 mt-1.5">
            Last simulated application: {sim.simulated_at}
          </div>
        )}
      </Card>

      {/* Simulator editor + verification */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <div className="card-title mb-0.5">
            <Gauge size={16} /> Simulated configuration editor
          </div>
          <p className="card-sub mb-2">
            Requested ≠ applied ≠ verified. Values validate against approved ranges server-side,
            and only an explicit Apply touches the simulation.
          </p>
          {session.working_config ? (
            <>
              {!readOnly && (Object.keys(targetParams) ?? []).length > 0 && (
                <div className="mb-2 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-2 text-xs text-slate-400">
                  Target reminder:{' '}
                  {Object.entries(PARAM_META).map(([k, meta], i) => (
                    <span key={k}>
                      {i > 0 && ' · '}
                      {meta.label} <b className="text-blue-200 font-mono">{String(targetParams[k] ?? '?')}</b>
                    </span>
                  ))}
                </div>
              )}
              {[
                ['speed_rpm', 'Speed (RPM)'],
                ['temperature_c', 'Temperature (°C)'],
                ['pressure_bar', 'Pressure (bar)'],
              ].map(([k, label]) => (
                <label key={k} className="block text-sm mb-2">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    {label} — target <b className="font-mono text-blue-200">{String(session.target_config?.parameters?.[k] ?? '?')}</b>
                    {relevantParam === k && (
                      <span className="text-[10px] font-semibold rounded-full border border-cyan-800 bg-cyan-950/50 text-cyan-300 px-1.5 py-px">
                        this step
                      </span>
                    )}
                  </span>
                  <input
                    value={params[k] ?? ''}
                    onChange={(e) => setParams({ ...params, [k]: e.target.value })}
                    inputMode="decimal"
                    aria-label={label}
                    disabled={readOnly}
                    className="input mt-0.5"
                  />
                </label>
              ))}
              {!readOnly && (
                <Button
                  variant="accent"
                  loading={busy.isPending}
                  onClick={() =>
                    busy.mutate(
                      async () => {
                        const nums: Record<string, number> = {};
                        for (const [k, v] of Object.entries(params)) if (v !== '') nums[k] = Number(v);
                        await API.applyConfig(cid, nums, operatorId);
                      },
                      { onSuccess: () => toast.success('Simulated configuration applied.') },
                    )
                  }
                >
                  Apply configuration
                </Button>
              )}
              <div className="text-xs text-slate-500 mt-2 font-mono break-all">
                Working: {JSON.stringify(session.working_config?.parameters)}{' '}
              </div>
            </>
          ) : (
            <EmptyState title="Nothing to simulate" detail="This plan has no parameter steps." />
          )}
        </Card>
        <Card>
          <div className="card-title mb-0.5">
            <ShieldCheck size={16} /> Verification &amp; finalization
          </div>
          <div className="flex items-center gap-2 text-sm mb-2">
            <span className="text-slate-400">Overall status:</span>
            {verQuery.isLoading ? (
              <span className="text-xs text-slate-500">checking…</span>
            ) : verQuery.isError ? (
              <span className="text-xs text-red-300">unavailable</span>
            ) : (
              <StatusBadge value={verQuery.data?.overall ?? 'PENDING'} />
            )}
            {(verQuery.data?.runs ?? []).length > 0 && (
              <span className="text-[11px] text-slate-500">
                run {(verQuery.data?.runs ?? []).length} · append-only history
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mb-2">
            Task confirmations alone never complete a changeover — final verification must pass.
            Software simulation only.
          </div>
          {!readOnly && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="accent" onClick={runVerify}>
                Run verification
              </Button>
              <Button variant="success" onClick={() => setShowFinalize(true)}>
                Finalize changeover
              </Button>
              <Button
                variant="ghost"
                loading={busy.isPending}
                onClick={() =>
                  busy.mutate(() => API.abandon(cid), {
                    onSuccess: () => toast.info(`Changeover #${cid} abandoned — official state preserved.`),
                  })
                }
              >
                Abandon
              </Button>
            </div>
          )}
          {(verifyRes ?? (session.verification && session.verification.length > 0)) && (
            <div className="mt-2.5">
              <div className="eyebrow mb-1.5">Checklist — latest run</div>
              <div className="space-y-1 text-sm max-h-56 overflow-auto pr-1">
                {(verifyRes?.checks ?? session.verification ?? []).map(
                  (
                    c: { check_name: string; expected_value: string; actual_value: string; result: string; reason?: string | null },
                    i: number,
                  ) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-2.5 py-1.5 ${
                        c.result === 'PASS'
                          ? 'border-emerald-900/70 bg-emerald-950/40 text-emerald-200'
                          : 'border-red-900/70 bg-red-950/40 text-red-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {c.result === 'PASS' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        <span className="font-mono text-xs font-semibold">{c.check_name}</span>
                        <span className="ml-auto text-xs tabular-nums">
                          exp {c.expected_value} / got {c.actual_value ?? '—'}
                        </span>
                      </div>
                      {c.reason && <div className="text-xs mt-0.5 ml-5 opacity-90">→ {c.reason}</div>}
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
          {(verQuery.data?.runs ?? []).length > 1 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                Verification history ({verQuery.data?.runs.length} runs — reruns never erase history)
              </summary>
              <ul className="mt-1.5 space-y-1 text-xs">
                {(verQuery.data?.runs ?? []).map((r) => (
                  <li key={r.run} className="border border-slate-800 rounded-lg px-2 py-1.5 flex items-center gap-2 flex-wrap">
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
            <div className="mt-2.5 bg-emerald-950/60 border border-emerald-800 rounded-xl p-3 text-sm rise-in">
              <div className="font-semibold text-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 size={15} /> Changeover report — {report.status}
              </div>
              <div className="mt-1">
                Machine <b className="font-mono">{report.machine_id}</b> now on Product{' '}
                <b className="font-mono">{report.new_product}</b> · {report.actual_duration_seconds}s
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{report.note}</div>
            </div>
          )}
        </Card>
      </div>

      {/* Issues */}
      <Card>
        <div className="card-title mb-0.5">
          <AlertTriangle size={16} /> Issues{' '}
          {openIssues.length > 0 && (
            <span className="text-xs font-semibold rounded-full border border-amber-800 bg-amber-950/50 text-amber-200 px-2 py-0.5">
              {openIssues.length} open
            </span>
          )}
        </div>
        <p className="card-sub mb-2">Open critical issues block execution until resolved.</p>
        {openIssues.length === 0 && (
          <div className="text-sm text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-400" /> No open issues on this changeover.
          </div>
        )}
        {openIssues.map((i) => (
          <div key={i.id} className={`border rounded-xl p-2.5 mb-2 text-sm ${
            i.severity === 'critical' ? 'border-red-800 bg-red-950/30' : 'border-slate-700 bg-slate-800/40'
          }`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-slate-400">#{i.id}</span>
              <StatusBadge value={i.severity === 'critical' ? 'FAILED' : 'OPEN'} />
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {i.severity} · {i.category}
                {i.task_id ? ` · step task ${i.task_id}` : ''}
              </span>
              {!readOnly && (
                <button
                  onClick={() => setResolving(i.id)}
                  className="ml-auto text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-2.5 py-1 transition-colors"
                >
                  Resolve
                </button>
              )}
            </div>
            <div className="mt-1">{i.description}</div>
            <div className="text-xs text-slate-500">Opened {i.created_at}</div>
          </div>
        ))}
        {!readOnly && (
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
        )}
        {(session.issues ?? []).filter((i: Issue) => i.resolution_status !== 'OPEN').length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Resolved issues</summary>
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
      </Card>

      {/* Audit trail */}
      <Card>
        <div className="card-title mb-2">
          <HistoryIcon size={16} /> Audit trail ({(session.audit_trail ?? []).length})
        </div>
        {(session.audit_trail ?? []).length === 0 && (
          <div className="text-sm text-slate-500">No audit entries yet.</div>
        )}
        <ul className="text-xs space-y-1 max-h-64 overflow-auto pr-1">
          {(session.audit_trail ?? []).map((a: AuditEntry, i: number) => (
            <li key={i} className="flex gap-2 border-b border-slate-800/60 pb-1">
              <span className="text-slate-500 shrink-0 tabular-nums">{a.at}</span>
              <span className="font-mono text-slate-300 shrink-0 rounded bg-slate-800 px-1">{a.action}</span>
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
      </Card>

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
            <Button variant="ghost" onClick={() => setShowFail(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy.isPending}
              disabled={!failReason.trim()}
              onClick={() =>
                busy.mutate(
                  async () => {
                    await API.stepFail(cid, cur.id, failReason, operatorId);
                    setShowFail(false);
                    setFailReason('');
                  },
                  { onSuccess: () => toast.error(`Step ${cur.step_id} recorded as failed.`) },
                )
              }
            >
              Confirm failure
            </Button>
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
          className="input flex-1 min-w-40"
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label="Issue severity"
          className="input !w-auto"
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
          className="btn btn-ghost text-sm disabled:opacity-50"
        >
          {busy ? 'Reporting…' : 'Report issue'}
        </button>
      </div>
      {confirmCritical && (
        <div className="mt-2 bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-sm rise-in">
          <div className="flex items-start gap-2">
            <FileText size={15} className="text-red-300 mt-0.5" />
            <div>
              A <b>critical</b> issue blocks all further execution until resolved. Confirm?
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setConfirmCritical(false)}
                  className="btn btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="btn btn-danger text-xs disabled:opacity-50"
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
