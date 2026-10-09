import { Settings as SettingsIcon } from 'lucide-react';
import { API_BASE_URL } from '../api';
import { useHealth, useUsers } from '../queries';
import { useUser } from '../use-user';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';

export default function SettingsPage() {
  const health = useHealth();
  const usersQuery = useUsers();
  const { operatorId } = useUser();

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="card">
        <div className="card-title mb-2">
          <SettingsIcon size={16} /> Environment
        </div>
        <dl className="text-sm space-y-1.5">
          <div className="flex gap-2">
            <dt className="text-slate-400 w-40 shrink-0">API base URL</dt>
            <dd className="font-mono">{API_BASE_URL || '(same origin, via Vite /api proxy)'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-400 w-40 shrink-0">Backend status</dt>
            <dd>
              {health.isLoading && 'Checking…'}
              {health.isError && <span className="text-red-300">Unreachable</span>}
              {health.data && <span className="text-emerald-300">Reachable</span>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-400 w-40 shrink-0">Active demo identity</dt>
            <dd>{operatorId}</dd>
          </div>
        </dl>
        <div className="text-xs text-slate-400 mt-2">
          Configure via <span className="font-mono">frontend/.env</span> (VITE_API_BASE_URL) and{' '}
          <span className="font-mono">backend</span> env (DATABASE_URL, FRONTEND_ORIGINS). See
          .env.example files. No real secrets are required for local development.
        </div>
      </div>

      <div className="card">
        <div className="card-title mb-2">Demo users</div>
        {usersQuery.isLoading && <Loading label="Loading users…" />}
        {usersQuery.isError && (
          <ErrorState error={usersQuery.error} onRetry={() => usersQuery.refetch()} />
        )}
        {(usersQuery.data ?? []).map((u: { id: string; name: string; role: string }) => (
          <div key={u.id} className="border border-slate-700 rounded-lg p-2.5 mb-2 text-sm">
            <span className="font-semibold">{u.name}</span>{' '}
            <span className="text-xs text-slate-400 font-mono">{u.id}</span>{' '}
            <span className="text-xs text-amber-200">{u.role}</span>
          </div>
        ))}
        <div className="text-xs text-slate-400 mt-1">
          Prototype demo sign-in only — there is no password or real authentication. Every write is
          attributed to the selected identity in the audit log.
        </div>
      </div>

      <div className="card text-sm text-slate-300">
        <div className="card-title mb-1">Prototype scope</div>
        <p>
          SmartChange Phase 1 provides the application foundation: routing, data layer, database
          with migrations, and seed data. It does not control real machinery, and READY status from
          later workflow phases means software validation only.
        </p>
      </div>
    </div>
  );
}
