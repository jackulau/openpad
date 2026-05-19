export interface LanguageSpec {
  id: string;
  label: string;
  monacoId: string;
  fileExt: string;
  /** Optional group key for collapsing multiple versions under one selector. */
  group?: string;
  /** Display version (rendered in dropdown next to the label). */
  version?: string;
  /** True if this is the canonical/default entry for the group. */
  isDefault?: boolean;
  docker?: {
    image: string;
    runCmd: (filename: string) => string[];
    compileCmd?: (filename: string) => string[];
  };
  local?: {
    runCmd: (filename: string) => string[];
    compileCmd?: (filename: string) => string[];
    artifactPath?: (filename: string) => string;
  };
}

const stripExt = (f: string) => f.replace(/\.[^.]+$/, '');

const py = (v: string) => ({
  id: `python${v.replace('.', '')}`,
  label: 'Python',
  monacoId: 'python',
  fileExt: '.py',
  group: 'python',
  version: v,
  docker: { image: `python:${v}-alpine`, runCmd: (f: string) => ['python', f] },
  local: { runCmd: (f: string) => ['python3', f] },
});

const node = (v: string) => ({
  id: `node${v}`,
  label: 'JavaScript',
  monacoId: 'javascript',
  fileExt: '.js',
  group: 'javascript',
  version: `Node ${v}`,
  docker: { image: `node:${v}-alpine`, runCmd: (f: string) => ['node', f] },
  local: { runCmd: (f: string) => ['node', f] },
});

const cpp = (std: string) => ({
  id: `cpp${std}`,
  label: 'C++',
  monacoId: 'cpp',
  fileExt: '.cpp',
  group: 'cpp',
  version: `C++${std}`,
  docker: {
    image: 'gcc:14-bookworm',
    runCmd: (f: string) => ['sh', '-c', `g++ -O2 -std=c++${std} ${f} -o /tmp/a.out && /tmp/a.out`],
  },
  local: {
    runCmd: (f: string) => ['sh', '-c', `g++ -O2 -std=c++${std} ${f} -o /tmp/a.out && /tmp/a.out`],
  },
});

const java = (v: string) => ({
  id: `java${v}`,
  label: 'Java',
  monacoId: 'java',
  fileExt: '.java',
  group: 'java',
  version: `JDK ${v}`,
  docker: {
    image: `eclipse-temurin:${v}-jdk-alpine`,
    runCmd: (f: string) => ['sh', '-c', `javac ${f} && java ${stripExt(f)}`],
  },
  local: { runCmd: (f: string) => ['sh', '-c', `javac ${f} && java ${stripExt(f)}`] },
});

const go = (v: string) => ({
  id: `go${v.replace('.', '')}`,
  label: 'Go',
  monacoId: 'go',
  fileExt: '.go',
  group: 'go',
  version: `Go ${v}`,
  docker: { image: `golang:${v}-alpine`, runCmd: (f: string) => ['go', 'run', f] },
  local: { runCmd: (f: string) => ['go', 'run', f] },
});

const rust = (channel: string, image: string) => ({
  id: `rust-${channel}`,
  label: 'Rust',
  monacoId: 'rust',
  fileExt: '.rs',
  group: 'rust',
  version: `Rust ${channel}`,
  docker: {
    image,
    runCmd: (f: string) => ['sh', '-c', `rustc -O ${f} -o /tmp/a.out && /tmp/a.out`],
  },
  local: {
    runCmd: (f: string) => ['sh', '-c', `rustc -O ${f} -o /tmp/a.out && /tmp/a.out`],
  },
});

