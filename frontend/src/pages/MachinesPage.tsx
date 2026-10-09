import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Eye, Search, Cog } from 'lucide-react';
import { API, getApiError, type Machine, type MachineInput } from '../api';
import { queryClient, useMachine, useMachines } from '../queries';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ConfirmDialog, Field, Modal, inputCls } from '../components/Dialog';

const MANAGED_STATUSES = ['Operational', 'Maintenance', 'Offline'];
const PAGE_SIZE = 10;

const emptyForm: MachineInput = {
  id: '',
  name: '',
  machine_type: '',
  line: '',
  location: '',
  status: 'Operational',
  current_product_id: '',
};

export default function MachinesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [line, setLine] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MachineInput | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formError, setFormError] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Machine | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const list = useMachines({ q, status, line, page, page_size: PAGE_SIZE });
  const detail = useMachine(viewId);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['machines'] });
    queryClient.invalidateQueries({ queryKey: ['machine'] });
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload: MachineInput = {
        ...editing!,
        machine_type: editing!.machine_type || undefined,
        line: editing!.line || undefined,
        location: editing!.location || undefined,
        current_product_id: editing!.current_product_id || undefined,
      };
      if (isNew) return API.createMachine(payload);
      const { id: _omit, ...rest } = payload;
      return API.updateMachine(editing!.id, rest);
    },
    onSuccess: () => {
      setEditing(null);
      setFormError('');
      refresh();
    },
    onError: (e) => setFormError(getApiError(e)),
  });

  const remove = useMutation({
    mutationFn: () => API.deleteMachine(deleting!.id),
    onSuccess: () => {
      setDeleting(null);
      setDeleteError('');
      if (viewId === deleting!.id) setViewId(null);
      refresh();
    },
    onError: (e) => setDeleteError(getApiError(e)),
  });

  function openNew() {
    setEditing({ ...emptyForm });
    setIsNew(true);
    setFormError('');
  }

  function openEdit(m: Machine) {
    setEditing({
      id: m.id,
      name: m.name,
      machine_type: m.machine_type ?? '',
      line: m.line ?? '',
      location: m.location ?? '',
      status: m.status,
      current_product_id: m.current_product_id ?? '',
    });
    setIsNew(false);
    setFormError('');
  }

  const items: Machine[] = list.data?.items ?? [];
  const total: number = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const nameInvalid = editing !== null && !editing.name.trim();
  const idInvalid = editing !== null && isNew && !editing.id.trim();

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className="card-title">
            <Cog size={16} /> Machines
            <span className="text-xs font-semibold rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-slate-300 tabular-nums">{total}</span>
          </h3>
          <button
            onClick={openNew}
            className="btn btn-primary ml-auto text-sm"
          >
            <Plus size={15} /> Add machine
          </button>
        </div>
        <p className="card-sub mb-3">Fleet registry with live status. Deletes are guarded while history references a machine.</p>
        <div className="flex gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-40">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search ID, name, line, location…"
              aria-label="Search machines"
              className="input !pl-8"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="input !w-auto"
          >
            <option value="">All statuses</option>
            {MANAGED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={line}
            onChange={(e) => {
              setLine(e.target.value);
              setPage(1);
            }}
            placeholder="Line filter…"
            aria-label="Filter by line"
            className="input !w-32"
          />
        </div>

        {list.isLoading && <Loading label="Loading machines…" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && items.length === 0 && (
          <EmptyState title="No machines match" detail="Adjust the search or add a new machine." />
        )}
        {items.length > 0 && (
          <div className="table-wrap border border-slate-800 rounded-lg overflow-hidden">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Line</th>
                  <th>Status</th>
                  <th>Product</th>
                  <th className="!text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono font-semibold">{m.id}</td>
                    <td>{m.name}</td>
                    <td className="text-slate-400">{m.machine_type ?? '—'}</td>
                    <td className="text-slate-400">{m.line ?? '—'}</td>
                    <td>
                      <StatusBadge value={m.status} />
                    </td>
                    <td className="text-slate-400 font-mono text-xs">{m.current_product_id ?? '—'}</td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        onClick={() => setViewId(m.id)}
                        title={`View ${m.id}`}
                        aria-label={`View ${m.id}`}
                        className="icon-btn"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() => openEdit(m)}
                        title={`Edit ${m.id}`}
                        aria-label={`Edit ${m.id}`}
                        className="icon-btn"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => {
                          setDeleting(m);
                          setDeleteError('');
                        }}
                        title={`Delete ${m.id}`}
                        aria-label={`Delete ${m.id}`}
                        className="icon-btn danger"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center gap-2 mt-3 text-sm">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-slate-400">
              Page {page} of {pages}
            </span>
            <button
              onClick={() => setPage(Math.min(pages, page + 1))}
              disabled={page >= pages}
              className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {viewId && (
        <div className="card rise-in">
          {detail.isLoading && <Loading label="Loading machine…" />}
          {detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
          {detail.data && (
            <div className="text-sm">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <h3 className="font-semibold text-base tracking-tight">
                  <span className="font-mono">{detail.data.id}</span>
                  <span className="text-slate-500 font-normal"> · {detail.data.name}</span>
                </h3>
                <StatusBadge value={detail.data.status} />
                <button
                  onClick={() => setViewId(null)}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-200 btn btn-ghost !py-1"
                >
                  Close
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {[
                  ['Type', detail.data.machine_type ?? '—'],
                  ['Line', detail.data.line ?? '—'],
                  ['Location', detail.data.location ?? '—'],
                  ['Current product', detail.data.current_product_id ?? '—'],
                  ['Config version', `v${detail.data.configuration_version}`],
                  ['Updated', detail.data.updated_at ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5 flex justify-between gap-2">
                    <span className="text-slate-500 text-xs">{k}</span>
                    <span className="text-slate-200 text-[13px] font-medium text-right">{v}</span>
                  </div>
                ))}
              </div>
              {detail.data.latest_state && (
                <div className="mt-2 rounded-lg border border-slate-800 bg-slate-800/40 p-2.5 text-xs text-slate-400">
                  <span className="eyebrow block mb-1">Latest verified state</span>
                  Product <b className="font-mono text-slate-200">{detail.data.latest_state.product_id}</b> ·{' '}
                  <b className="text-slate-200">{detail.data.latest_state.verification_status}</b>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-400">
                    {JSON.stringify(detail.data.latest_state.parameters, null, 1)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {editing && (
        <Modal title={isNew ? 'Add machine' : `Edit ${editing.id}`} onClose={() => setEditing(null)}>
          {formError && <div className="text-sm text-red-300 mb-3">{formError}</div>}
          <Field label="Machine ID">
            <input
              value={editing.id}
              onChange={(e) => setEditing({ ...editing, id: e.target.value })}
              disabled={!isNew}
              placeholder="e.g. FILL-03"
              aria-invalid={idInvalid}
              className={`${inputCls} ${isNew ? '' : 'opacity-60'}`}
            />
            {idInvalid && <span className="field-hint !text-red-300">Machine ID is required.</span>}
          </Field>
          <Field label="Name (required)">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Filling Machine 03"
              aria-invalid={nameInvalid}
              className={inputCls}
            />
            {nameInvalid && <span className="field-hint !text-red-300">Name is required.</span>}
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Machine type">
              <input
                value={editing.machine_type ?? ''}
                onChange={(e) => setEditing({ ...editing, machine_type: e.target.value })}
                placeholder="Filling / Packaging"
                className={inputCls}
              />
            </Field>
            <Field label="Status">
              <select
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                className={inputCls}
              >
                {MANAGED_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Production line">
              <input
                value={editing.line ?? ''}
                onChange={(e) => setEditing({ ...editing, line: e.target.value })}
                placeholder="Line A"
                className={inputCls}
              />
            </Field>
            <Field label="Location">
              <input
                value={editing.location ?? ''}
                onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                placeholder="Hall 1"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Current product ID" hint="Must already exist. Leave empty for none.">
            <input
              value={editing.current_product_id ?? ''}
              onChange={(e) => setEditing({ ...editing, current_product_id: e.target.value })}
              placeholder="A"
              className={inputCls}
            />
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setEditing(null)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !editing.name.trim() || (isNew && !editing.id.trim())}
              className="btn btn-primary text-sm disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.id}?`}
          message={`Machine "${deleting.name}" will be permanently removed. Deletion is blocked while changeover history references it.`}
          busy={remove.isPending}
          error={deleteError || undefined}
          onCancel={() => {
            setDeleting(null);
            setDeleteError('');
          }}
          onConfirm={() => remove.mutate()}
        />
      )}
    </div>
  );
}
