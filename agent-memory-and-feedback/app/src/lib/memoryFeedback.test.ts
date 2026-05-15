import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  listMemoryFeedback,
  ingestFeedbackToMemory,
  deleteFeedback,
  flattenSpansToRows,
  AuthExpiredError,
  type MemoryEnv,
  type FeedbackSpanEntry,
} from './memoryFeedback';

const env: MemoryEnv = {
  baseUrl: 'https://cloud.api.uipath.com',
  orgName: 'your-org',
  tenantName: 'Memory',
  internalTenantIdGuid: '11111111-1111-1111-1111-111111111111',
  internalAccountId: '4f8f25b4-9a65-4c2a-8934-304f76311581',
  agentFolderKey: '22222222-2222-2222-2222-222222222222',
  memoryFolderKey: '1376f2fb-6b6c-4123-8179-ecce0054606a',
  agentId: '33333333-3333-3333-3333-333333333333',
  token: 'test-token',
};

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('memoryFeedback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('listMemoryFeedback', () => {
    it('GETs the portal-host URL with internal headers and time-range params', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      mock.mockResolvedValueOnce(
        okJson([{ id: 'fb-1', attributes: '{"agentId":"x"}' }]) as unknown as Response,
      );
      const out = await listMemoryFeedback(env, { startMs: 1000, endMs: 2000 });
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe('fb-1');
      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://cloud.uipath.com/your-org/11111111-1111-1111-1111-111111111111/llmopstenant_/api/Agent/feedback/spans/memories/?absoluteStartTime=1000&absoluteEndTime=2000',
      );
      expect(init.method).toBe('GET');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-token');
      expect(headers['X-UiPath-Internal-AccountId']).toBe('4f8f25b4-9a65-4c2a-8934-304f76311581');
      expect(headers['X-UiPath-Internal-TenantId']).toBe('11111111-1111-1111-1111-111111111111');
      expect(headers['X-UiPath-Internal-TenantName']).toBe('Memory');
      // List call should NOT send a folder key.
      expect(headers['X-UiPath-FolderKey']).toBeUndefined();
    });

    it('unwraps {value: [...]} envelope when the API returns one', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      mock.mockResolvedValueOnce(
        okJson({ value: [{ id: 'a' }, { id: 'b' }] }) as unknown as Response,
      );
      const out = await listMemoryFeedback(env, { startMs: 1, endMs: 2 });
      expect(out.map((e) => e.id)).toEqual(['a', 'b']);
    });
  });

  describe('ingestFeedbackToMemory', () => {
    it('POSTs to the ingest URL with the memory folder key + body shape', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      mock.mockResolvedValueOnce(okJson({}, 200) as unknown as Response);
      await ingestFeedbackToMemory(
        env,
        '44444444-4444-4444-4444-444444444444',
        'Resolution Draft Memory',
        { feedbackId: 'fb-1', attributes: '{"type":"agentRun"}' },
      );
      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://cloud.uipath.com/your-org/11111111-1111-1111-1111-111111111111/llmopstenant_/api/Agent/memory/44444444-4444-4444-4444-444444444444/ingest?memorySpaceName=Resolution%20Draft%20Memory',
      );
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-UiPath-FolderKey']).toBe('1376f2fb-6b6c-4123-8179-ecce0054606a');
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ feedbackId: 'fb-1', attributes: '{"type":"agentRun"}' });
    });

    it('throws (and skips the network call) when attributes is empty', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      await expect(
        ingestFeedbackToMemory(env, 'm', 'M', { feedbackId: 'fb', attributes: '' }),
      ).rejects.toThrow(/attributes blob/);
      expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('deleteFeedback', () => {
    it('DELETEs with the AGENT folder key (not memory)', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      mock.mockResolvedValueOnce(new Response(null, { status: 204 }) as unknown as Response);
      await deleteFeedback(env, 'fb-1');
      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://cloud.uipath.com/your-org/11111111-1111-1111-1111-111111111111/llmopstenant_/api/Feedback/fb-1',
      );
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
      const headers = init.headers as Record<string, string>;
      expect(headers['X-UiPath-FolderKey']).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('throws AuthExpiredError on 401/403', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      mock.mockResolvedValueOnce(
        new Response('forbidden', { status: 403, statusText: 'Forbidden' }) as unknown as Response,
      );
      await expect(deleteFeedback(env, 'fb-1')).rejects.toBeInstanceOf(AuthExpiredError);
    });

    it('throws a generic Error on other non-2xx (not AuthExpiredError)', async () => {
      const mock = vi.mocked(fetch as unknown as typeof fetch);
      mock.mockResolvedValueOnce(
        new Response('boom', { status: 500, statusText: 'Internal Server Error' }) as unknown as Response,
      );
      const p = deleteFeedback(env, 'fb-1');
      await expect(p).rejects.toThrow(/500 Internal/);
      await p.catch((e) => expect(e).not.toBeInstanceOf(AuthExpiredError));
    });
  });

  describe('flattenSpansToRows', () => {
    it('emits one row per feedback comment, copying attributes down from the span', () => {
      const spans: FeedbackSpanEntry[] = [
        {
          id: '00000000-0000-0000-aaaa-aaaaaaaaaaaa', // spanId
          attributes: '{"x":1}',
          traceId: 'trace-1',
          jobKey: 'job-1',
          referenceId: 'agent-1',
          endTime: '2026-05-11T00:00:00Z',
          feedbacks: [
            { id: 'fb-1', isPositive: true, comment: 'looks good', userEmail: 'a@b' },
            { id: 'fb-2', isPositive: false, comment: 'nope', userEmail: 'c@d' },
          ],
        },
        {
          id: '00000000-0000-0000-bbbb-bbbbbbbbbbbb',
          attributes: '{"x":2}',
          feedbacks: [{ id: 'fb-3', isPositive: true }],
        },
      ];
      const rows = flattenSpansToRows(spans);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        feedbackId: 'fb-1',
        spanId: '00000000-0000-0000-aaaa-aaaaaaaaaaaa',
        traceId: 'trace-1',
        jobKey: 'job-1',
        agentId: 'agent-1',
        isPositive: true,
        comment: 'looks good',
        userEmail: 'a@b',
        attributes: '{"x":1}',
        inMemory: false,
      });
      expect(rows[2].feedbackId).toBe('fb-3');
      expect(rows[2].attributes).toBe('{"x":2}');
    });

    it('marks rows whose feedback has been ingested into any memory space (when memoryId is omitted)', () => {
      const spans: FeedbackSpanEntry[] = [
        {
          id: 'span-1',
          attributes: 'a',
          feedbacks: [
            { id: 'fresh', memories: [] },
            { id: 'triaged', memories: [{ memorySpaceId: 'm1' }] },
          ],
        },
      ];
      const rows = flattenSpansToRows(spans);
      expect(rows.find((r) => r.feedbackId === 'fresh')?.inMemory).toBe(false);
      expect(rows.find((r) => r.feedbackId === 'triaged')?.inMemory).toBe(true);
    });

    it('scopes inMemory to the active memorySpaceId — feedback in another space does NOT count', () => {
      const spans: FeedbackSpanEntry[] = [
        {
          id: 'span-1',
          attributes: 'a',
          feedbacks: [
            { id: 'in-mA', memories: [{ memorySpaceId: 'mA' }] },
            { id: 'in-mB', memories: [{ memorySpaceId: 'mB' }] },
            { id: 'in-both', memories: [{ memorySpaceId: 'mA' }, { memorySpaceId: 'mB' }] },
          ],
        },
      ];
      const rows = flattenSpansToRows(spans, 'mA');
      expect(rows.find((r) => r.feedbackId === 'in-mA')?.inMemory).toBe(true);
      expect(rows.find((r) => r.feedbackId === 'in-mB')?.inMemory).toBe(false);
      expect(rows.find((r) => r.feedbackId === 'in-both')?.inMemory).toBe(true);
    });

    it('handles spans with no feedbacks gracefully', () => {
      const out = flattenSpansToRows([{ id: 'span-x', attributes: 'a' }]);
      expect(out).toEqual([]);
    });
  });
});
