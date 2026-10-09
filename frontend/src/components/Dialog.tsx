import { useEffect, type ReactNode } from 'react';
import { X, AlertTriangle } from 'lucide-react';

/** Accessible modal dialog: overlay click + Escape to close, role=dialog. */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        aria-label="Close dialog"
        className="overlay-in absolute inset-0 bg-black/65 backdrop-blur-[2px] cursor-default"
        onClick={onClose}
      />
      <div
        className={`modal-in relative w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto bg-[#101a30] border border-slate-700 rounded-xl p-5 shadow-2xl`}
      >
        <div className="flex items-center gap-2 mb-4">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-slate-800 text-slate-400"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="flex items-start gap-2 text-sm text-slate-300">
        <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
        <p>{message}</p>
      </div>
      {error && <div className="text-sm text-red-300 mt-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onCancel}
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-4 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="bg-red-500 hover:bg-red-400 text-slate-950 font-semibold rounded-lg px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export const inputCls =
  'mt-0.5 w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-400';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm mb-3">
      <span className="text-slate-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500 block mt-0.5">{hint}</span>}
    </label>
  );
}
