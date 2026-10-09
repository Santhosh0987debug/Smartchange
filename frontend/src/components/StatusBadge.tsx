const styles: Record<string, string> = {
  READY: 'bg-emerald-900 text-emerald-200',
  Operational: 'bg-emerald-900 text-emerald-200',
  Active: 'bg-emerald-900 text-emerald-200',
  VERIFIED: 'bg-emerald-900 text-emerald-200',
  COMPLETED: 'bg-emerald-900 text-emerald-200',
  PASS: 'bg-emerald-900 text-emerald-200',
  RESOLVED: 'bg-emerald-900 text-emerald-200',
  APPROVED: 'bg-emerald-900 text-emerald-200',
  Approved: 'bg-emerald-900 text-emerald-200',
  IN_PROGRESS: 'bg-amber-900 text-amber-200',
  Maintenance: 'bg-amber-900 text-amber-200',
  CHANGEOVER: 'bg-amber-900 text-amber-200',
  PENDING: 'bg-amber-900 text-amber-200',
  OPEN: 'bg-amber-900 text-amber-200',
  FAILED: 'bg-red-900 text-red-200',
  FAIL: 'bg-red-900 text-red-200',
  ABANDONED: 'bg-slate-700 text-slate-300',
  Archived: 'bg-slate-700 text-slate-300',
  Draft: 'bg-amber-900 text-amber-200',
  Offline: 'bg-slate-700 text-slate-300',
  Inactive: 'bg-slate-700 text-slate-300',
};

export default function StatusBadge({ value }: { value: string }) {
  const cls = styles[value] ?? 'bg-slate-700 text-slate-300';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{value}</span>
  );
}
