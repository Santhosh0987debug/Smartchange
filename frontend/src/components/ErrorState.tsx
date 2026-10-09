import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getApiError } from '../api';

export default function ErrorState({
  error,
  onRetry,
  hint,
}: {
  error: unknown;
  onRetry?: () => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg p-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 text-red-400 shrink-0" />
      <div className="min-w-0">
        <div className="break-words">{getApiError(error)}</div>
        {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-1 text-xs"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full">
            <ErrorState
              error={new Error('Something went wrong rendering this page.')}
              onRetry={() => window.location.reload()}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