export const LANGUAGES: Record<string, LanguageSpec> = {
  // Python (versioned)
  python310: { ...py('3.10') },
  python311: { ...py('3.11') },
  python312: { ...py('3.12'), isDefault: true },
  python313: { ...py('3.13') },

  // JavaScript / Node (versioned)
  node18: { ...node('18') },
  node20: { ...node('20'), isDefault: true },
  node22: { ...node('22') },

  // TypeScript (single)
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    monacoId: 'typescript',
    fileExt: '.ts',
    group: 'typescript',
    version: 'tsx',
    isDefault: true,
    docker: {
      image: 'node:20-alpine',
      runCmd: (f) => ['sh', '-c', `npx --yes -p typescript tsx ${f} || npx --yes tsx ${f}`],
    },
    local: { runCmd: (f) => ['npx', '--yes', 'tsx', f] },
  },

  // Go (versioned)
  go121: { ...go('1.21') },
  go122: { ...go('1.22'), isDefault: true },
  go123: { ...go('1.23') },

  // Rust (channels)
  'rust-stable': { ...rust('stable', 'rust:1.83-alpine'), isDefault: true },
  'rust-nightly': { ...rust('nightly', 'rustlang/rust:nightly-alpine') },

  // Java (versioned)
  java17: { ...java('17') },
  java21: { ...java('21'), isDefault: true },

  // C++ (versioned standards)
  cpp17: { ...cpp('17') },
  cpp20: { ...cpp('20'), isDefault: true },
  cpp23: { ...cpp('23') },

  // C (single)
  c: {
    id: 'c',
    label: 'C',
    monacoId: 'c',
    fileExt: '.c',
    group: 'c',
    version: 'C17',
    isDefault: true,
    docker: {
      image: 'gcc:14-bookworm',
      runCmd: (f) => ['sh', '-c', `gcc -O2 ${f} -o /tmp/a.out && /tmp/a.out`],
    },
    local: { runCmd: (f) => ['sh', '-c', `gcc -O2 ${f} -o /tmp/a.out && /tmp/a.out`] },
  },

  // Ruby
  ruby: {
    id: 'ruby',
    label: 'Ruby',
    monacoId: 'ruby',
    fileExt: '.rb',
    group: 'ruby',
    version: '3.3',
    isDefault: true,
    docker: { image: 'ruby:3.3-alpine', runCmd: (f) => ['ruby', f] },
    local: { runCmd: (f) => ['ruby', f] },
  },

  // C#
  csharp: {
    id: 'csharp',
    label: 'C#',
    monacoId: 'csharp',
    fileExt: '.cs',
    group: 'csharp',
    version: '.NET 8',
    isDefault: true,
    docker: { image: 'mcr.microsoft.com/dotnet/sdk:8.0', runCmd: (f) => ['dotnet', 'script', f] },
    local: { runCmd: (f) => ['dotnet', 'script', f] },
  },

  // The long tail (one version each)
  kotlin: {
    id: 'kotlin',
    label: 'Kotlin',
    monacoId: 'kotlin',
    fileExt: '.kt',
    group: 'kotlin',
    version: '1.9',
    isDefault: true,
    docker: { image: 'zenika/kotlin:1.9', runCmd: (f) => ['sh', '-c', `kotlinc -script ${f}`] },
    local: { runCmd: (f) => ['kotlinc', '-script', f] },
  },
  swift: {
    id: 'swift',
    label: 'Swift',
    monacoId: 'swift',
    fileExt: '.swift',
    group: 'swift',
    version: '5.10',
    isDefault: true,
    docker: { image: 'swift:5.10-jammy', runCmd: (f) => ['swift', f] },
    local: { runCmd: (f) => ['swift', f] },
  },
  php: {
    id: 'php',
    label: 'PHP',
    monacoId: 'php',
    fileExt: '.php',
    group: 'php',
    version: '8.3',
    isDefault: true,
    docker: { image: 'php:8.3-alpine', runCmd: (f) => ['php', f] },
    local: { runCmd: (f) => ['php', f] },
  },
  bash: {
    id: 'bash',
    label: 'Bash',
    monacoId: 'shell',
    fileExt: '.sh',
    group: 'bash',
    version: '5.2',
    isDefault: true,
    docker: { image: 'bash:5.2', runCmd: (f) => ['bash', f] },
    local: { runCmd: (f) => ['bash', f] },
  },
  lua: {
    id: 'lua',
    label: 'Lua',
    monacoId: 'lua',
    fileExt: '.lua',
    group: 'lua',
    version: '5.4',
    isDefault: true,
    docker: { image: 'nickblah/lua:5.4-alpine', runCmd: (f) => ['lua', f] },
    local: { runCmd: (f) => ['lua', f] },
  },
  elixir: {
    id: 'elixir',
    label: 'Elixir',
    monacoId: 'elixir',
    fileExt: '.exs',
    group: 'elixir',
    version: '1.16',
    isDefault: true,
    docker: { image: 'elixir:1.16-alpine', runCmd: (f) => ['elixir', f] },
    local: { runCmd: (f) => ['elixir', f] },
  },
  haskell: {
    id: 'haskell',
    label: 'Haskell',
    monacoId: 'haskell',
    fileExt: '.hs',
    group: 'haskell',
    version: 'GHC 9.6',
    isDefault: true,
    docker: { image: 'haskell:9.6', runCmd: (f) => ['runghc', f] },
    local: { runCmd: (f) => ['runghc', f] },
  },
  scala: {
    id: 'scala',
    label: 'Scala',
    monacoId: 'scala',
    fileExt: '.scala',
    group: 'scala',
    version: '3.x',
    isDefault: true,
    docker: {
      image: 'virtuslab/scala-cli:1.4.3',
      runCmd: (f) => ['scala-cli', 'run', f],
    },
    local: { runCmd: (f) => ['scala-cli', 'run', f] },
  },
  perl: {
    id: 'perl',
    label: 'Perl',
    monacoId: 'perl',
    fileExt: '.pl',
    group: 'perl',
    version: '5.38',
    isDefault: true,
    docker: { image: 'perl:5.38-slim', runCmd: (f) => ['perl', f] },
    local: { runCmd: (f) => ['perl', f] },
  },
  r: {
    id: 'r',
    label: 'R',
    monacoId: 'r',
    fileExt: '.r',
    group: 'r',
    version: '4.4',
    isDefault: true,
    docker: { image: 'r-base:4.4.1', runCmd: (f) => ['Rscript', f] },
    local: { runCmd: (f) => ['Rscript', f] },
  },
  julia: {
    id: 'julia',
    label: 'Julia',
    monacoId: 'julia',
    fileExt: '.jl',
    group: 'julia',
    version: '1.10',
    isDefault: true,
    docker: { image: 'julia:1.10-alpine', runCmd: (f) => ['julia', f] },
    local: { runCmd: (f) => ['julia', f] },
  },
  zig: {
    id: 'zig',
    label: 'Zig',
    monacoId: 'zig',
    fileExt: '.zig',
    group: 'zig',
    version: '0.13',
    isDefault: true,
    docker: { image: 'euantorano/zig:0.13.0', runCmd: (f) => ['zig', 'run', f] },
    local: { runCmd: (f) => ['zig', 'run', f] },
  },
  ocaml: {
    id: 'ocaml',
    label: 'OCaml',
    monacoId: 'ocaml',
    fileExt: '.ml',
    group: 'ocaml',
    version: '5.x',
    isDefault: true,
    docker: { image: 'ocaml/opam:alpine', runCmd: (f) => ['ocaml', f] },
    local: { runCmd: (f) => ['ocaml', f] },
  },
  clojure: {
    id: 'clojure',
    label: 'Clojure',
    monacoId: 'clojure',
    fileExt: '.clj',
    group: 'clojure',
    version: '1.x',
    isDefault: true,
    docker: {
      image: 'clojure:temurin-21-tools-deps-alpine',
      runCmd: (f) => ['clojure', '-M', f],
    },
    local: { runCmd: (f) => ['clojure', '-M', f] },
  },
  dart: {
    id: 'dart',
    label: 'Dart',
    monacoId: 'dart',
    fileExt: '.dart',
    group: 'dart',
    version: 'stable',
    isDefault: true,
    docker: { image: 'dart:stable', runCmd: (f) => ['dart', 'run', f] },
    local: { runCmd: (f) => ['dart', 'run', f] },
  },
  fsharp: {
    id: 'fsharp',
    label: 'F#',
    monacoId: 'fsharp',
    fileExt: '.fsx',
    group: 'fsharp',
    version: '.NET 8',
    isDefault: true,
    docker: { image: 'mcr.microsoft.com/dotnet/sdk:8.0', runCmd: (f) => ['dotnet', 'fsi', f] },
    local: { runCmd: (f) => ['dotnet', 'fsi', f] },
  },
  sql: {
    id: 'sql',
    label: 'SQL (sqlite)',
    monacoId: 'sql',
    fileExt: '.sql',
    group: 'sql',
    version: 'sqlite',
    isDefault: true,
    docker: { image: 'keinos/sqlite3:latest', runCmd: (f) => ['sh', '-c', `cat ${f} | sqlite3 -bail ":memory:"`] },
    local: { runCmd: (f) => ['sh', '-c', `cat ${f} | sqlite3 -bail ":memory:"`] },
  },
};

