import { api } from './api';

export interface Question {
  id: string;
  title: string;
  body: string;
  language: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export interface RubricScore {
  correctness: number;
  style: number;
  communication: number;
  problemSolving: number;
  notes: string;
  decision: 'hire' | 'no_hire' | 'maybe' | 'pending';
  updatedAt: string;
}

export interface InterviewerView {
  role: 'interviewer';
  question: Question | null;
  score: RubricScore | null;
}

export interface CandidateView {
  role: 'candidate';
  question: Pick<Question, 'id' | 'title' | 'body' | 'language' | 'difficulty'> | null;
}

export type InterviewView = InterviewerView | CandidateView;

export const interviewApi = {
  listQuestions: () => api.get<{ questions: Question[] }>('/api/questions'),
  createQuestion: (body: Partial<Question> & { title: string; body: string }) =>
    api.post<{ question: Question }>('/api/questions', body),
  view: (slug: string) => api.get<InterviewView>(`/api/pads/${slug}/interview`),
  saveScore: (slug: string, body: Partial<RubricScore>) =>
    api.patch<{ score: RubricScore }>(`/api/pads/${slug}/interview/score`, body),
  attach: (slug: string, questionId: string | null) =>
    api.post<{ ok: true }>(`/api/pads/${slug}/interview/attach`, { questionId }),
};
