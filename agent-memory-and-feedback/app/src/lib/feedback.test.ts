import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  submitFeedback,
  normalizeSpanIdToGuid,
  DEFAULT_FEEDBACK_CATEGORIES,
  type FeedbackEnv,
  type FeedbackPayload,
} from './feedback';

describe('normalizeSpanIdToGuid', () => {
  it('pads 16-char hex span IDs to the GUID-with-zero-upper form', () => {
    expect(normalizeSpanIdToGuid('1f59b187ebd7bf55')).toBe('00000000-0000-0000-1f59-b187ebd7bf55');
    expect(normalizeSpanIdToGuid('75EB072AAEDD7633')).toBe('00000000-0000-0000-75eb-072aaedd7633');
  });
  it('leaves GUID-shaped IDs alone (lowercased)', () => {
    expect(normalizeSpanIdToGuid('00000000-0000-0000-1F59-B187EBD7BF55')).toBe(
      '00000000-0000-0000-1f59-b187ebd7bf55',
    );
  });
  it('passes through non-conforming strings', () => {
    expect(normalizeSpanIdToGuid('weird')).toBe('weird');
    expect(normalizeSpanIdToGuid('')).toBe('');
  });
});

const env: FeedbackEnv = {
  baseUrl: 'https://cloud.api.uipath.com',
  orgName: 'your-org',
  tenantName: 'DefaultTenant',
  token: 'test-token-123',
};

const payload: FeedbackPayload = {
  traceId: '01dec7b3-86f8-4944-bc42-d58d48688678',
  spanId: '00000000-0000-0000-1f59-b187ebd7bf55',
  agentId: '84c28ed0-1afa-4a9f-90f9-b0c5c6d0acd2',
  agentVersion: '1.0.0',
  spanType: 'agentRun',
  comment: 'looks good',
  isPositive: true,
  folderKey: 'ea8ac278-9469-4718-9169-c0d8ac87be91',
};

const ok201 = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

describe('submitFeedback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /llmopstenant_/api/Feedback with the discovered body shape', async () => {
    const mock = vi.mocked(fetch as unknown as typeof fetch);
    mock.mockResolvedValueOnce(
      ok201({
        id: 'fb-1',
        traceId: payload.traceId,
        spanId: payload.spanId,
        agentId: payload.agentId,
        agentVersion: payload.agentVersion,
        comment: payload.comment,
        isPositive: true,
        createdAt: '2026-05-08T15:48:34Z',
        updatedAt: '2026-05-08T15:48:34Z',
      }) as unknown as Response,
    );

    const out = await submitFeedback(env, payload);

    expect(out.id).toBe('fb-1');
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://cloud.api.uipath.com/your-org/DefaultTenant/llmopstenant_/api/Feedback',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-uipath-folderkey']).toBe('ea8ac278-9469-4718-9169-c0d8ac87be91');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      traceId: payload.traceId,
      spanId: payload.spanId,
      agentId: payload.agentId,
      agentVersion: payload.agentVersion,
      spanType: 'agentRun',
      comment: 'looks good',
      isPositive: true,
      categories: DEFAULT_FEEDBACK_CATEGORIES,
    });
  });

  it('falls back to DEFAULT_FEEDBACK_CATEGORIES when categories is omitted', async () => {
    const mock = vi.mocked(fetch as unknown as typeof fetch);
    mock.mockResolvedValueOnce(ok201({ id: 'x', createdAt: '', updatedAt: '' } as unknown) as unknown as Response);
    await submitFeedback(env, { ...payload, categories: undefined });
    const body = JSON.parse((mock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.categories).toEqual([{ id: '00000000-0000-0000-0000-000000000000', category: 'Output' }]);
  });

  it('preserves caller-supplied categories', async () => {
    const mock = vi.mocked(fetch as unknown as typeof fetch);
    mock.mockResolvedValueOnce(ok201({ id: 'z', createdAt: '', updatedAt: '' } as unknown) as unknown as Response);
    const custom = [{ id: 'cat-1', category: 'Tone' }];
    await submitFeedback(env, { ...payload, categories: custom });
    const body = JSON.parse((mock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.categories).toEqual(custom);
  });

  it('throws with status text on non-2xx', async () => {
    const mock = vi.mocked(fetch as unknown as typeof fetch);
    mock.mockResolvedValueOnce(
      new Response('forbidden', { status: 403, statusText: 'Forbidden' }) as unknown as Response,
    );
    await expect(submitFeedback(env, payload)).rejects.toThrow(/403 Forbidden/);
  });

  it('serializes isPositive=false for negative feedback', async () => {
    const mock = vi.mocked(fetch as unknown as typeof fetch);
    mock.mockResolvedValueOnce(ok201({ id: 'y', createdAt: '', updatedAt: '' }) as unknown as Response);
    await submitFeedback(env, { ...payload, isPositive: false, comment: 'nope' });
    const body = JSON.parse((mock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.isPositive).toBe(false);
    expect(body.comment).toBe('nope');
  });

  it('refuses to submit (and skips the network call) when agentVersion is empty', async () => {
    const mock = vi.mocked(fetch as unknown as typeof fetch);
    await expect(submitFeedback(env, { ...payload, agentVersion: '' })).rejects.toThrow(
      /agentVersion is required/,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
