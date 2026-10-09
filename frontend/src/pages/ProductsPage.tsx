import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Eye, Search, Package } from 'lucide-react';
import { API, getApiError, type Product, type ProductInput } from '../api';
import { queryClient, useProduct, useProducts } from '../queries';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ConfirmDialog, Field, Modal, inputCls } from '../components/Dialog';

const PAGE_SIZE = 10;

interface ConfigForm {
  nozzle: string;
  speed: string;
  temp: string;
  pressure: string;
  fixtureMl: string;
}

interface ProductForm {
  id: string;
  product_code: string;
  name: string;
  description: string;
  revision: string;
  active: boolean;
  config: ConfigForm;
}

const emptyForm: ProductForm = {
  id: '',
  product_code: '',
  name: '',
  description: '',
  revision: 'v1.0',
  active: true,
  config: { nozzle: '', speed: '', temp: '', pressure: '', fixtureMl: '' },
};

function toForm(p: Product): ProductForm {
  const params = (p.configuration.parameters ?? {}) as Record<string, number>;
  const comps = (p.configuration.components ?? {}) as Record<string, string>;
  const fixture = String(comps.fixture ?? '');
  const ml = fixture.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '';
  return {
    id: p.id,
    product_code: p.product_code,
    name: p.name,
    description: p.description ?? '',
    revision: p.revision,
    active: p.active,
    config: {
      nozzle: String(comps.nozzle ?? ''),
      speed: String(params.speed_rpm ?? ''),
      temp: String(params.temperature_c ?? ''),
      pressure: String(params.pressure_bar ?? ''),
      fixtureMl: ml,
    },
  };
}

function buildConfiguration(f: ProductForm, existing?: Product): Record<string, unknown> {
  const speed = Number(f.config.speed);
  const temp = Number(f.config.temp);
  const pressure = Number(f.config.pressure);
  const ml = Number(f.config.fixtureMl);
  const ranges =
    existing?.configuration.ranges ??
    ({
      speed_rpm: [Math.round(speed * 0.8), Math.round(speed * 1.2)],
      temperature_c: [Math.round(temp - 10), Math.round(temp + 10)],
      pressure_bar: [Math.round((pressure - 0.5) * 10) / 10, Math.round((pressure + 0.5) * 10) / 10],
    } as Record<string, [number, number]>);
  return {
    components: { nozzle: f.config.nozzle.trim(), fixture: `${ml} ml` },
    parameters: { speed_rpm: speed, temperature_c: temp, pressure_bar: pressure },
    ranges,
    units: { speed_rpm: 'RPM', temperature_c: '°C', pressure_bar: 'bar' },
  };
}

