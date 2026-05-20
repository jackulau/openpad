import type { RunResult } from '@opencoder/shared';

export function OutputPanel({ result, running }: { result?: RunResult; running: boolean }) {
  return (
    <div className="h-full overflow-auto p-4 font-mono text-sm bg-page">
      {running && (
        <div className="flex items-center gap-2 text-accent">
          <span className="size-2 rounded-full bg-accent animate-pulse" />
          running…
        </div>
      )}
      {!running && !result && (
        <div className="text-subtle">
          Press <kbd className="kbd">Cmd</kbd>
          <kbd className="kbd">↵</kbd> to run.
        </div>
      )}
      {result && <ResultView result={result} />}
    </div>
  );
}

function ResultView({ result }: { result: RunResult }) {
  const ok = result.exitCode === 0 && !result.timedOut;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span
          className={`chip ${ok ? 'chip-success' : 'chip-danger'} !text-[11px]`}
          title={ok ? 'Exited cleanly' : 'Non-zero exit code'}
        >
          {ok ? '[OK] exit 0' : `exit ${String(result.exitCode)}`}
        </span>
        <span className="chip">{result.durationMs}ms</span>
        <span className="chip">{result.runner}</span>
        {result.timedOut && <span className="chip chip-danger">timed out</span>}
      </div>
      {result.stdout && (
        <pre className="whitespace-pre-wrap text-primary leading-relaxed">{result.stdout}</pre>
      )}
      {result.stderr && (
        <pre className="whitespace-pre-wrap text-danger leading-relaxed border-l-2 border-danger/40 pl-2">
          {result.stderr}
        </pre>
      )}
      {!result.stdout && !result.stderr && (
        <div className="text-subtle italic">(no output)</div>
      )}
    </div>
  );
}
