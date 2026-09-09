/**
 * Tests for the n8n REST API client.
 *
 * All tests mock the global `fetch` to avoid real network calls.
 *
 * NOTE: N8N_API_URL must include the /api/v1 prefix to match production
 * Docker env (N8N_API_URL=http://n8n:5678/api/v1). The lib functions no
 * longer add /api/v1 themselves to avoid double-prefix bugs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getN8nExecutionStatus,
  triggerN8nWorkflow,
} from './n8n.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ---------------------------------------------------------------------------
// triggerN8nWorkflow
// ---------------------------------------------------------------------------

describe('triggerN8nWorkflow', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('calls POST /webhook/trigger-pipeline with credentials in body', async () => {
    // Production format: N8N_API_URL already contains /api/v1
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';
    process.env['N8N_API_KEY'] = 'test-key';
    process.env['API_URL'] = 'https://automatesocials.tech/api';

    const mockFetch = makeFetchMock(200, { executionId: 42 });
    vi.stubGlobal('fetch', mockFetch);

    const credentials = { heygen_api_key: 'hg-secret', openai_api_key: 'oai-secret' };
    const pipelineConfig = {
      pipeline_id: 'pipe-1',
      user_id: 'user-1',
      niche_keyword: 'AI technology',
    };

    const result = await triggerN8nWorkflow('wf-abc', credentials, pipelineConfig);

    expect(result.executionId).toBe('42');
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    // Webhook URL — strips /api/v1 from N8N_API_URL base
    expect(url).toBe('http://n8n.internal:5678/webhook/trigger-pipeline');
    expect(options.method).toBe('POST');
    // No API key needed for webhook (it's a public webhook endpoint)
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body as string) as {
      credentials: Record<string, string>;
      pipelineConfig: Record<string, unknown>;
    };
    // Credentials must be in the body payload (never stored in n8n credential DB)
    expect(body.credentials).toEqual(credentials);
    expect(body.pipelineConfig.pipeline_id).toBe('pipe-1');
    expect(body.pipelineConfig.internal_api_url).toBe('https://automatesocials.tech/api');
  });

  it('handles executionId at top-level data.id path', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(200, { data: { id: 'exec-xyz' } });
    vi.stubGlobal('fetch', mockFetch);

    const result = await triggerN8nWorkflow('wf-abc', {}, { pipeline_id: 'p1' });
    expect(result.executionId).toBe('exec-xyz');
  });

  it('handles executionId at top-level response.id path', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(200, { id: 99 });
    vi.stubGlobal('fetch', mockFetch);

    const result = await triggerN8nWorkflow('wf-abc', {}, {});
    expect(result.executionId).toBe('99');
  });

  it('uses timestamp fallback when response has no executionId', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(200, { someOtherField: 'x' });
    vi.stubGlobal('fetch', mockFetch);

    const result = await triggerN8nWorkflow('wf-abc', {}, {});
    // Should not throw — uses timestamp fallback
    expect(result.executionId).toMatch(/^webhook-triggered-\d+$/);
  });

  it('returns a placeholder execution ID when N8N_API_URL is not set', async () => {
    delete process.env['N8N_API_URL'];

    const result = await triggerN8nWorkflow('wf-abc', {}, { pipeline_id: 'pipe-X' });
    expect(result.executionId).toBe('n8n-exec-placeholder-pipe-X');
  });

  it('throws when the n8n webhook returns a non-OK status', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(500, { message: 'Internal Server Error' });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      triggerN8nWorkflow('wf-abc', {}, {}),
    ).rejects.toThrow('n8n workflow execution trigger failed: HTTP 500');
  });

  it('correctly strips /api/v1 suffix to derive webhook base URL', async () => {
    process.env['N8N_API_URL'] = 'http://n8n:5678/api/v1';

    const mockFetch = makeFetchMock(200, { id: 1 });
    vi.stubGlobal('fetch', mockFetch);

    await triggerN8nWorkflow('any', {}, {});

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('http://n8n:5678/webhook/trigger-pipeline');
  });
});

// ---------------------------------------------------------------------------
// getN8nExecutionStatus
// ---------------------------------------------------------------------------

describe('getN8nExecutionStatus', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('calls GET /executions/{id} and returns status', async () => {
    // Production format: N8N_API_URL already contains /api/v1
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';
    process.env['N8N_API_KEY'] = 'test-key';

    const mockPayload = { id: '42', status: 'success', data: { resultData: {} } };
    const mockFetch = makeFetchMock(200, mockPayload);
    vi.stubGlobal('fetch', mockFetch);

    const result = await getN8nExecutionStatus('42');

    expect(result.status).toBe('success');
    expect(result.data).toEqual(mockPayload);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://n8n.internal:5678/api/v1/executions/42');
    expect(options.method).toBe('GET');
    expect((options.headers as Record<string, string>)['X-N8N-API-KEY']).toBe('test-key');
  });

  it('returns status:unknown when N8N_API_URL is not set', async () => {
    delete process.env['N8N_API_URL'];

    const result = await getN8nExecutionStatus('999');
    expect(result.status).toBe('unknown');
    expect(result.data).toBeUndefined();
  });

  it('throws when the n8n API returns a non-OK status', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(404, { message: 'Execution not found' });
    vi.stubGlobal('fetch', mockFetch);

    await expect(getN8nExecutionStatus('999')).rejects.toThrow(
      'n8n execution status check failed: HTTP 404',
    );
  });

  it('throws when the response is missing a status field', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(200, { id: '42' });
    vi.stubGlobal('fetch', mockFetch);

    await expect(getN8nExecutionStatus('42')).rejects.toThrow(
      'n8n execution status response missing status field',
    );
  });

  it('returns different execution statuses correctly', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    for (const status of ['running', 'success', 'failed', 'waiting', 'canceled']) {
      const mockFetch = makeFetchMock(200, { id: '1', status });
      vi.stubGlobal('fetch', mockFetch);

      const result = await getN8nExecutionStatus('1');
      expect(result.status).toBe(status);
    }
  });

  it('URL-encodes the executionId to prevent path injection', async () => {
    process.env['N8N_API_URL'] = 'http://n8n.internal:5678/api/v1';

    const mockFetch = makeFetchMock(200, { id: 'tricky/id', status: 'success' });
    vi.stubGlobal('fetch', mockFetch);

    await getN8nExecutionStatus('tricky/id');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('http://n8n.internal:5678/api/v1/executions/tricky%2Fid');
  });
});
