import type { WebSocket } from 'ws';
import type { JwtPayload } from '../lib/auth.js';
import { canEdit, getPadAccess } from '../lib/permissions.js';
import { env } from '../env.js';
import { TerminalCapture } from '../services/terminalCapture.js';

// Lazy import - node-pty is a native module that may fail to build on some hosts.
type IPty = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
};
type SpawnOptions = {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
};
type NodePtyMod = { spawn: (shell: string, args: string[], opts: SpawnOptions) => IPty };

let nodePtyMod: NodePtyMod | null = null;
let nodePtyError: string | null = null;

async function getNodePty(): Promise<NodePtyMod | null> {
  if (nodePtyMod || nodePtyError) return nodePtyMod;
  try {
    nodePtyMod = (await import('node-pty')) as unknown as NodePtyMod;
    return nodePtyMod;
  } catch (err) {
    nodePtyError = String((err as Error).message ?? err);
    return null;
  }
}

interface ClientMessage {
  type: 'input' | 'resize' | 'ping';
  data?: string;
  cols?: number;
  rows?: number;
}

function send(ws: WebSocket, type: string, body: Record<string, unknown> = {}): void {
  if (ws.readyState !== 1 /* OPEN */) return;
  ws.send(JSON.stringify({ type, ...body }));
}

const DEFAULT_SHELL =
  process.platform === 'win32'
    ? process.env.COMSPEC || 'powershell.exe'
    : process.env.SHELL || '/bin/bash';

export async function handleTerminalConn({
  ws,
  slug,
  user,
}: {
  ws: WebSocket;
  slug: string;
  user: JwtPayload;
}): Promise<void> {
  const access = await getPadAccess(slug, user.sub);
  if (!access || !canEdit(access.role)) {
    send(ws, 'error', { error: 'forbidden' });
    ws.close(4003, 'forbidden');
    return;
  }
  const capture = new TerminalCapture(access.pad.id, user.sub);
  const mod = await getNodePty();
  if (!mod) {
    send(ws, 'error', {
      error: 'terminal_unavailable',
      message: `node-pty not available: ${nodePtyError ?? 'unknown'}`,
    });
    ws.close(4099, 'terminal_unavailable');
    return;
  }

  let pty: IPty;
  try {
    pty = mod.spawn(DEFAULT_SHELL, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME ?? '/tmp',
      env: {
        ...(process.env as Record<string, string>),
        TERM: 'xterm-256color',
        PS1: '\\u@opencoder:\\w$ ',
      },
    });
  } catch (err) {
    send(ws, 'error', {
      error: 'spawn_failed',
      message: String((err as Error).message ?? err),
    });
    ws.close(4500, 'spawn_failed');
    return;
  }

  send(ws, 'ready', { shell: DEFAULT_SHELL });

  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, 'idle_timeout', { ms: env.TERMINAL_IDLE_MS });
      try {
        pty.kill();
      } catch {
        /* ignore */
      }
      ws.close(4408, 'idle_timeout');
    }, env.TERMINAL_IDLE_MS);
    idleTimer.unref?.();
  };
  resetIdle();

  pty.onData((data) => {
    resetIdle();
    capture.recordOutput(data);
    send(ws, 'output', { data });
  });
  pty.onExit((e) => {
    send(ws, 'exit', { code: e.exitCode, signal: e.signal });
    ws.close(1000, 'pty_exited');
  });

  ws.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString('utf8')) as ClientMessage;
    } catch {
      return;
    }
    resetIdle();
    if (msg.type === 'input' && typeof msg.data === 'string') {
      capture.recordInput(msg.data);
      pty.write(msg.data);
    } else if (msg.type === 'resize' && msg.cols && msg.rows) {
      try {
        pty.resize(msg.cols, msg.rows);
      } catch {
        /* ignore */
      }
    } else if (msg.type === 'ping') {
      send(ws, 'pong');
    }
  });

  ws.on('close', () => {
    if (idleTimer) clearTimeout(idleTimer);
    void capture.close();
    try {
      pty.kill();
    } catch {
      /* ignore */
    }
  });
}
