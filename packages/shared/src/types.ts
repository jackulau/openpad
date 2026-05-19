export type Role = 'owner' | 'collaborator' | 'viewer' | 'candidate';

export type PadKind = 'sandbox' | 'interview';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface PadSummary {
  id: string;
  slug: string;
  title: string;
  language: string;
  kind: PadKind;
  ownerId: string;
  hasPassword?: boolean;
  autoRecord?: boolean;
  updatedAt: string;
  createdAt: string;
  myRole: Role;
}

export interface PadFileMeta {
  id: string;
  name: string;
  language: string;
  size: number;
  updatedAt: string;
}

export interface ChatMessageDTO {
  id: string;
  padId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

export interface RunRequest {
  language: string;
  source: string;
  stdin?: string;
  filename?: string;
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  runner: 'docker' | 'docker-pool' | 'subprocess' | 'disabled';
  language: string;
}

export interface InterviewRubric {
  correctness: number;
  style: number;
  communication: number;
  problemSolving: number;
  notes: string;
  decision: 'hire' | 'no_hire' | 'maybe' | 'pending';
}
