/**
 * The offline request handler of the Better form renderer PoC: which request
 * types it answers from the bundled form export, which it forwards to EHRbase
 * through the BFF (and in what format), and which it refuses.
 */

import { describe, expect, it, vi } from 'vitest';

import { aqlOf, createRequestHandler, extractUid } from '../../src/better-renderer/request-handler';
import { FORM_NAME, TEMPLATE_ID, buildFormResource } from '../../src/better-renderer/form-resource';
import type { RendererRequest } from '../../src/better-renderer/types';

const EHR = 'e1b0c8f6-0000-4000-8000-000000000001';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function handlerWith(fetchImpl: typeof fetch) {
  const events: unknown[] = [];
  const handler = createRequestHandler({ ehrId: EHR, fetch: fetchImpl, onEvent: (e) => events.push(e) });
  return { handler, events };
}

const req = (type: RendererRequest['type'], extra: Partial<RendererRequest> = {}): RendererRequest => ({
  id: `r-${type}`,
  type,
  ...extra,
});

describe('form-resource', () => {
  it('answers with the exported form, every file filled in as a JSON string', async () => {
    const { handler } = handlerWith(vi.fn() as unknown as typeof fetch);
    const result = await handler(req('form-resource', { resourceName: FORM_NAME }));
    expect(result.ok).toBe(true);
    const form = result.result as ReturnType<typeof buildFormResource>;
    expect(form.name).toBe(FORM_NAME);
    expect(form.templateId).toBe(TEMPLATE_ID);
    const description = form.files.find((f) => f.name === 'form-description');
    expect(description).toBeDefined();
    expect(JSON.parse(description!.content).rmType).toBe('FORM_DEFINITION');
    expect(form.files.every((f) => typeof f.content === 'string' && f.content.length > 0)).toBe(true);
  });

  it('answers the global API and variable requests with empty definitions', async () => {
    const { handler } = handlerWith(vi.fn() as unknown as typeof fetch);
    expect((await handler(req('api-resource'))).ok).toBe(true);
    expect((await handler(req('variable-resource'))).ok).toBe(true);
  });
});

describe('save-composition', () => {
  it('POSTs the composition data to the BFF as STRUCTURED for the form template and returns the uid', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ vital_signs_lite: { _uid: ['c0ffee::local.ehrbase.org::1'] } }, 201),
    );
    const { handler, events } = handlerWith(fetchMock as unknown as typeof fetch);

    const data = { vital_signs_lite: { vital_signs: { blood_pressure: [{ any_event: [{ systolic: [{ '|magnitude': 120 }] }] }] } } };
    const result = await handler(
      req('save-composition', { payload: { params: { ehrId: EHR, lifecycleState: 'complete', templateId: TEMPLATE_ID }, data } }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/ehr/${EHR}/composition?templateId=${encodeURIComponent(TEMPLATE_ID)}&format=STRUCTURED`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(data);

    expect(result).toMatchObject({
      ok: true,
      result: { compositionUid: 'c0ffee::local.ehrbase.org::1', action: 'CREATE' },
    });
    expect(events).toHaveLength(1);
  });

  it('reports EHRbase validation errors verbatim instead of throwing into the renderer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'Could not retrieve template' }, 422));
    const { handler } = handlerWith(fetchMock as unknown as typeof fetch);
    const result = await handler(req('save-composition', { payload: { data: {} } }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 422');
    expect(result.error).toContain('Could not retrieve template');
  });
});

describe('update-composition', () => {
  it('PUTs against the previous uid', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ vital_signs_lite: { _uid: ['c0ffee::local.ehrbase.org::2'] } }));
    const { handler } = handlerWith(fetchMock as unknown as typeof fetch);
    const result = await handler(
      req('update-composition', { payload: { params: { compositionId: 'c0ffee::local.ehrbase.org::1' }, data: { x: 1 } } }),
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/composition/${encodeURIComponent('c0ffee::local.ehrbase.org::1')}?`);
    expect(url).toContain('format=STRUCTURED');
    expect(init.method).toBe('PUT');
    expect(result).toMatchObject({ ok: true, result: { compositionUid: 'c0ffee::local.ehrbase.org::2', action: 'UPDATE' } });
  });
});

describe('data', () => {
  it('runs AQL through the BFF', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ rows: [['a']] }));
    const { handler } = handlerWith(fetchMock as unknown as typeof fetch);
    const result = await handler(req('data', { payload: { aql: 'SELECT e FROM EHR e', aqlParameters: { x: 1 } } }));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/aql');
    expect(JSON.parse(init.body as string)).toEqual({ q: 'SELECT e FROM EHR e', query_parameters: { x: 1 } });
    expect(result).toMatchObject({ ok: true, result: { rows: [['a']] } });
  });

  it('refuses non-AQL data requests', async () => {
    const { handler } = handlerWith(vi.fn() as unknown as typeof fetch);
    const result = await handler(req('data', { payload: { url: 'https://example/api' }, url: 'https://example/api' }));
    expect(result.ok).toBe(false);
  });
});

describe('unsupported types', () => {
  it.each(['file-resource', 'attachment-added', 'attachment-fetch', 'save-contribution'] as const)(
    '%s is refused with ok:false and never resolves pending',
    async (type) => {
      const { handler } = handlerWith(vi.fn() as unknown as typeof fetch);
      const result = await handler(req(type));
      expect(result).toMatchObject({ id: `r-${type}`, ok: false });
      expect(result.error).toContain(type);
    },
  );
});

describe('extractUid', () => {
  it('finds the uid in STRUCTURED, FLAT and canonical answers', () => {
    expect(extractUid({ vital_signs_lite: { _uid: ['u::1'] } })).toBe('u::1');
    expect(extractUid({ 'vital_signs_lite/_uid': 'u::2' })).toBe('u::2');
    expect(extractUid({ uid: { value: 'u::3' } })).toBe('u::3');
    expect(extractUid({ compositionUid: 'u::4' })).toBe('u::4');
    expect(extractUid({})).toBeUndefined();
  });
});

describe('aqlOf', () => {
  it('accepts the payload shapes the renderer uses and rejects everything else', () => {
    expect(aqlOf('select e from ehr e')).toEqual({ q: 'select e from ehr e' });
    expect(aqlOf({ q: 'SELECT 1' })).toEqual({ q: 'SELECT 1' });
    expect(aqlOf(undefined, 'http://x/rest/v1/query?aql=SELECT%20c%20FROM%20COMPOSITION%20c')).toEqual({ q: 'SELECT c FROM COMPOSITION c' });
    expect(aqlOf({ body: 'not aql' })).toBeNull();
  });
});
