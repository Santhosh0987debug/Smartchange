import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  Factory, Cog, ClipboardCheck, Bot, BarChart3, Package,
  History, Settings, FileText, ChevronRight, ChevronDown, ChevronsLeft, Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useHealth } from '../queries';
import { useUser } from '../use-user';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: Factory, hint: 'KPIs, machines, activity' },
      { to: '/changeovers', label: 'Changeovers', icon: ClipboardCheck, hint: 'Plan & execute' },
      { to: '/machines', label: 'Machines', icon: Cog, hint: 'Fleet & status' },
      { to: '/products', label: 'Products', icon: Package, hint: 'Configs & revisions' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3, hint: 'Trends & verification' },
      { to: '/history', label: 'History', icon: History, hint: 'Runs & audit' },
    ],
  },
  {
    title: 'Knowledge',
    items: [
      { to: '/assistant', label: 'AI Assistant', icon: Bot, hint: 'SOP guidance' },
      { to: '/documents', label: 'Documents', icon: FileText, hint: 'SOP library' },
    ],
  },
  {
    title: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: Settings, hint: 'Env & identities' }],
  },
];

/** Breadcrumb trail derived from the URL (BrowserRouter has no useMatches). */
function crumbsFor(pathname: string): string[] {
  if (pathname === '/') return ['Dashboard'];
  const flat = NAV_GROUPS.flatMap((g) => g.items);
  const item = flat.find((n) => n.to !== '/' && (pathname === n.to || pathname.startsWith(n.to + '/')));
  if (!item) return ['Dashboard'];
  const crumbs = [item.label];
  if (item.to === '/changeovers' && pathname !== '/changeovers') crumbs.push('Execution workspace');
  return crumbs;
}

export default function Shell() {
  const { pathname } = useLocation();
  const crumbs = crumbsFor(pathname);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('smartchange.navCollapsed') === '1',
  );
  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem('smartchange.navCollapsed', c ? '0' : '1');
      return !c;
    });
  }
  const health = useHealth();
  const { users, current, operatorId, setOperatorId } = useUser();
  const backendUp = health.data?.ok === true;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const initials = (current?.name ?? operatorId)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 md:flex">
      {/* Sidebar (desktop, collapsible, grouped) */}
      <aside
        className={`hidden md:flex shrink-0 flex-col border-r border-slate-800 bg-[#0c1322] sticky top-0 h-screen transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
        aria-label="Application navigation"
      >
        <div className={`flex items-center gap-2 px-4 py-4 border-b border-slate-800 ${collapsed ? 'justify-center px-2' : ''}`}>
          <div className="bg-gradient-to-b from-blue-500 to-blue-700 text-white p-2 rounded-lg shadow-lg shadow-blue-900/40 shrink-0 ring-1 ring-blue-400/40">
            <Factory size={20} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-bold text-[17px] leading-none tracking-tight">SmartChange</div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="dot dot-ok dot-live" aria-hidden="true" />
                Setup Assistance · sim only
              </div>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Primary">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-1">
              {!collapsed && <div className="nav-section">{group.title}</div>}
              {collapsed && <div className="mx-3 my-1.5 h-px bg-slate-800" aria-hidden="true" />}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    title={collapsed ? `${item.label} — ${item.hint ?? ''}` : item.hint}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                        collapsed ? 'justify-center' : ''
                      } ${
                        isActive
                          ? 'nav-active bg-blue-600/90 text-white font-semibold shadow-md shadow-blue-950/50'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`
                    }
                  >
                    <item.icon size={17} className="shrink-0" />
                    {!collapsed && (
                      <span className="truncate">
                        {item.label}
                        {item.hint && (
                          <span className="block text-[10px] font-normal text-slate-400 leading-tight">
                            {item.hint}
                          </span>
                        )}
                      </span>
                    )}
                    {collapsed && (
                      <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-100 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50">
                        {item.label}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-2 border-t border-slate-800">
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <ChevronsLeft size={15} className={`transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
            {!collapsed && 'Collapse'}
          </button>
          {!collapsed && (
            <div className="px-2 pt-1 text-[11px] leading-snug text-slate-500">
              Prototype — simulated READY never authorizes real equipment.
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="border-b border-slate-800 bg-[#0d1526]/90 backdrop-blur sticky top-0 z-10">
          <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 md:hidden">
              <div className="bg-gradient-to-b from-blue-500 to-blue-700 text-white p-1.5 rounded-lg">
                <Factory size={16} />
              </div>
              <span className="font-bold tracking-tight">SmartChange</span>
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
                title={backendUp ? 'Backend reachable' : 'Backend unreachable — start FastAPI on :8000'}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full border px-2 py-1 ${
                  backendUp
                    ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300'
                    : 'border-red-800 bg-red-950/60 text-red-300'
                }`}
              >
                <span className={`dot ${backendUp ? 'dot-ok dot-live' : 'dot-bad'}`} aria-hidden="true" />
                {backendUp ? 'Backend live' : 'Backend down'}
              </span>
              {/* Profile menu */}
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title="Demo identity menu"
                  className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 pl-1.5 pr-2 py-1 transition-colors"
                >
                  <span className="w-7 h-7 rounded-full bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-600 inline-flex items-center justify-center text-xs font-bold">
                    {initials}
                  </span>
                  <span className="leading-tight text-left hidden sm:block">
                    <span className="block text-[13px] font-medium max-w-32 truncate">
                      {current?.name ?? operatorId}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {current?.role ?? 'demo identity'}
                    </span>
                  </span>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Demo identity"
                    className="modal-in absolute right-0 mt-2 w-64 rounded-xl border border-slate-700 bg-[#0f1830] shadow-2xl overflow-hidden"
                  >
                    <div className="px-3 py-2.5 border-b border-slate-800">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Demo sign-in
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        No passwords — every write is audit-attributed.
                      </div>
                    </div>
                    <div className="p-1.5 max-h-60 overflow-auto">
                      {users.map((u) => (
                        <button
                          key={u.id}
                          role="menuitemradio"
                          aria-checked={u.id === operatorId}
                          onClick={() => {
                            setOperatorId(u.id);
                            setMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                            u.id === operatorId ? 'bg-blue-600/20 text-white' : 'hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="w-7 h-7 rounded-full bg-slate-700 inline-flex items-center justify-center text-[11px] font-bold shrink-0">
                            {u.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{u.name}</span>
                            <span className="block text-[11px] text-slate-400 font-mono">
                              {u.id} · {u.role}
                            </span>
                          </span>
                          {u.id === operatorId && <Check size={15} className="ml-auto text-emerald-400 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Mobile nav */}
          <nav className="md:hidden px-3 pb-2 flex gap-1 overflow-x-auto" aria-label="Primary mobile">
            {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600 font-semibold'
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
          <div key={pathname} className="page-in">
            <Outlet />
          </div>
          <footer className="text-xs text-slate-500 pt-4 flex items-center gap-2 flex-wrap">
            <span className="dot dot-idle" aria-hidden="true" />
            SmartChange prototype · deterministic rules for comparison &amp; validation · AI is
            supplementary · simulated READY never authorizes real equipment.
          </footer>
        </main>
      </div>
    </div>
  );
}
