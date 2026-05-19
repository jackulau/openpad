export interface LanguageSpec {
  id: string;
  label: string;
  monacoId: string;
  fileExt: string;
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

export const LANGUAGES: Record<string, LanguageSpec> = {
  python: {
    id: 'python',
    label: 'Python',
    monacoId: 'python',
    fileExt: '.py',
    docker: { image: 'python:3.12-alpine', runCmd: (f) => ['python', f] },
    local: { runCmd: (f) => ['python3', f] },
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    monacoId: 'javascript',
    fileExt: '.js',
    docker: { image: 'node:20-alpine', runCmd: (f) => ['node', f] },
    local: { runCmd: (f) => ['node', f] },
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    monacoId: 'typescript',
    fileExt: '.ts',
    docker: {
      image: 'node:20-alpine',
      runCmd: (f) => ['sh', '-c', `npx --yes -p typescript tsx ${f} || npx --yes tsx ${f}`],
    },
    local: { runCmd: (f) => ['npx', '--yes', 'tsx', f] },
  },
  go: {
    id: 'go',
    label: 'Go',
    monacoId: 'go',
    fileExt: '.go',
    docker: { image: 'golang:1.22-alpine', runCmd: (f) => ['go', 'run', f] },
    local: { runCmd: (f) => ['go', 'run', f] },
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    monacoId: 'rust',
    fileExt: '.rs',
    docker: {
      image: 'rust:1.78-alpine',
      runCmd: (f) => ['sh', '-c', `rustc -O ${f} -o /tmp/a.out && /tmp/a.out`],
    },
    local: {
      compileCmd: (f) => ['rustc', '-O', f, '-o', `/tmp/${stripExt(f)}.out`],
      runCmd: (f) => [`/tmp/${stripExt(f)}.out`],
      artifactPath: (f) => `/tmp/${stripExt(f)}.out`,
    },
  },
  java: {
    id: 'java',
    label: 'Java',
    monacoId: 'java',
    fileExt: '.java',
    docker: {
      image: 'eclipse-temurin:21-jdk-alpine',
      runCmd: (f) => ['sh', '-c', `javac ${f} && java ${stripExt(f)}`],
    },
    local: { runCmd: (f) => ['sh', '-c', `javac ${f} && java ${stripExt(f)}`] },
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    monacoId: 'cpp',
    fileExt: '.cpp',
    docker: {
      image: 'gcc:14-bookworm',
      runCmd: (f) => ['sh', '-c', `g++ -O2 -std=c++20 ${f} -o /tmp/a.out && /tmp/a.out`],
    },
    local: { runCmd: (f) => ['sh', '-c', `g++ -O2 -std=c++20 ${f} -o /tmp/a.out && /tmp/a.out`] },
  },
  c: {
    id: 'c',
    label: 'C',
    monacoId: 'c',
    fileExt: '.c',
    docker: {
      image: 'gcc:14-bookworm',
      runCmd: (f) => ['sh', '-c', `gcc -O2 ${f} -o /tmp/a.out && /tmp/a.out`],
    },
    local: { runCmd: (f) => ['sh', '-c', `gcc -O2 ${f} -o /tmp/a.out && /tmp/a.out`] },
  },
  ruby: {
    id: 'ruby',
    label: 'Ruby',
    monacoId: 'ruby',
    fileExt: '.rb',
    docker: { image: 'ruby:3.3-alpine', runCmd: (f) => ['ruby', f] },
    local: { runCmd: (f) => ['ruby', f] },
  },
  csharp: {
    id: 'csharp',
    label: 'C#',
    monacoId: 'csharp',
    fileExt: '.cs',
    docker: { image: 'mcr.microsoft.com/dotnet/sdk:8.0', runCmd: (f) => ['dotnet', 'script', f] },
    local: { runCmd: (f) => ['dotnet', 'script', f] },
  },
  kotlin: {
    id: 'kotlin',
    label: 'Kotlin',
    monacoId: 'kotlin',
    fileExt: '.kt',
    docker: {
      image: 'zenika/kotlin:1.9',
      runCmd: (f) => ['sh', '-c', `kotlinc -script ${f}`],
    },
    local: { runCmd: (f) => ['kotlinc', '-script', f] },
  },
  swift: {
    id: 'swift',
    label: 'Swift',
    monacoId: 'swift',
    fileExt: '.swift',
    docker: { image: 'swift:5.10-jammy', runCmd: (f) => ['swift', f] },
    local: { runCmd: (f) => ['swift', f] },
  },
  php: {
    id: 'php',
    label: 'PHP',
    monacoId: 'php',
    fileExt: '.php',
    docker: { image: 'php:8.3-alpine', runCmd: (f) => ['php', f] },
    local: { runCmd: (f) => ['php', f] },
  },
  bash: {
    id: 'bash',
    label: 'Bash',
    monacoId: 'shell',
    fileExt: '.sh',
    docker: { image: 'bash:5.2', runCmd: (f) => ['bash', f] },
    local: { runCmd: (f) => ['bash', f] },
  },
  lua: {
    id: 'lua',
    label: 'Lua',
    monacoId: 'lua',
    fileExt: '.lua',
    docker: { image: 'nickblah/lua:5.4-alpine', runCmd: (f) => ['lua', f] },
    local: { runCmd: (f) => ['lua', f] },
  },
  elixir: {
    id: 'elixir',
    label: 'Elixir',
    monacoId: 'elixir',
    fileExt: '.exs',
    docker: { image: 'elixir:1.16-alpine', runCmd: (f) => ['elixir', f] },
    local: { runCmd: (f) => ['elixir', f] },
  },
  haskell: {
    id: 'haskell',
    label: 'Haskell',
    monacoId: 'haskell',
    fileExt: '.hs',
    docker: { image: 'haskell:9.6', runCmd: (f) => ['runghc', f] },
    local: { runCmd: (f) => ['runghc', f] },
  },
  scala: {
    id: 'scala',
    label: 'Scala',
    monacoId: 'scala',
    fileExt: '.scala',
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
    docker: { image: 'perl:5.38-slim', runCmd: (f) => ['perl', f] },
    local: { runCmd: (f) => ['perl', f] },
  },
  r: {
    id: 'r',
    label: 'R',
    monacoId: 'r',
    fileExt: '.r',
    docker: { image: 'r-base:4.4.1', runCmd: (f) => ['Rscript', f] },
    local: { runCmd: (f) => ['Rscript', f] },
  },
  julia: {
    id: 'julia',
    label: 'Julia',
    monacoId: 'julia',
    fileExt: '.jl',
    docker: { image: 'julia:1.10-alpine', runCmd: (f) => ['julia', f] },
    local: { runCmd: (f) => ['julia', f] },
  },
  zig: {
    id: 'zig',
    label: 'Zig',
    monacoId: 'zig',
    fileExt: '.zig',
    docker: { image: 'euantorano/zig:0.13.0', runCmd: (f) => ['zig', 'run', f] },
    local: { runCmd: (f) => ['zig', 'run', f] },
  },
  ocaml: {
    id: 'ocaml',
    label: 'OCaml',
    monacoId: 'ocaml',
    fileExt: '.ml',
    docker: { image: 'ocaml/opam:alpine', runCmd: (f) => ['ocaml', f] },
    local: { runCmd: (f) => ['ocaml', f] },
  },
  clojure: {
    id: 'clojure',
    label: 'Clojure',
    monacoId: 'clojure',
    fileExt: '.clj',
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
    docker: { image: 'dart:stable', runCmd: (f) => ['dart', 'run', f] },
    local: { runCmd: (f) => ['dart', 'run', f] },
  },
  fsharp: {
    id: 'fsharp',
    label: 'F#',
    monacoId: 'fsharp',
    fileExt: '.fsx',
    docker: { image: 'mcr.microsoft.com/dotnet/sdk:8.0', runCmd: (f) => ['dotnet', 'fsi', f] },
    local: { runCmd: (f) => ['dotnet', 'fsi', f] },
  },
  sql: {
    id: 'sql',
    label: 'SQL (sqlite)',
    monacoId: 'sql',
    fileExt: '.sql',
    docker: { image: 'keinos/sqlite3:latest', runCmd: (f) => ['sh', '-c', `cat ${f} | sqlite3 -bail ":memory:"`] },
    local: { runCmd: (f) => ['sh', '-c', `cat ${f} | sqlite3 -bail ":memory:"`] },
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES);

export function langForFile(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.fileExt === ext) return lang.id;
  }
  return 'plaintext';
}
