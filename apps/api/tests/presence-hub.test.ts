import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTest,
  addConn,
  getPresenceCounts,
  getPresenceUsers,
  removeConn,
  subscribePresence,
  type PadConn,
} from '../src/ws/hub.js';

function fakeConn(padId: string, userId: string, name: string): PadConn {
  return {
    ws: { send: () => undefined, readyState: 1 } as unknown as PadConn['ws'],
    userId,
    userName: name,
    padId,
    color: '#abc',
    alive: true,
  };
}

beforeEach(() => {
  _resetForTest();
});

describe('hub presence', () => {
  it('counts connections per pad', () => {
    addConn(fakeConn('pad-1', 'u1', 'Alice'));
    addConn(fakeConn('pad-1', 'u2', 'Bob'));
    addConn(fakeConn('pad-2', 'u3', 'Carol'));
    expect(getPresenceCounts()).toEqual({ 'pad-1': 2, 'pad-2': 1 });
  });

  it('drops pads from counts when their last conn leaves', () => {
    const a = fakeConn('pad-1', 'u1', 'A');
    addConn(a);
    expect(getPresenceCounts()).toEqual({ 'pad-1': 1 });
    removeConn(a);
    expect(getPresenceCounts()).toEqual({});
  });

  it('deduplicates users in getPresenceUsers (multiple tabs from same user)', () => {
    addConn(fakeConn('pad-1', 'u1', 'Alice'));
    addConn(fakeConn('pad-1', 'u1', 'Alice'));
    addConn(fakeConn('pad-1', 'u2', 'Bob'));
    const users = getPresenceUsers('pad-1');
    expect(users.map((u) => u.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('fires subscribers on connect and disconnect', () => {
    const seen: string[] = [];
    const unsub = subscribePresence((padId) => seen.push(padId));
    const a = fakeConn('pad-X', 'u1', 'A');
    addConn(a);
    removeConn(a);
    expect(seen).toEqual(['pad-X', 'pad-X']);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const seen: string[] = [];
    const unsub = subscribePresence((padId) => seen.push(padId));
    unsub();
    addConn(fakeConn('pad-Y', 'u1', 'A'));
    expect(seen).toEqual([]);
  });

  it('an observer that throws does not break others', () => {
    const reached: string[] = [];
    const unsubBad = subscribePresence(() => {
      throw new Error('boom');
    });
    const unsubGood = subscribePresence((padId) => reached.push(padId));
    addConn(fakeConn('pad-Z', 'u1', 'A'));
    expect(reached).toEqual(['pad-Z']);
    unsubBad();
    unsubGood();
  });
});
