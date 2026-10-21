/**
 * The offline-mode contract of @better/form-renderer (3.15+), written out from
 * https://docs.better.care/studio/advanced/offline-mode so the PoC compiles
 * and unit-tests without the private package installed. The renderer itself
 * is loaded at runtime as a plain script (see view.ts), never bundled.
 */

export type RendererRequestType =
  | 'form-resource'
  | 'api-resource'
  | 'variable-resource'
  | 'system-api-resource'
  | 'data'
  | 'save-composition'
  | 'update-composition'
  | 'save-contribution'
  | 'update-contribution'
  | 'attachment-added'
  | 'attachment-fetch'
  | 'file-resource'
  | 'ignore';

export interface RendererRequest<T = unknown> {
  id: string;
  type: RendererRequestType;
  resourceId?: string;
  resourceName?: string;
  resourceVersion?: string;
  payload?: T;
  /** The endpoint the renderer would have called in online mode. */
  url?: string;
}

export interface RendererResult<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export type RequestHandler = (request: RendererRequest) => Promise<RendererResult>;

/** `save-composition` / `update-composition` payload as documented. */
export interface CompositionPayload {
  params?: { ehrId?: string; lifecycleState?: string; templateId?: string; compositionId?: string };
  data?: Record<string, unknown>;
}

/** What the renderer gets back for a save, shaped like Better's EHR API answer. */
export interface SaveResponse {
  compositionUid: string;
  action: 'CREATE' | 'UPDATE';
  meta: { href: string };
}

export interface FormRendererContext {
  language: string;
  territory?: string;
  mode: 'online' | 'offline';
  offline?: { requestHandler: RequestHandler; timeoutMs?: number };
  openEhr?: 'better' | 'openEHR';
  showFieldsRequiredIndicator?: boolean;
  displayValidationMessagesOnTouched?: boolean;
  [key: string]: unknown;
}

export interface FormRendererScriptApi {
  saveComposition(validate?: boolean): Promise<{ success: boolean; error?: unknown; response?: unknown }>;
  updateComposition?(validate?: boolean): Promise<{ success: boolean; error?: unknown; response?: unknown }>;
  getValues?(): unknown;
}

/** The `<form-renderer>` element's property surface used by the PoC. */
export interface FormRendererElement extends HTMLElement {
  context: FormRendererContext;
  form: string;
  formVersion?: string;
  formEnvironment: { variables: { name: string; value: unknown }[] };
  compositionId?: string;
  getScriptApi(): FormRendererScriptApi;
}
