/**
 * Offline-mode request handler: every resource request the renderer would have
 * sent to a Better EHR/resource server lands here and is answered from the
 * bundled form export or forwarded to EHRbase through the BFF.
 *
 * Handled: form-resource, api-resource, variable-resource, system-api-resource,
 * data (AQL only), save-composition, update-composition, ignore.
 * Refused with ok:false: file-resource, attachments, contributions.
 */

import type {
  CompositionPayload,
  RendererRequest,
  RendererResult,
  RequestHandler,
  SaveResponse,
} from './types';
import { buildFormResource, TEMPLATE_ID } from './form-resource';

export interface HandlerOptions {
  ehrId: string;
  templateId?: string;
  fetch?: typeof fetch;
  /** Called for every request with its outcome; the PoC page shows these. */
  onEvent?: (event: HandlerEvent) => void;
}

export interface HandlerEvent {
  request: RendererRequest;
  result: RendererResult;
  detail?: string;
}

function ok<T>(id: string, result: T): RendererResult<T> {
  return { id, ok: true, result };
}

function fail(id: string, error: string): RendererResult {
  return { id, ok: false, error };
}

async function readJson(res: Response, context: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${context} failed (HTTP ${res.status}): ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : {};
}

/** Finds the composition uid in whatever simplified format EHRbase answered. */
export function extractUid(body: any): string | undefined {
  if (typeof body?.uid?.value === 'string') return body.uid.value;
  if (typeof body?.uid === 'string') return body.uid;
  if (typeof body?.compositionUid === 'string') return body.compositionUid;
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      if (key.endsWith('_uid')) {
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
        if (Array.isArray(value) && typeof value[0]?.['|value'] === 'string') return value[0]['|value'];
      }
      if (key === 'ctx' || key.startsWith('_')) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = extractUid(value);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

export function createRequestHandler(options: HandlerOptions): RequestHandler {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const templateId = options.templateId ?? TEMPLATE_ID;
  const ehr = encodeURIComponent(options.ehrId);

  const compositionUrl = (uid?: string) =>
    `/api/ehr/${ehr}/composition${uid ? `/${encodeURIComponent(uid)}` : ''}` +
    `?templateId=${encodeURIComponent(templateId)}&format=STRUCTURED`;

  async function handle(request: RendererRequest): Promise<RendererResult> {
    const { id, type } = request;
    switch (type) {
      case 'form-resource':
        return ok(id, buildFormResource());

      // No form-level APIs or variables in this form; the renderer still asks.
      case 'api-resource':
      case 'system-api-resource':
        return ok(id, []);
      case 'variable-resource':
        return ok(id, { variables: [] });

      case 'data': {
        const aql = aqlOf(request.payload, request.url);
        if (!aql) return fail(id, `data request is not an AQL query (url: ${request.url ?? 'none'})`);
        const body = await readJson(
          await doFetch('/api/aql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aql),
          }),
          'AQL',
        );
        return ok(id, body);
      }

      case 'save-composition': {
        const payload = (request.payload ?? {}) as CompositionPayload;
        const body = await readJson(
          await doFetch(compositionUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload.data ?? payload),
          }),
          'composition POST',
        );
        const uid = extractUid(body);
        if (!uid) return fail(id, 'EHRbase accepted the composition but no uid was found in its answer');
        const result: SaveResponse = { compositionUid: uid, action: 'CREATE', meta: { href: compositionUrl(uid) } };
        return ok(id, result);
      }

      case 'update-composition': {
        const payload = (request.payload ?? {}) as CompositionPayload;
        const previous = payload.params?.compositionId ?? request.resourceId ?? extractUid(payload.data);
        if (!previous) return fail(id, 'update-composition without a composition uid');
        const body = await readJson(
          await doFetch(compositionUrl(previous), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload.data ?? payload),
          }),
          'composition PUT',
        );
        const uid = extractUid(body) ?? previous;
        const result: SaveResponse = { compositionUid: uid, action: 'UPDATE', meta: { href: compositionUrl(uid) } };
        return ok(id, result);
      }

      case 'ignore':
        return ok(id, undefined);

      case 'file-resource':
      case 'attachment-added':
      case 'attachment-fetch':
      case 'save-contribution':
      case 'update-contribution':
        return fail(id, `${type} is not supported by this PoC`);

      default:
        return fail(id, `unknown request type ${String(type)}`);
    }
  }

  return async (request) => {
    let result: RendererResult;
    try {
      result = await handle(request);
    } catch (err) {
      result = fail(request.id, (err as Error).message);
    }
    options.onEvent?.({ request, result });
    return result;
  };
}

/** Pulls an AQL query out of a `data` request, in the shapes the renderer uses. */
export function aqlOf(payload: unknown, url?: string): { q: string; query_parameters?: Record<string, unknown> } | null {
  const p = payload as any;
  const q = typeof p === 'string' ? p : p?.aql ?? p?.q ?? p?.body?.aql ?? p?.body?.q;
  if (typeof q === 'string' && /^\s*select\b/i.test(q)) {
    const params = p?.aqlParameters ?? p?.query_parameters ?? p?.body?.aqlParameters;
    return params && typeof params === 'object' ? { q, query_parameters: params } : { q };
  }
  if (url) {
    try {
      const u = new URL(url, 'http://offline');
      const fromUrl = u.searchParams.get('aql') ?? u.searchParams.get('q');
      if (fromUrl) return { q: fromUrl };
    } catch {
      // not a URL; nothing to extract
    }
  }
  return null;
}
