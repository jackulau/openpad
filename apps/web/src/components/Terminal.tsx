import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { getToken } from '../lib/api';
import { useTheme } from '../lib/theme';

interface Props {
  slug: string;
  active: boolean;
}

const TERM_DARK = {
  background: '#12151c',
  foreground: '#f4f4f5',
  cursor: '#22d3ee',
  selectionBackground: '#22d3ee44',
};
const TERM_LIGHT = {
  background: '#ffffff',
  foreground: '#1f2937',
  cursor: '#0891b2',
  selectionBackground: '#06b6d433',
};

export function Terminal({ slug, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { theme } = useTheme();

  // Repaint the terminal when the theme toggles. xterm doesn't auto-update from
  // a stale options object, so we re-assign options.theme imperatively.
  useEffect(() => {
    const t = xtermRef.current;
    if (!t) return;
    t.options.theme = theme === 'light' ? TERM_LIGHT : TERM_DARK;
  }, [theme]);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    if (xtermRef.current) return;

    const container = containerRef.current;
    let disposed = false;
    let term: XTerm | null = null;
    let ws: WebSocket | null = null;
    let ro: ResizeObserver | null = null;
    let onResize: (() => void) | null = null;
    let onData: { dispose(): void } | null = null;

    // fit() reads the renderer's computed dimensions; it throws
    // ("Cannot read properties of undefined (reading 'dimensions')") if the
    // terminal hasn't laid out yet or has already been disposed. Guard + swallow.
    const safeFit = (fit: FitAddon): void => {
      try {
        fit.fit();
      } catch {
        /* renderer not ready or terminal disposed */
      }
    };

    // Defer init by one frame. React StrictMode (and rapid panel toggling)
    // mounts the effect, cleans up, and remounts synchronously. Opening xterm
    // and then disposing it in the same tick leaves a pending internal render
    // frame that crashes reading `_renderService.dimensions`. Scheduling the
    // open on rAF and cancelling it on cleanup means the throwaway mount never
    // opens a terminal — we open exactly once, on the mount that survives.
    const raf = requestAnimationFrame(() => {
      if (disposed) return;

      const t = new XTerm({
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        theme: theme === 'light' ? TERM_LIGHT : TERM_DARK,
        cursorBlink: true,
        convertEol: true,
      });
      term = t;
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.open(container);
      safeFit(fit);
      xtermRef.current = t;
      fitRef.current = fit;
      t.writeln('connecting…');

      const token = getToken();
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(
        `${proto}://${window.location.host}/ws/terminal/${slug}`,
        token ? [`oc.bearer.${token}`] : undefined,
      );
      ws = socket;
      wsRef.current = socket;

      socket.onmessage = (e) => {
        let msg: { type: string; data?: string; error?: string; message?: string };
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          t.clear();
        } else if (msg.type === 'output' && typeof msg.data === 'string') {
          t.write(msg.data);
        } else if (msg.type === 'error') {
          t.writeln(`\r\n\x1b[31m[error] ${msg.error}${msg.message ? `: ${msg.message}` : ''}\x1b[0m`);
        } else if (msg.type === 'idle_timeout') {
          t.writeln('\r\n\x1b[33m[disconnected: idle timeout]\x1b[0m');
        } else if (msg.type === 'exit') {
          t.writeln('\r\n[session ended]');
        }
      };
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows }));
      };
      socket.onclose = () => t.writeln('\r\n[disconnected]');

      onData = t.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });
      onResize = (): void => {
        safeFit(fit);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows }));
        }
      };
      window.addEventListener('resize', onResize);
      ro = new ResizeObserver(onResize);
      ro.observe(container);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      onData?.dispose();
      ro?.disconnect();
      if (onResize) window.removeEventListener('resize', onResize);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      try {
        term?.dispose();
      } catch {
        /* ignore */
      }
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [slug, active]);

  return <div ref={containerRef} className="h-full w-full surface" />;
}
