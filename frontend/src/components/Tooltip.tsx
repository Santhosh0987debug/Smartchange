import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/** Accessible hover/focus tooltip for technical terms and status indicators. */
export default function Tooltip({
  label,
  children,
  icon,
}: {
  label: string;
  children: ReactNode;
  icon?: boolean;
}) {
  return (
    <span className="tip">
      <span className="inline-flex items-center gap-1 cursor-help">
        {children}
        {icon && <Info size={11} className="text-slate-500" aria-hidden="true" />}
      </span>
      <span role="tooltip" className="tip-card">
        {label}
      </span>
    </span>
  );
}