/**
 * Old → new id aliases. Keep these accepted on the API so existing pads
 * created before versioned ids keep working.
 */
export const LANGUAGE_ALIASES: Record<string, string> = {
  python: 'python312',
  javascript: 'node20',
  node: 'node20',
  go: 'go122',
  rust: 'rust-stable',
  java: 'java21',
  cpp: 'cpp20',
  'c++': 'cpp20',
};

/** Resolve a language id, following aliases. Returns undefined if unknown. */
export function resolveLanguage(id: string): LanguageSpec | undefined {
  if (LANGUAGES[id]) return LANGUAGES[id];
  const aliased = LANGUAGE_ALIASES[id];
  if (aliased && LANGUAGES[aliased]) return LANGUAGES[aliased];
  return undefined;
}

export const LANGUAGE_IDS = Object.keys(LANGUAGES);

/** Default language id for a given group (e.g. 'python' → 'python312'). */
export function defaultForGroup(group: string): string | undefined {
  for (const spec of Object.values(LANGUAGES)) {
    if (spec.group === group && spec.isDefault) return spec.id;
  }
  return undefined;
}

export function langForFile(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.fileExt === ext && lang.isDefault) return lang.id;
  }
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.fileExt === ext) return lang.id;
  }
  return 'plaintext';
}

/** Grouped languages for UI selectors. */
export function groupedLanguages(): Array<{
  group: string;
  label: string;
  versions: LanguageSpec[];
}> {
  const byGroup = new Map<string, LanguageSpec[]>();
  for (const spec of Object.values(LANGUAGES)) {
    const g = spec.group ?? spec.id;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(spec);
  }
  return Array.from(byGroup.entries()).map(([group, versions]) => ({
    group,
    label: versions[0].label,
    versions,
  }));
}
