import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}

const Ctx = createContext<(kind: Kind, message: string) => void>(() => undefined);
let nextId = 1;

export function useToast() {
  const push = useContext(Ctx);
  return {
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m),
  };
}

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const ring: Record<Kind, string> = {
  success: 'border-emerald-800',
  error: 'border-red-800',
  info: 'border-slate-700',
};
const iconColor: Record<Kind, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-sky-300',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, message: string) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-80 max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div
              key={t.id}
              className={`toast-in flex items-start gap-2 bg-slate-900 border ${ring[t.kind]} rounded-xl px-3 py-2.5 text-sm shadow-xl`}
            >
              <Icon size={16} className={`mt-0.5 shrink-0 ${iconColor[t.kind]}`} />
              <div className="break-words">{t.message}</div>
              <button
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                aria-label="Dismiss notification"
                className="ml-auto text-slate-500 hover:text-slate-300 shrink-0"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
