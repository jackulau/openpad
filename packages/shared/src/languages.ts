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
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES);

export function langForFile(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.fileExt === ext) return lang.id;
  }
  return 'plaintext';
}