export default function ProductsPage() {
  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProductForm | null>(null);
  const [editBaseline, setEditBaseline] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formError, setFormError] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const list = useProducts({
    q,
    active: activeFilter === '' ? undefined : activeFilter === 'true',
    page,
    page_size: PAGE_SIZE,
  });
  const detail = useProduct(viewId);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['product'] });
  }

  const save = useMutation({
    mutationFn: async () => {
      const f = editing!;
      const configuration = buildConfiguration(f, editBaseline ?? undefined);
      if (isNew) {
        const input: ProductInput = {
          id: f.id.trim(),
          product_code: f.product_code.trim(),
          name: f.name.trim(),
          description: f.description.trim() || undefined,
          configuration,
          revision: f.revision.trim() || 'v1.0',
          active: f.active,
        };
        return API.createProduct(input);
      }
      return API.updateProduct(f.id, {
        product_code: f.product_code.trim(),
        name: f.name.trim(),
        description: f.description.trim(),
        configuration,
        revision: f.revision.trim(),
        active: f.active,
      });
    },
    onSuccess: () => {
      setEditing(null);
      setEditBaseline(null);
      setFormError('');
      refresh();
    },
    onError: (e) => setFormError(getApiError(e)),
  });

  const remove = useMutation({
    mutationFn: () => API.deleteProduct(deleting!.id),
    onSuccess: () => {
      setDeleting(null);
      setDeleteError('');
      if (viewId === deleting!.id) setViewId(null);
      refresh();
    },
    onError: (e) => setDeleteError(getApiError(e)),
  });

  function openNew() {
    setEditing({ ...emptyForm, config: { ...emptyForm.config } });
    setEditBaseline(null);
    setIsNew(true);
    setFormError('');
  }

  function openEdit(p: Product) {
    setEditing(toForm(p));
    setEditBaseline(p);
    setIsNew(false);
    setFormError('');
  }

  const items: Product[] = list.data?.items ?? [];
  const total: number = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Package size={16} /> Products ({total})
          </h3>
          <button
            onClick={openNew}
            className="ml-auto flex items-center gap-1 bg-amber-400 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm"
          >
            <Plus size={15} /> Add product
          </button>
        </div>
        <div className="flex gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-40">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search ID, code, name…"
              aria-label="Search products"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-sm"
            />
          </div>
          <select
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>

        {list.isLoading && <Loading label="Loading products…" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && items.length === 0 && (
          <EmptyState title="No products match" detail="Adjust the search or add a new product." />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase">
                  <th className="pr-3 py-1">ID</th>
                  <th className="pr-3">Code / SKU</th>
                  <th className="pr-3">Name</th>
                  <th className="pr-3">Setup</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3">Rev</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const params = (p.configuration.parameters ?? {}) as Record<string, number>;
                  return (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="pr-3 py-1.5 font-mono">{p.id}</td>
                      <td className="pr-3 font-mono text-xs">{p.product_code}</td>
                      <td className="pr-3">{p.name}</td>
                      <td className="pr-3 text-xs text-slate-400">
                        {params.speed_rpm} RPM · {params.temperature_c}°C · {params.pressure_bar} bar
                      </td>
                      <td className="pr-3">
                        <StatusBadge value={p.active ? 'Active' : 'Inactive'} />
                      </td>
                      <td className="pr-3 text-xs text-slate-400">{p.revision}</td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          onClick={() => setViewId(p.id)}
                          title={`View ${p.id}`}
                          aria-label={`View ${p.id}`}
                          className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(p)}
                          title={`Edit ${p.id}`}
                          aria-label={`Edit ${p.id}`}
                          className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setDeleting(p);
                            setDeleteError('');
                          }}
                          title={`Delete ${p.id}`}
                          aria-label={`Delete ${p.id}`}
                          className="p-1.5 rounded hover:bg-slate-800 text-red-300"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          {detail.isLoading && <Loading label="Loading product…" />}
          {detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
          {detail.data && (
            <div className="text-sm">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <h3 className="font-semibold text-base">
                  {detail.data.id} · {detail.data.name}
                </h3>
                <StatusBadge value={detail.data.active ? 'Active' : 'Inactive'} />
                <button
                  onClick={() => setViewId(null)}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              <div className="text-slate-300 mb-2">
                {detail.data.description || 'No description.'}{' '}
                <span className="text-xs text-slate-500">
                  {detail.data.product_code} · {detail.data.revision}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="bg-slate-800 rounded-lg p-2.5">
                  <div className="text-xs text-slate-400 mb-1">Components</div>
                  <pre className="text-xs whitespace-pre-wrap">
                    {JSON.stringify(detail.data.configuration.components, null, 1)}
                  </pre>
                </div>
                <div className="bg-slate-800 rounded-lg p-2.5">
                  <div className="text-xs text-slate-400 mb-1">Parameters &amp; ranges</div>
                  <pre className="text-xs whitespace-pre-wrap">
                    {JSON.stringify(
                      {
                        parameters: detail.data.configuration.parameters,
                        ranges: detail.data.configuration.ranges,
                        units: detail.data.configuration.units,
                      },
                      null,
                      1,
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <Modal title={isNew ? 'Add product' : `Edit ${editing.id}`} onClose={() => setEditing(null)} wide>
          {formError && <div className="text-sm text-red-300 mb-3">{formError}</div>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Product ID">
              <input
                value={editing.id}
                onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                disabled={!isNew}
                placeholder="e.g. D"
                className={`${inputCls} ${isNew ? '' : 'opacity-60'}`}
              />
            </Field>
            <Field label="Product code / SKU (required, unique)">
              <input
                value={editing.product_code}
                onChange={(e) => setEditing({ ...editing, product_code: e.target.value })}
                placeholder="e.g. PROD-D"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Name (required)">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Product D — Trial 300 ml"
              className={inputCls}
            />
          </Field>
          <Field label="Description">
            <input
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="Short description"
              className={inputCls}
            />
          </Field>
          <h4 className="font-medium text-sm mt-4 mb-1">Setup configuration</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nozzle type (required)">
              <input
                value={editing.config.nozzle}
                onChange={(e) =>
                  setEditing({ ...editing, config: { ...editing.config, nozzle: e.target.value } })
                }
                placeholder="D-Type"
                className={inputCls}
              />
            </Field>
            <Field label="Container / fixture size, ml (required)">
              <input
                value={editing.config.fixtureMl}
                onChange={(e) =>
                  setEditing({ ...editing, config: { ...editing.config, fixtureMl: e.target.value } })
                }
                placeholder="300"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Speed, RPM (50–200)">
              <input
                value={editing.config.speed}
                onChange={(e) =>
                  setEditing({ ...editing, config: { ...editing.config, speed: e.target.value } })
                }
                placeholder="95"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Temperature, °C (20–120)">
              <input
                value={editing.config.temp}
                onChange={(e) =>
                  setEditing({ ...editing, config: { ...editing.config, temp: e.target.value } })
                }
                placeholder="68"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Pressure, bar (0.5–6)">
              <input
                value={editing.config.pressure}
                onChange={(e) =>
                  setEditing({ ...editing, config: { ...editing.config, pressure: e.target.value } })
                }
                placeholder="2.2"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Revision">
              <input
                value={editing.revision}
                onChange={(e) => setEditing({ ...editing, revision: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm mb-1">
            <input
              type="checkbox"
              checked={editing.active}
              onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              className="w-4 h-4 accent-amber-400"
            />
            Active (inactive products are hidden from changeover targets but preserved)
          </label>
          <div className="text-xs text-slate-500 mb-3">
            Units are stored as RPM / °C / bar / ml. Approved ranges are kept on edit and
            auto-derived on create; the server rejects out-of-range values.
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setEditing(null)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                !editing.name.trim() ||
                !editing.product_code.trim() ||
                (isNew && !editing.id.trim())
              }
              className="bg-amber-400 text-slate-950 font-semibold rounded-lg px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.id}?`}
          message={`Product "${deleting.name}" will be permanently removed. Deletion is blocked while machines, states, or changeover history reference it — deactivate it instead.`}
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
