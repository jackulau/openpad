import { resolveLanguage } from '@opencoder/shared';

export interface PadPackages {
  pip?: string[];
  npm?: string[];
  cargo?: string[];
  gem?: string[];
  apt?: string[];
}

export function parsePackages(raw: string | null | undefined): PadPackages {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PadPackages;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Build a shell prefix that installs the requested package set before exec.
 * Returns empty string when no packages match the language. Quotes each
 * package name with single quotes - shell injection mitigation since pkg
 * names are user-provided.
 */
export function installCommandFor(languageId: string, packages: PadPackages): string {
  const lang = resolveLanguage(languageId);
  if (!lang) return '';
  const group = lang.group ?? lang.id;
  const cmds: string[] = [];
  if (packages.pip?.length && (group === 'python' || lang.id.startsWith('python'))) {
    const args = packages.pip.map((p) => sq(p)).join(' ');
    cmds.push(`pip install --no-cache-dir --quiet ${args}`);
  }
  if (packages.npm?.length && (group === 'javascript' || group === 'typescript')) {
    const args = packages.npm.map((p) => sq(p)).join(' ');
    cmds.push(`npm install --silent --no-audit --no-fund ${args}`);
  }
  if (packages.cargo?.length && group === 'rust') {
    const args = packages.cargo.map((p) => sq(p)).join(' ');
    cmds.push(`cargo install --quiet ${args} 2>/dev/null || true`);
  }
  if (packages.gem?.length && group === 'ruby') {
    const args = packages.gem.map((p) => sq(p)).join(' ');
    cmds.push(`gem install --silent ${args}`);
  }
  if (packages.apt?.length) {
    const args = packages.apt.map((p) => sq(p)).join(' ');
    cmds.push(`apt-get update -qq && apt-get install -y --no-install-recommends ${args}`);
  }
  return cmds.join(' && ');
}

function sq(s: string): string {
  // single-quote a value for shell, escaping embedded single quotes.
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Returns the registry of supported managers per language group. */
export function managersForGroup(group: string | undefined): Array<keyof PadPackages> {
  switch (group) {
    case 'python':
      return ['pip'];
    case 'javascript':
    case 'typescript':
      return ['npm'];
    case 'rust':
      return ['cargo'];
    case 'ruby':
      return ['gem'];
    default:
      return [];
  }
}
