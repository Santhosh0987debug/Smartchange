import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Upload, Search, Eye, CheckCircle2, Archive } from 'lucide-react';
import { API, getApiError, type DocItem } from '../api';
import { queryClient, useDocs } from '../queries';
import { useUser } from '../use-user';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ConfirmDialog, Field, Modal, inputCls } from '../components/Dialog';

const PAGE_SIZE = 10;

export default function DocumentsPage() {
  const { operatorId } = useUser();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ id: number; kind: 'approve' | 'archive' } | null>(null);
  const [actionError, setActionError] = useState('');

  // Upload form
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [docCategory, setDocCategory] = useState('SOP');
  const [revision, setRevision] = useState('v1.0');
  const [uploadError, setUploadError] = useState('');

  const list = useDocs({ q, status, category, page, page_size: PAGE_SIZE });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['docs'] });
    queryClient.invalidateQueries({ queryKey: ['ai-status'] });
  }

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('title', title.trim());
      form.append('description', description.trim());
      form.append('category', docCategory.trim());
      form.append('revision', revision.trim() || 'v1.0');
      return API.uploadDocument(form);
    },
    onSuccess: () => {
      setFile(null);
      setTitle('');
      setDescription('');
      setUploadError('');
      refresh();
    },
    onError: (e) => setUploadError(getApiError(e)),
  });

  const transition = useMutation({
    mutationFn: async () => {
      if (!confirmAction) return;
      if (confirmAction.kind === 'approve') return API.approveDocument(confirmAction.id, operatorId);
      return API.archiveDocument(confirmAction.id, operatorId);
    },
    onSuccess: () => {
      setConfirmAction(null);
      setActionError('');
      refresh();
    },
    onError: (e) => setActionError(getApiError(e)),
  });

  async function openPreview(id: number) {
    try {
      const c = await API.documentContent(id);
      setPreviewText(c.content);
      setPreviewId(id);
    } catch (e) {
      setActionError(getApiError(e));
    }
  }

  const items: DocItem[] = list.data?.items ?? [];
  const total: number = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      {/* Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Upload size={16} /> Upload document (PDF or TXT, max 5 MB)
        </h3>
        <div className="text-xs text-slate-400 mb-2">
          Uploads start as <b>Draft</b> — only <b>Approved</b> documents answer operator questions.
          Files are parsed to text and never stored or executed.
        </div>
        {uploadError && <div className="text-sm text-red-300 mb-2">{uploadError}</div>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="File (PDF/TXT)">
            <input
              type="file"
              accept=".pdf,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-0.5 text-sm text-slate-300"
            />
          </Field>
          <Field label="Title (required)">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="SOP-FILL-010 …" />
          </Field>
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <input value={docCategory} onChange={(e) => setDocCategory(e.target.value)} className={inputCls} placeholder="SOP" />
            </Field>
            <Field label="Revision">
              <input value={revision} onChange={(e) => setRevision(e.target.value)} className={inputCls} />
            </Field>
          </div>
        </div>
        <button
          onClick={() => upload.mutate()}
          disabled={upload.isPending || !file || !title.trim()}
          className="bg-amber-400 text-slate-950 font-semibold rounded-lg px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading…' : 'Upload as Draft'}
        </button>
      </div>

      {/* Listing */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <BookOpen size={15} /> Documents ({total})
        </h3>
        <div className="flex gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-40">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search title, description…"
              aria-label="Search documents"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-sm"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by approval status"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Approved">Approved</option>
            <option value="Archived">Archived</option>
          </select>
          <input
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            placeholder="Category…"
            aria-label="Filter by category"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm w-32"
          />
        </div>
        {actionError && <div className="text-sm text-red-300 mb-2">{actionError}</div>}
        {list.isLoading && <Loading label="Loading documents…" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && items.length === 0 && <EmptyState title="No documents match" />}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase">
                  <th className="pr-3 py-1">Title</th>
                  <th className="pr-3">Category</th>
                  <th className="pr-3">Rev</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3">Size</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className="border-t border-slate-800">
                    <td className="pr-3 py-1.5">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-xs text-slate-500">{d.preview.slice(0, 90)}…</div>
                    </td>
                    <td className="pr-3 text-slate-400 text-xs">{d.category ?? '—'}</td>
                    <td className="pr-3 text-xs text-slate-400">{d.revision}</td>
                    <td className="pr-3">
                      <StatusBadge value={d.approval_status} />
                    </td>
                    <td className="pr-3 text-xs text-slate-400">
                      {d.size_bytes != null ? `${(d.size_bytes / 1024).toFixed(1)} KB` : '—'}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        onClick={() => openPreview(d.id)}
                        title="Preview extracted text"
                        aria-label={`Preview ${d.title}`}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
                      >
                        <Eye size={15} />
                      </button>
                      {d.approval_status === 'Draft' && (
                        <button
                          onClick={() => {
                            setConfirmAction({ id: d.id, kind: 'approve' });
                            setActionError('');
                          }}
                          title="Approve"
                          aria-label={`Approve ${d.title}`}
                          className="p-1.5 rounded hover:bg-slate-800 text-emerald-300"
                        >
                          <CheckCircle2 size={15} />
                        </button>
                      )}
                      {d.approval_status === 'Approved' && (
                        <button
                          onClick={() => {
                            setConfirmAction({ id: d.id, kind: 'archive' });
                            setActionError('');
                          }}
                          title="Archive"
                          aria-label={`Archive ${d.title}`}
                          className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
                        >
                          <Archive size={15} />
                        </button>
                      )}
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

      {previewId !== null && (
        <Modal title="Extracted text preview" onClose={() => setPreviewId(null)} wide>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap max-h-[60vh] overflow-auto bg-slate-800 rounded-lg p-3">
            {previewText}
          </pre>
        </Modal>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.kind === 'approve' ? 'Approve document?' : 'Archive document?'}
          message={
            confirmAction.kind === 'approve'
              ? 'Approved documents become authoritative sources for operator answers.'
              : 'Archived documents leave retrieval immediately, but their audit history is preserved.'
          }
          confirmLabel={confirmAction.kind === 'approve' ? 'Approve' : 'Archive'}
          busy={transition.isPending}
          error={actionError || undefined}
          onCancel={() => {
            setConfirmAction(null);
            setActionError('');
          }}
          onConfirm={() => transition.mutate()}
        />
      )}
    </div>
  );
}
