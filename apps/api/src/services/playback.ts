import { prisma } from '../db.js';

export interface PlaybackEvent {
  id: string;
  ts: number;
  kind: 'yjs' | 'run' | 'chat' | 'snapshot' | 'file' | 'terminal';
  fileId: string | null;
  userId: string | null;
  userName: string | null;
  /** Base64 of the binary payload for yjs/snapshot; JSON-text for run/terminal; chat is plain text body. */
  payload?: string;
  meta?: Record<string, unknown>;
}

export interface PlaybackTimeline {
  padId: string;
  files: Array<{ id: string; name: string; language: string }>;
  events: PlaybackEvent[];
  startedAt: string;
  endedAt: string;
}

export interface TimelineOptions {
  /** Inclusive lower bound for event createdAt. */
  from?: Date;
  /** Inclusive upper bound for event createdAt. */
  to?: Date;
}

export async function buildTimeline(
  padId: string,
  opts: TimelineOptions = {},
): Promise<PlaybackTimeline> {
  const range = opts.from || opts.to ? buildRange(opts) : {};
  const [pad, files, edits, chats] = await Promise.all([
    prisma.pad.findUnique({ where: { id: padId } }),
    prisma.padFile.findMany({
      where: { padId },
      select: { id: true, name: true, language: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.editEvent.findMany({
      where: { padId, ...(range.createdAt ? { createdAt: range.createdAt } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.chatMessage.findMany({
      where: { padId, ...(range.createdAt ? { createdAt: range.createdAt } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  if (!pad) {
    return {
      padId,
      files: [],
      events: [],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
  }

  const events: PlaybackEvent[] = [];
  for (const e of edits) {
    let meta: Record<string, unknown> | undefined;
    if (e.meta) {
      try {
        meta = JSON.parse(e.meta) as Record<string, unknown>;
      } catch {
        meta = undefined;
      }
    }
    let payload: string | undefined;
    if (e.kind === 'yjs' || e.kind === 'snapshot') {
      payload = Buffer.from(e.payload).toString('base64');
    } else if (e.kind === 'run' || e.kind === 'terminal') {
      payload = e.payload.toString('utf8');
    }
    events.push({
      id: e.id,
      ts: e.createdAt.getTime(),
      kind: e.kind as PlaybackEvent['kind'],
      fileId: e.fileId,
      userId: e.user?.id ?? null,
      userName: e.user?.name ?? null,
      payload,
      meta,
    });
  }
  for (const c of chats) {
    events.push({
      id: c.id,
      ts: c.createdAt.getTime(),
      kind: 'chat',
      fileId: null,
      userId: c.user.id,
      userName: c.user.name,
      payload: c.body,
    });
  }

  events.sort((a, b) => a.ts - b.ts);

  const startedAt = events.length > 0 ? new Date(events[0].ts).toISOString() : pad.createdAt.toISOString();
  const endedAt =
    events.length > 0
      ? new Date(events[events.length - 1].ts).toISOString()
      : pad.updatedAt.toISOString();

  return {
    padId,
    files,
    events,
    startedAt,
    endedAt,
  };
}

function buildRange(
  opts: TimelineOptions,
): { createdAt?: { gte?: Date; lte?: Date } } {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (opts.from) createdAt.gte = opts.from;
  if (opts.to) createdAt.lte = opts.to;
  return { createdAt };
}
