import { useMutation } from '@tanstack/react-query';
import type { AIReviewComment } from '@opencoder/shared';
import { api, HttpError } from '../lib/api';

interface ReviewResponse {
  provider: 'anthropic' | 'openai' | 'none';
  model: string | null;
  comments: AIReviewComment[];
  rawLatencyMs: number;
}

interface Props {
  slug: string;
  comments: AIReviewComment[];
  setComments: (c: AIReviewComment[]) => void;
}

export function AIReviewPanel({ slug, comments, setComments }: Props) {
  const review = useMutation({
    mutationFn: () => api.post<ReviewResponse>(`/api/pads/${slug}/ai-review`),
    onSuccess: (r) => setComments(r.comments),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-800 px-3 py-2 flex items-center justify-between">
        <div>
          <span className="text-xs uppercase tracking-wide text-zinc-500">AI review</span>
          {review.data?.provider && review.data.provider !== 'none' && (
            <span className="ml-2 text-xs text-zinc-500">
              {review.data.provider} · {review.data.model}
            </span>
          )}
        </div>
        <button
          className="btn-secondary !py-1 !text-xs"
          onClick={() => review.mutate()}
          disabled={review.isPending}
        >
          {review.isPending ? 'Reviewing…' : 'Run review'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {review.isError && (
          <div className="text-xs text-red-400">
            {review.error instanceof HttpError ? review.error.error : 'Failed'}
          </div>
        )}
        {review.isSuccess && comments.length === 0 && (
          <div className="text-zinc-500 text-xs">
            {review.data.provider === 'none'
              ? 'AI review is disabled. Set AI_PROVIDER + an API key on the server.'
              : 'No comments — looks good!'}
          </div>
        )}
        {!review.isSuccess && comments.length === 0 && (
          <div className="text-zinc-500 text-xs">Click "Run review" for an AI critique.</div>
        )}
        <ul className="space-y-2">
          {comments.map((c, i) => (
            <li
              key={i}
              className={`p-2 rounded border ${
                c.severity === 'error'
                  ? 'border-red-700 bg-red-950/20'
                  : c.severity === 'warn'
                    ? 'border-amber-700 bg-amber-950/20'
                    : 'border-zinc-700 bg-zinc-900/40'
              }`}
            >
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-300">{c.file}</span>:{c.line} ·{' '}
                <span
                  className={
                    c.severity === 'error'
                      ? 'text-red-400'
                      : c.severity === 'warn'
                        ? 'text-amber-400'
                        : 'text-brand-400'
                  }
                >
                  {c.severity}
                </span>
              </div>
              <div className="text-zinc-200 mt-1">{c.comment}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
