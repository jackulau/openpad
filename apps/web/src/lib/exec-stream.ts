import { getToken } from './api';

// Streaming exec client. Opens a WS to /api/pads/:slug/run-stream, sends the
// payload as the first message, and emits start/stdout/stderr/end messages to
// the caller via onMsg. Returns a promise that resolves on `end` (or rejects
// on error / socket close before end).

export interface StreamRunRequest {
  language?: string;
  source: string;
  stdin?: string;
  filename?: string;
  timeoutMs?: number;
}

export type StreamMsg =
  | { kind: 'start'; runId: string }
  | { kind: 'stdout'; chunk: string }
  | { kind: 'stderr'; chunk: string }
  | { kind: 'end'; exitCode: number | null; durationMs: number; timedOut: boolean; error?: string }
  | { kind: 'error'; error: string };

export interface StreamResult {
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function wsUrl(path: string): string {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}${path}`;
}

export function runStreaming(
  slug: string,
  body: StreamRunRequest,
  onMsg: (m: StreamMsg) => void,
): Promise<StreamResult> {
  return new Promise<StreamResult>((resolve, reject) => {
    const token = getToken();
    if (!token) {
      reject(new Error('not_authenticated'));
      return;
    }
    const url = wsUrl(`/api/pads/${slug}/run-stream`);
    const ws = new WebSocket(url, [`oc.bearer.${token}`]);
    let stdout = '';
    let stderr = '';
    let ended = false;
    const final: StreamResult = {
      exitCode: null,
      durationMs: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
    };

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(body));
    });
    ws.addEventListener('message', (ev) => {
      let msg: StreamMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()) as StreamMsg;
      } catch {
        return;
      }
      onMsg(msg);
      if (msg.kind === 'stdout') stdout += msg.chunk;
      else if (msg.kind === 'stderr') stderr += msg.chunk;
      else if (msg.kind === 'end') {
        ended = true;
        final.exitCode = msg.exitCode;
        final.durationMs = msg.durationMs;
        final.timedOut = msg.timedOut;
        final.stdout = stdout;
        final.stderr = stderr;
      } else if (msg.kind === 'error') {
        reject(new Error(msg.error));
      }
    });
    ws.addEventListener('close', () => {
      if (ended) resolve(final);
      else reject(new Error('stream_closed_before_end'));
    });
    ws.addEventListener('error', () => {
      if (!ended) reject(new Error('stream_error'));
    });
  });
}
