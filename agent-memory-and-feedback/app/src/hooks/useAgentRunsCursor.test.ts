import { describe, expect, it } from 'vitest';
import {
  advanceState,
  rewindState,
  ingestCursor,
  initialPageState,
  type PageState,
} from './useAgentRunsCursor';

const cur = (v: string) => ({ value: v });

describe('useAgentRunsCursor cursor state', () => {
  it('initialPageState is page 1, no cursor, no next', () => {
    expect(initialPageState).toEqual({
      cursors: [undefined],
      pageIndex: 1,
      hasNext: false,
    });
  });

  it('advanceState is a no-op when no forward cursor is known', () => {
    expect(advanceState(initialPageState)).toBe(initialPageState);
  });

  it('ingestCursor stashes the nextCursor at slot pageIndex (i.e. for the *next* page)', () => {
    const after = ingestCursor(initialPageState, cur('p2'), true);
    expect(after.cursors).toEqual([undefined, cur('p2')]);
    expect(after.hasNext).toBe(true);
  });

  it('advanceState moves forward when a next cursor was previously ingested', () => {
    const s1 = ingestCursor(initialPageState, cur('p2'), true);
    const s2 = advanceState(s1);
    expect(s2.pageIndex).toBe(2);
    // The cursor stack survives so prev() can return.
    expect(s2.cursors[1]).toEqual(cur('p2'));
  });

  it('rewindState walks back to page 1 (cursor undefined)', () => {
    const s1 = ingestCursor(initialPageState, cur('p2'), true);
    const s2 = advanceState(s1);
    const s3 = rewindState(s2);
    expect(s3.pageIndex).toBe(1);
    expect(s3.cursors[s3.pageIndex - 1]).toBeUndefined();
  });

  it('hasNext is false on the last page even when a stale cursor is in the stack', () => {
    // Pretend page 2 was the last page: ingestCursor with hasNextPage=false.
    const s1 = ingestCursor(initialPageState, cur('p2'), true);
    const s2 = advanceState(s1);
    const s3 = ingestCursor(s2, undefined, false);
    expect(s3.hasNext).toBe(false);
    // advanceState now no-ops.
    expect(advanceState(s3)).toBe(s3);
  });

  it('rewindState on page 1 is a no-op', () => {
    const s: PageState = { ...initialPageState, pageIndex: 1 };
    expect(rewindState(s)).toBe(s);
  });
});
