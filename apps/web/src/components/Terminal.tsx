import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { getToken } from '../lib/api';

interface Props {
  slug: string;
  active: boolean;
}

export function Terminal({ slug, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    if (xtermRef.current) return;

    const term = new XTerm({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: '#0a0a0b',
        foreground: '#e4e4e7',
        cursor: '#22d3ee',
      },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;
    term.writeln('connecting…');

    const token = getToken();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${proto}://${window.location.host}/ws/terminal/${slug}?token=${encodeURIComponent(token ?? '')}`,
    );
    wsRef.current = ws;

    ws.onmessage = (e) => {
      let msg: { type: string; data?: string; error?: string; message?: string };
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        term.clear();
      } else if (msg.type === 'output' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (msg.type === 'error') {
        term.writeln(`\r\n\x1b[31m[error] ${msg.error}${msg.message ? `: ${msg.message}` : ''}\x1b[0m`);
      } else if (msg.type === 'idle_timeout') {
        term.writeln('\r\n\x1b[33m[disconnected: idle timeout]\x1b[0m');
      } else if (msg.type === 'exit') {
        term.writeln('\r\n[session ended]');
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onclose = () => term.writeln('\r\n[disconnected]');

    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const onResize = (): void => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      onData.dispose();
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      try {
        term.dispose();
      } catch {
        /* ignore */
      }
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [slug, active]);

  return <div ref={containerRef} className="h-full w-full bg-zinc-950" />;
}
