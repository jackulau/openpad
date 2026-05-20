import { useEffect, useRef, useState } from 'react';
import type { RunResult } from '@opencoder/shared';
import { runStreaming, type StreamRunRequest } from '../lib/exec-stream';

// Streaming-aware run output. Renders stdout/stderr progressively as a
// WebSocket-streamed exec emits chunks. Falls back to the regular RunResult
// shape via `result` prop for the non-streaming path (POST /run).
//
// Two modes:
//   - Streaming: parent passes `streamReq` + `slug`; component opens WS, shows
//     output as it arrives, and resolves to a RunResult on `end`.
//   - Static: parent passes `result` only; renders identically to OutputPanel.

interface Props {
  slug?: string;
  streamReq?: StreamRunRequest | null;
  result?: RunResult | null;
  onStreamEnd?: (r: RunResult) => void;
}

export function RunOutput({ slug, streamReq, result, onStreamEnd }: Props) {
  const [streaming, setStreaming] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [meta, setMeta] = useState<{
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!slug || !streamReq) return;
    // dedupe - React strict-mode runs effects twice; only run the same payload once.
    const key = JSON.stringify({ slug, ...streamReq });
    if (startedRef.current === key) return;
    startedRef.current = key;

    setStreaming(true);
    setStdout('');
    setStderr('');
    setMeta(null);
    setError(null);

    runStreaming(slug, streamReq, (m) => {
      if (m.kind === 'stdout') setStdout((s) => s + m.chunk);
      else if (m.kind === 'stderr') setStderr((s) => s + m.chunk);
    })
      .then((final) => {
        setMeta({
          exitCode: final.exitCode,
          durationMs: final.durationMs,
          timedOut: final.timedOut,
        });
        setStreaming(false);
        onStreamEnd?.({
          stdout: final.stdout,
          stderr: final.stderr,
          exitCode: final.exitCode,
          timedOut: final.timedOut,
          durationMs: final.durationMs,
          runner: 'docker',
          language: streamReq.language ?? '',
        });
      })
      .catch((err: Error) => {
        setError(err.message);
        setStreaming(false);
      });
  }, [slug, streamReq, onStreamEnd]);

  const shown = streamReq
    ? { stdout, stderr, ...(meta ?? { exitCode: null, durationMs: 0, timedOut: false }) }
    : result
      ? { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut }
      : null;

  return (
    <div className="h-full overflow-auto p-4 font-mono text-sm bg-page">
      {streaming && (
        <div className="flex items-center gap-2 text-accent mb-2">
          <span className="size-2 rounded-full bg-accent animate-pulse" />
          streaming…
        </div>
      )}
      {!streaming && !shown && (
        <div className="text-subtle">
          Press <kbd className="kbd">Cmd</kbd>
          <kbd className="kbd">↵</kbd> to run.
        </div>
      )}
      {error && <div className="text-danger text-xs mb-2">stream error: {error}</div>}
      {shown && (
        <div className="space-y-3">
          {meta && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span
                className={`chip ${shown.exitCode === 0 && !shown.timedOut ? 'chip-success' : 'chip-danger'} !text-[11px]`}
              >
                {shown.exitCode === 0 && !shown.timedOut ? '[OK] exit 0' : `exit ${String(shown.exitCode)}`}
              </span>
              <span className="chip">{shown.durationMs}ms</span>
              <span className="chip">stream</span>
              {shown.timedOut && <span className="chip chip-danger">timed out</span>}
            </div>
          )}
          {shown.stdout && (
            <pre className="whitespace-pre-wrap text-primary leading-relaxed">{shown.stdout}</pre>
          )}
          {shown.stderr && (
            <pre className="whitespace-pre-wrap text-danger leading-relaxed border-l-2 border-danger/40 pl-2">
              {shown.stderr}
            </pre>
          )}
          {!shown.stdout && !shown.stderr && meta && (
            <div className="text-subtle italic">(no output)</div>
          )}
        </div>
      )}
    </div>
  );
}
