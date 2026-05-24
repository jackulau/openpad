import { describe, expect, it } from 'vitest';
import { buildDockerArgs } from '../src/exec/docker.js';
import type { LanguageSpec } from '../src/exec/languages.js';

const fakeLang: LanguageSpec = {
  id: 'python312',
  group: 'python',
  label: 'Python',
  fileExt: '.py',
  docker: {
    image: 'python:3.12-slim',
    runCmd: (file: string) => ['python', file],
  },
} as unknown as LanguageSpec;

function asPairs(args: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      const next = args[i + 1];
      const list = (out[a] ||= []);
      if (next && !next.startsWith('-')) {
        list.push(next);
        i++;
      } else {
        list.push('<flag-only>');
      }
    }
  }
  return out;
}

describe('docker sandbox argv', () => {
  const argv = buildDockerArgs(fakeLang, '/tmp/sandbox-X', 'main.py');
  const pairs = asPairs(argv);

  it('isolates the network: --network none', () => {
    expect(pairs['--network']).toContain('none');
  });

  it('isolates IPC: --ipc private', () => {
    expect(pairs['--ipc']).toContain('private');
  });

  it('filesystem is read-only', () => {
    expect(argv).toContain('--read-only');
  });

  it('drops every Linux capability', () => {
    expect(pairs['--cap-drop']).toContain('ALL');
  });

  it('runs as unprivileged user 65534', () => {
    const users = pairs['--user'] ?? [];
    expect(users.some((u) => u.startsWith('65534'))).toBe(true);
  });

  it('blocks privilege escalation', () => {
    expect(pairs['--security-opt']).toContain('no-new-privileges');
  });

  it('does not disable the default seccomp profile', () => {
    // Default seccomp profile is applied implicitly. The only way to weaken it is
    // --security-opt seccomp=unconfined, which must never appear in the runner args.
    const opts = pairs['--security-opt'] ?? [];
    expect(opts.some((o) => o.startsWith('seccomp=unconfined'))).toBe(false);
  });

  it('caps PID and file descriptors', () => {
    expect(pairs['--pids-limit']).toBeDefined();
    expect(pairs['--ulimit']).toBeDefined();
  });

  it('mounts the sandbox dir read-write at /work, nothing else', () => {
    const vols = pairs['-v'] ?? [];
    expect(vols).toHaveLength(1);
    expect(vols[0]).toMatch(/^\/tmp\/sandbox-X:\/work:rw$/);
  });

  it('mounts an exec-friendly bounded tmpfs', () => {
    const tmpfs = pairs['--tmpfs'] ?? [];
    expect(tmpfs.length).toBe(1);
    expect(tmpfs[0]).toMatch(/^\/tmp:exec,rw,size=\d+m,uid=65534,gid=65534$/);
  });

  it('passes --rm so containers do not accumulate', () => {
    expect(argv).toContain('--rm');
  });

  it('image and run command come last', () => {
    expect(argv[argv.length - 3]).toBe('python:3.12-slim');
    expect(argv[argv.length - 2]).toBe('python');
    expect(argv[argv.length - 1]).toBe('main.py');
  });
});
