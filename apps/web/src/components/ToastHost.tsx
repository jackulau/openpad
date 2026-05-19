import { useToasts, type Toast } from '../lib/toast';

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = t.kind ?? 'info';
  const accent =
    tone === 'success'
      ? 'border-success/40'
      : tone === 'error'
        ? 'border-danger/40'
        : 'border-accent/40';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto card shadow-pop px-3.5 py-3 text-sm max-w-xs border-l-2 ${accent}`}
    >
      <div className="flex items-start gap-3">
        <ToastIcon kind={tone} />
        <span className="flex-1 leading-snug text-primary">{t.message}</span>
        <button
          onClick={onDismiss}
          className="text-subtle hover:text-secondary text-xs shrink-0 mt-0.5"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ToastIcon({ kind }: { kind: 'info' | 'success' | 'error' }) {
  if (kind === 'success') {
    return (
      <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-success/15 text-success shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (kind === 'error') {
    return (
      <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-danger/15 text-danger shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent shrink-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </span>
  );
}
