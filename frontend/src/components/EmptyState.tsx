import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  detail,
}: {
  icon?: LucideIcon;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center py-8 text-slate-400">
      <Icon size={22} className="text-slate-500" />
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {detail && <div className="text-xs max-w-sm">{detail}</div>}
    </div>
  );
}
