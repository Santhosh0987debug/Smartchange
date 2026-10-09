import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  detail,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-frame flex flex-col items-center gap-1.5 text-center py-8 px-4 text-slate-400">
      <span className="rounded-full bg-slate-800/80 border border-slate-700 p-2.5">
        <Icon size={20} className="text-slate-400" />
      </span>
      <div className="text-sm font-semibold text-slate-200">{title}</div>
      {detail && <div className="text-xs max-w-sm leading-relaxed">{detail}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
