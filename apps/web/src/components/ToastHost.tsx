import { useToasts } from '../lib/toast';

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto card px-4 py-2 text-sm shadow-lg max-w-xs animate-in ${
            t.kind === 'success'
              ? 'border-emerald-700'
              : t.kind === 'error'
                ? 'border-red-700'
                : 'border-zinc-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`size-1.5 rounded-full ${
                t.kind === 'success'
                  ? 'bg-emerald-400'
                  : t.kind === 'error'
                    ? 'bg-red-400'
                    : 'bg-brand-400'
              }`}
            />
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
