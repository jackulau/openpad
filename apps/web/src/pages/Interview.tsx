import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '../components/AppHeader';
import { AvatarStack } from '../components/AvatarStack';
import { WhiteboardCanvas } from '../components/WhiteboardCanvas';
import { interviewApi, type RubricScore } from '../lib/interview';
import { padsApi } from '../lib/pads';
import { useCollab } from '../lib/useCollab';
import { useAuth } from '../lib/authStore';
import { HttpError } from '../lib/api';

const DEFAULT_SCORE: RubricScore = {
  correctness: 0,
  style: 0,
  communication: 0,
  problemSolving: 0,
  notes: '',
  decision: 'pending',
  updatedAt: new Date().toISOString(),
};

export function Interview() {
  const { slug = '' } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const pad = useQuery({ queryKey: ['pad', slug], queryFn: () => padsApi.get(slug) });
  const { user } = useAuth();
  const { client, presence } = useCollab(slug);
  const view = useQuery({
    queryKey: ['interview', slug],
    queryFn: () => interviewApi.view(slug),
  });
  const myQuestions = useQuery({
    queryKey: ['my-questions'],
    queryFn: () => interviewApi.listQuestions(),
    enabled: view.data?.role === 'interviewer',
  });

  const [score, setScore] = useState<RubricScore>(DEFAULT_SCORE);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (view.data?.role === 'interviewer' && view.data.score) {
      setScore(view.data.score);
    }
  }, [view.data]);

  const save = useMutation({
    mutationFn: () => interviewApi.saveScore(slug, score),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interview', slug] }),
    onError: (e) => setErr(e instanceof HttpError ? e.error : 'save_failed'),
  });

  const attach = useMutation({
    mutationFn: (qid: string | null) => interviewApi.attach(slug, qid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interview', slug] }),
  });

  const rubricTotal = useMemo(
    () => score.correctness + score.style + score.communication + score.problemSolving,
    [score],
  );

  if (pad.isLoading || view.isLoading)
    return <div className="p-8 text-secondary">loading…</div>;

  if (pad.error || view.error) {
    return (
      <div className="p-8 text-danger">
        Couldn't load interview.{' '}
        <Link to="/dashboard" className="underline">
          Back
        </Link>
      </div>
    );
  }

  if (!view.data) return null;

  const isInterviewer = view.data.role === 'interviewer';
  const question = view.data.question;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="border-b border-line px-4 py-2 flex items-center gap-3">
        <h2 className="font-medium text-sm">
          {pad.data?.pad.title ?? slug} <span className="text-subtle">· interview</span>
        </h2>
        <span className="text-xs text-accent">{view.data.role}</span>
        <AvatarStack me={user ? { id: user.id, name: user.name } : null} presence={presence} />
        <Link to={`/p/${slug}`} className="ml-auto text-xs text-accent underline">
          open code editor
        </Link>
      </div>

      <div className="flex-1 max-w-6xl w-full mx-auto p-6 grid lg:grid-cols-2 gap-6">
        <section className="card p-5 space-y-3">
          <h3 className="text-lg font-semibold">Question</h3>
          {question ? (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium">{question.title}</span>
                {'difficulty' in question && (
                  <span className="text-xs text-secondary uppercase">{question.difficulty}</span>
                )}
              </div>
              <pre className="whitespace-pre-wrap text-sm text-secondary leading-relaxed">
                {question.body}
              </pre>
            </>
          ) : (
            <p className="text-secondary text-sm">
              {isInterviewer
                ? 'No question attached yet. Pick one below.'
                : 'Interviewer has not picked a question yet.'}
            </p>
          )}
          {isInterviewer && (
            <div className="space-y-2 border-t border-line pt-3">
              <label className="text-xs uppercase tracking-wide text-subtle">
                Attach question
              </label>
              <select
                className="input"
                value={question?.id ?? ''}
                onChange={(e) => attach.mutate(e.target.value || null)}
              >
                <option value="">(none)</option>
                {myQuestions.data?.questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title} ({q.difficulty})
                  </option>
                ))}
              </select>
              <QuestionQuickCreate onCreated={() => myQuestions.refetch()} />
            </div>
          )}
        </section>

        {/* Whiteboard for system design sketches — shared across all roles
            so candidate + interviewer can sketch boxes / arrows / labels
            during system-design rounds. */}
        <section className="card p-0 lg:col-span-2 flex flex-col" style={{ minHeight: 480 }}>
          <div className="px-4 py-2 border-b border-line flex items-center gap-3">
            <h3 className="text-sm font-semibold">Whiteboard</h3>
            <span className="text-xs text-subtle">
              For system-design diagrams. Synced live across participants.
            </span>
          </div>
          {client ? (
            <div className="flex-1 min-h-0">
              <WhiteboardCanvas client={client} active={true} slug={slug} />
            </div>
          ) : (
            <div className="p-4 text-xs text-subtle">connecting…</div>
          )}
        </section>

        {isInterviewer && (
          <section className="card p-5 space-y-3 lg:col-span-2">
            <h3 className="text-lg font-semibold">Rubric (private)</h3>
            <p className="text-xs text-subtle">Candidates never see these notes or scores.</p>
            {(
              [
                ['correctness', 'Correctness'],
                ['style', 'Style'],
                ['communication', 'Communication'],
                ['problemSolving', 'Problem solving'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center gap-3">
                <label className="text-sm w-40 text-secondary">{label}</label>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={score[key]}
                  onChange={(e) =>
                    setScore((s) => ({ ...s, [key]: Number(e.target.value) }))
                  }
                  className="flex-1"
                />
                <span className="w-6 text-right tabular-nums">{score[key]}</span>
              </div>
            ))}

            <div>
              <label className="text-xs uppercase tracking-wide text-subtle">Notes</label>
              <textarea
                className="input min-h-[120px] resize-y"
                value={score.notes}
                onChange={(e) => setScore((s) => ({ ...s, notes: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="text-xs uppercase tracking-wide text-subtle">Decision</label>
              <select
                className="input !py-1.5"
                value={score.decision}
                onChange={(e) =>
                  setScore((s) => ({
                    ...s,
                    decision: e.target.value as RubricScore['decision'],
                  }))
                }
              >
                <option value="pending">Pending</option>
                <option value="hire">Hire</option>
                <option value="maybe">Maybe</option>
                <option value="no_hire">No hire</option>
              </select>
              <span className="text-xs text-subtle ml-auto">total {rubricTotal} / 20</span>
            </div>

            {err && <div className="text-xs text-danger">{err}</div>}
            <div className="pt-1">
              <button
                className="btn-primary"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save score'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function QuestionQuickCreate({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  const create = useMutation({
    mutationFn: () => interviewApi.createQuestion({ title, body, difficulty }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setOpen(false);
      onCreated();
    },
  });

  if (!open)
    return (
      <button className="text-xs text-accent underline" onClick={() => setOpen(true)}>
        + add new question
      </button>
    );
  return (
    <div className="space-y-2 border border-line rounded p-3">
      <input
        className="input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="input min-h-[100px]"
        placeholder="Question body (markdown OK)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <select
          className="input !py-1 !text-sm w-32"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <button
          className="btn-primary !py-1"
          onClick={() => create.mutate()}
          disabled={!title || !body || create.isPending}
        >
          Save question
        </button>
        <button className="btn-ghost !py-1" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
