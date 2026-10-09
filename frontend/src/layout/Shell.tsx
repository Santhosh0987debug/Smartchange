import { NavLink, Outlet, useLocation } from 'react-router';
import {
  Factory, Cog, ClipboardCheck, Bot, BarChart3, Package,
  History, Settings, FileText, ChevronRight, CircleUserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useHealth } from '../queries';
import { useUser } from '../use-user';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Factory },
  { to: '/machines', label: 'Machines', icon: Cog },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/changeovers', label: 'Changeovers', icon: ClipboardCheck },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/history', label: 'History', icon: History },
  { to: '/assistant', label: 'AI Assistant', icon: Bot },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Breadcrumb trail derived from the URL (BrowserRouter has no useMatches). */
function crumbsFor(pathname: string): string[] {
  if (pathname === '/') return ['Dashboard'];
  const item = NAV.find((n) => n.to !== '/' && (pathname === n.to || pathname.startsWith(n.to + '/')));
  if (!item) return ['Dashboard'];
  const crumbs = [item.label];
  if (item.to === '/changeovers' && pathname !== '/changeovers') crumbs.push('Execution workspace');
  return crumbs;
}

export default function Shell() {
  const crumbs = crumbsFor(useLocation().pathname);
  const health = useHealth();
  const { users, current, operatorId, setOperatorId } = useUser();
  const backendUp = health.data?.ok === true;

  const initials = (current?.name ?? operatorId)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-800">
          <div className="bg-amber-400 text-slate-950 p-2 rounded-lg">
            <Factory size={20} />
          </div>
          <div>
            <div className="font-bold text-lg leading-none">SmartChange</div>
            <div className="text-[11px] text-slate-400">Setup Assistance · sim only</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${
                  isActive
                    ? 'bg-amber-400 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800'
                }`
              }
            >
              <item.icon size={16} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-500">
          Prototype — simulated READY never authorizes real equipment.
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10">
          <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 md:hidden">
              <div className="bg-amber-400 text-slate-950 p-1.5 rounded-lg">
                <Factory size={16} />
              </div>
              <span className="font-bold">SmartChange</span>
            </div>
            {/* Breadcrumbs */}
            <nav className="hidden sm:flex items-center gap-1 text-sm text-slate-400" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={13} className="text-slate-600" />}
                  <span className={i === crumbs.length - 1 ? 'text-slate-100 font-medium' : ''}>{c}</span>
                </span>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2.5">
              <span
                title={backendUp ? 'Backend reachable' : 'Backend unreachable'}
                className={`w-2.5 h-2.5 rounded-full ${backendUp ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              <CircleUserRound size={20} className="text-slate-400" />
              <div className="leading-tight">
                <div className="text-sm font-medium flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-slate-700 inline-flex items-center justify-center text-xs font-bold">
                    {initials}
                  </span>
                  {current?.name ?? operatorId}
                </div>
                <div className="text-[11px] text-slate-400">
                  {current?.role ?? 'demo identity'} · demo sign-in, no real login
                </div>
              </div>
              <select
                value={operatorId}
                onChange={(e) => setOperatorId(e.target.value)}
                title="Switch demo user"
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Mobile nav */}
          <nav className="md:hidden px-3 pb-2 flex gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap border ${
                    isActive
                      ? 'bg-amber-400 text-slate-950 border-amber-400 font-semibold'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`
                }
              >
                <item.icon size={13} /> {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-5">
          <Outlet />
          <footer className="text-xs text-slate-500 pt-4">
            SmartChange prototype · deterministic rules for comparison &amp; validation · AI is
            supplementary · simulated READY never authorizes real equipment.
          </footer>
        </main>
      </div>
    </div>
  );
}
