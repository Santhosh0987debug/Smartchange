const styles: Record<string, string> = {
  READY: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  Operational: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  Active: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  VERIFIED: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  COMPLETED: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  PASS: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  RESOLVED: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  APPROVED: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  Approved: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  IN_PROGRESS: 'bg-amber-950/60 text-amber-300 border-amber-800',
  Maintenance: 'bg-amber-950/60 text-amber-300 border-amber-800',
  CHANGEOVER: 'bg-amber-950/60 text-amber-300 border-amber-800',
  PENDING: 'bg-amber-950/60 text-amber-300 border-amber-800',
  OPEN: 'bg-amber-950/60 text-amber-300 border-amber-800',
  NOT_RUN: 'bg-amber-950/60 text-amber-300 border-amber-800',
  FAILED: 'bg-red-950/60 text-red-300 border-red-800',
  FAIL: 'bg-red-950/60 text-red-300 border-red-800',
  ABANDONED: 'bg-slate-800/80 text-slate-300 border-slate-700',
  Archived: 'bg-slate-800/80 text-slate-300 border-slate-700',
  Draft: 'bg-amber-950/60 text-amber-300 border-amber-800',
  Offline: 'bg-slate-800/80 text-slate-300 border-slate-700',
  Inactive: 'bg-slate-800/80 text-slate-300 border-slate-700',
  Fault: 'bg-red-950/60 text-red-300 border-red-800',
};

const dots: Record<string, string> = {
  READY: 'dot-ok',
  Operational: 'dot-ok',
  Active: 'dot-ok',
  VERIFIED: 'dot-ok',
  COMPLETED: 'dot-ok',
  PASS: 'dot-ok',
  RESOLVED: 'dot-ok',
  APPROVED: 'dot-ok',
  Approved: 'dot-ok',
  IN_PROGRESS: 'dot-warn dot-live',
  Maintenance: 'dot-warn',
  CHANGEOVER: 'dot-warn dot-live',
  PENDING: 'dot-warn',
  OPEN: 'dot-warn',
  NOT_RUN: 'dot-warn',
  FAILED: 'dot-bad',
  FAIL: 'dot-bad',
  Fault: 'dot-bad',
};

const titles: Record<string, string> = {
  READY: 'Simulated ready — software validation only, never authorizes real equipment',
  VERIFIED: 'All verification checks passed',
  COMPLETED: 'Workflow completed and persisted',
  IN_PROGRESS: 'Execution in progress',
  PENDING: 'Awaiting action',
  FAILED: 'Failed — see reasons',
  Operational: 'Machine available for production',
  Maintenance: 'Maintenance scheduled — changeovers warn',
  Offline: 'Offline — changeovers blocked',
  Fault: 'Fault — changeovers blocked',
};

/** Distinct status badge with dot indicator and bordered pill. */
export default function StatusBadge({ value }: { value: string }) {
  const cls = styles[value] ?? 'bg-slate-800/80 text-slate-300 border-slate-700';
  const dot = dots[value] ?? 'dot-idle';
  return (
    <span
      title={titles[value] ?? value}
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap ${cls}`}
    >
      <span className={`dot ${dot}`} aria-hidden="true" />
      {value}
    </span>
  );
}
