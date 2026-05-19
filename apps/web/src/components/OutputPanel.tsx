import type { RunResult } from '@opencoder/shared';

export function OutputPanel({ result, running }: { result?: RunResult; running: boolean }) {
  return (
    <div className="h-full overflow-auto p-3 font-mono text-sm bg-zinc-950">
      {running && <div className="text-brand-400 animate-pulse">running…</div>}
      {!running && !result && (
        <div className="text-zinc-500">Press <kbd className="px-1 bg-zinc-800 rounded">⌘↵</kbd> to run.</div>
      )}
      {result && (
        <>
          <div className="flex items-center gap-3 text-xs text-zinc-500 mb-2">
            <span>
              exit <span className="text-zinc-300">{String(result.exitCode)}</span>
            </span>
            <span>·</span>
            <span>{result.durationMs}ms</span>
            <span>·</span>
            <span>{result.runner}</span>
            {result.timedOut && <span className="text-amber-400">timed out</span>}
          </div>
          {result.stdout && <pre className="whitespace-pre-wrap text-zinc-200">{result.stdout}</pre>}
          {result.stderr && (
            <pre className="whitespace-pre-wrap text-red-400 mt-2">{result.stderr}</pre>
          )}
          {!result.stdout && !result.stderr && (
            <div className="text-zinc-500">(no output)</div>
          )}
        </>
      )}
    </div>
  );
}
