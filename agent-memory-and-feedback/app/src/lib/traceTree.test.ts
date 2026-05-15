import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildTraceTree,
  flattenTree,
  getTraceBounds,
  normalizeSpan,
  type RawSpan,
} from './traceTree';

const SAMPLE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/sample-trace.json',
);

const loadSample = (): RawSpan[] => JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as RawSpan[];

describe('normalizeSpan', () => {
  it('parses Attributes JSON string into an object', () => {
    const raw: RawSpan = {
      Id: 'a',
      TraceId: 't',
      ParentId: null,
      Name: 'root',
      StartTime: '2026-01-01T00:00:00Z',
      EndTime: '2026-01-01T00:00:01Z',
      Attributes: JSON.stringify({ foo: 'bar', n: 1 }),
      Status: 1,
      SpanType: 'agentRun',
    };
    const span = normalizeSpan(raw);
    expect(span.attributes).toEqual({ foo: 'bar', n: 1 });
    expect(span.durationMs).toBe(1000);
    expect(span.spanType).toBe('agentRun');
  });

  it('falls back gracefully on malformed Attributes', () => {
    const raw: RawSpan = {
      Id: 'a',
      TraceId: 't',
      ParentId: null,
      Name: 'root',
      StartTime: '2026-01-01T00:00:00Z',
      EndTime: '2026-01-01T00:00:01Z',
      Attributes: 'not-json',
    };
    expect(normalizeSpan(raw).attributes).toEqual({ _rawAttributes: 'not-json' });
  });
});

describe('buildTraceTree', () => {
  it('returns [] for empty input', () => {
    expect(buildTraceTree([])).toEqual([]);
  });

  it('builds a single-root tree from the sample trace', () => {
    const spans = loadSample();
    const roots = buildTraceTree(spans);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('Agent run - Agent');
    expect(roots[0].depth).toBe(0);
  });

  it('preserves all 14 spans across the tree', () => {
    const spans = loadSample();
    const roots = buildTraceTree(spans);
    const flat = flattenTree(roots);
    expect(flat).toHaveLength(spans.length);
  });

  it('correctly nests Tool call > Analyze_Files > LLM call > Model run', () => {
    const spans = loadSample();
    const roots = buildTraceTree(spans);
    const root = roots[0];
    const toolCall = root.children.find((c) => c.name.startsWith('Tool call - Analyze_Files'));
    expect(toolCall).toBeDefined();
    expect(toolCall!.depth).toBe(1);

    const analyzeFiles = toolCall!.children.find((c) => c.name === 'Analyze_Files');
    expect(analyzeFiles).toBeDefined();
    expect(analyzeFiles!.depth).toBe(2);

    const llmCall = analyzeFiles!.children.find((c) => c.name === 'LLM call');
    expect(llmCall).toBeDefined();
    expect(llmCall!.depth).toBe(3);

    const modelRun = llmCall!.children.find((c) => c.name === 'Model run');
    expect(modelRun).toBeDefined();
    expect(modelRun!.depth).toBe(4);
  });

  it('sorts siblings by StartTime ascending', () => {
    const spans = loadSample();
    const roots = buildTraceTree(spans);
    const childStarts = roots[0].children.map((c) => c.startMs);
    const sorted = [...childStarts].sort((a, b) => a - b);
    expect(childStarts).toEqual(sorted);
  });

  it('promotes orphans to roots when ParentId references a missing span', () => {
    const spans: RawSpan[] = [
      {
        Id: 'orphan',
        TraceId: 't',
        ParentId: 'missing-parent',
        Name: 'orphan span',
        StartTime: '2026-01-01T00:00:00Z',
        EndTime: '2026-01-01T00:00:01Z',
      },
    ];
    const roots = buildTraceTree(spans);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('orphan span');
  });
});

describe('getTraceBounds', () => {
  it('computes total duration covering all spans', () => {
    const spans = loadSample().map(normalizeSpan);
    const bounds = getTraceBounds(spans);
    expect(bounds.durationMs).toBeGreaterThan(0);
    expect(bounds.endMs).toBeGreaterThan(bounds.startMs);
  });

  it('returns zeroes for empty input', () => {
    expect(getTraceBounds([])).toEqual({ startMs: 0, endMs: 0, durationMs: 0 });
  });
});
