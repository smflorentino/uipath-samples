import { describe, expect, it } from 'vitest';
import { latestPerDispute } from './draftDedup';

interface Row {
  Id: string;
  disputeId: string;
  CreateTime: string;
}

const r = (Id: string, disputeId: string, CreateTime: string): Row => ({
  Id,
  disputeId,
  CreateTime,
});

describe('latestPerDispute', () => {
  it('keeps the newest row for each disputeId and sorts newest-first', () => {
    const rows: Row[] = [
      r('a', 'd1', '2026-05-08T10:00:00Z'),
      r('b', 'd1', '2026-05-09T10:00:00Z'),
      r('c', 'd1', '2026-05-07T10:00:00Z'),
      r('d', 'd2', '2026-05-05T10:00:00Z'),
    ];
    expect(latestPerDispute(rows, 'disputeId', 'CreateTime').map((x) => x.Id)).toEqual([
      'b',
      'd',
    ]);
  });

  it('preserves all disputes when each has a single row', () => {
    const rows: Row[] = [
      r('a', 'd1', '2026-05-08T10:00:00Z'),
      r('b', 'd2', '2026-05-09T10:00:00Z'),
      r('c', 'd3', '2026-05-07T10:00:00Z'),
    ];
    const out = latestPerDispute(rows, 'disputeId', 'CreateTime');
    expect(out.map((x) => x.Id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts rows with missing/unparseable CreateTime last', () => {
    const rows: Row[] = [
      { Id: 'a', disputeId: 'd1', CreateTime: '' },
      r('b', 'd2', '2026-05-09T10:00:00Z'),
      r('c', 'd3', 'not-a-date'),
    ];
    const out = latestPerDispute(rows, 'disputeId', 'CreateTime');
    expect(out[0].Id).toBe('b');
    expect(out.slice(1).map((x) => x.Id).sort()).toEqual(['a', 'c']);
  });

  it('keeps rows with a missing disputeId as orphans at the end', () => {
    const rows: Array<Partial<Row> & { Id: string }> = [
      { Id: 'a', disputeId: '', CreateTime: '2026-05-08T10:00:00Z' },
      r('b', 'd1', '2026-05-09T10:00:00Z'),
    ];
    const out = latestPerDispute(rows as Row[], 'disputeId', 'CreateTime');
    expect(out.map((x) => x.Id)).toEqual(['b', 'a']);
  });
});
