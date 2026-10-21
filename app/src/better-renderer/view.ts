/**
 * `<better-renderer-poc>` — the Better form renderer in offline mode, saving to
 * EHRbase through the BFF. Separate from the Medblocks-based forms: nothing
 * here touches the registry, the save pipeline or the patient context.
 *
 * The renderer ships as a plain script + stylesheet (Better's framework-
 * agnostic guide), copied out of node_modules into /better-renderer at image
 * build time (scripts/better-renderer-assets.sh). It is loaded on demand here,
 * so the rest of the app never depends on the private package at bundle time.
 *
 * Light DOM, like every other view: all CSS is in styles/views.css.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { createRequestHandler, type HandlerEvent } from './request-handler';
import { FORM_NAME, FORM_VERSION, TEMPLATE_ID } from './form-resource';
import type { FormRendererElement, SaveResponse } from './types';

const ASSET_BASE = '/better-renderer';
const ASSET_SCRIPT = `${ASSET_BASE}/form-renderer.js`;
const ASSET_STYLES = `${ASSET_BASE}/styles.css`;
const EHR_ID_KEY = 'better-poc.ehrId';
const DEMO_SUBJECT_ID = 'better-poc-demo';

type AssetState = 'idle' | 'loading' | 'ready' | 'missing';

let assetsPromise: Promise<void> | undefined;

function loadAssets(): Promise<void> {
  if (!assetsPromise) {
    assetsPromise = new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ASSET_STYLES;
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = ASSET_SCRIPT;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`${ASSET_SCRIPT} did not load`));
      document.head.appendChild(script);
    }).then(() =>
      Promise.race([
        customElements.whenDefined('form-renderer').then(() => undefined),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('form-renderer element never registered')), 15000),
        ),
      ]),
    );
    assetsPromise.catch(() => {
      assetsPromise = undefined;
    });
  }
  return assetsPromise;
}

@customElement('better-renderer-poc')
export class BetterRendererPoc extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() ehrIdFromRoute = '';

  @state() private ehrId = '';
  @state() private assets: AssetState = 'idle';
  @state() private assetError = '';
  @state() private mounted = false;
  @state() private saving = false;
  @state() private saved?: SaveResponse;
  @state() private message = '';
  @state() private messageKind: 'info' | 'error' | 'success' = 'info';
  @state() private events: HandlerEvent[] = [];
  @state() private fetched?: { label: string; body: unknown };
  @state() private busy = false;

  private renderer?: FormRendererElement;

  connectedCallback(): void {
    super.connectedCallback();
    let stored = '';
    try {
      stored = localStorage.getItem(EHR_ID_KEY) ?? '';
    } catch {
      // storage unavailable: the field simply starts empty
    }
    this.ehrId = this.ehrIdFromRoute || stored;
    void this.ensureAssets();
  }

  private async ensureAssets(): Promise<void> {
    this.assets = 'loading';
    try {
      await loadAssets();
      this.assets = 'ready';
    } catch (err) {
      this.assets = 'missing';
      this.assetError = (err as Error).message;
    }
  }

  private rememberEhrId(): void {
    try {
      localStorage.setItem(EHR_ID_KEY, this.ehrId);
    } catch {
      // storage unavailable
    }
  }

  private async findDemoEhr(): Promise<void> {
    this.busy = true;
    this.message = '';
    try {
      const res = await fetch('/api/aql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q:
            'SELECT e/ehr_id/value FROM EHR e ' +
            `WHERE e/ehr_status/subject/external_ref/id/value = '${DEMO_SUBJECT_ID}'`,
        }),
      });
      const body = await res.json();
      const id = body?.rows?.[0]?.[0];
      if (!res.ok || typeof id !== 'string') {
        throw new Error(
          `no demo EHR found (subject ${DEMO_SUBJECT_ID}) — run the bootstrap first. ` +
            JSON.stringify(body).slice(0, 300),
        );
      }
      this.ehrId = id;
      this.rememberEhrId();
      this.messageKind = 'success';
      this.message = `Demo EHR found: ${id}`;
    } catch (err) {
      this.messageKind = 'error';
      this.message = (err as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private mountRenderer(): void {
    if (!this.ehrId.trim()) {
      this.messageKind = 'error';
      this.message = 'An EHR id is required: the renderer saves against it.';
      return;
    }
    this.rememberEhrId();
    this.unmountRenderer();

    const el = document.createElement('form-renderer') as FormRendererElement;
    el.context = {
      language: 'en',
      territory: 'NL',
      mode: 'offline',
      offline: {
        requestHandler: createRequestHandler({
          ehrId: this.ehrId.trim(),
          templateId: TEMPLATE_ID,
          onEvent: (event) => {
            this.events = [event, ...this.events];
          },
        }),
        timeoutMs: 15000,
      },
      showFieldsRequiredIndicator: true,
      displayValidationMessagesOnTouched: true,
    };
    el.form = FORM_NAME;
    el.formEnvironment = { variables: [{ name: 'ehrId', value: this.ehrId.trim() }] };
    el.addEventListener('onCompositionSaved', (e: Event) => {
      this.events = [
        {
          request: { id: 'event', type: 'ignore' },
          result: { id: 'event', ok: true, result: (e as CustomEvent).detail },
          detail: 'onCompositionSaved event',
        },
        ...this.events,
      ];
    });

    this.renderer = el;
    this.mounted = true;
    this.saved = undefined;
    this.fetched = undefined;
    this.events = [];
    this.message = '';
    // Appended after Lit has rendered the host, so the renderer's own DOM is
    // never re-rendered or replaced by this component's template.
    void this.updateComplete.then(() => {
      this.querySelector('.renderer-host')?.appendChild(el);
    });
  }

  private unmountRenderer(): void {
    this.renderer?.remove();
    this.renderer = undefined;
    this.mounted = false;
  }

  private async save(): Promise<void> {
    if (!this.renderer) return;
    this.saving = true;
    this.message = '';
    try {
      const response = await this.renderer.getScriptApi().saveComposition();
      if (!response.success) {
        throw new Error(`renderer refused to save: ${JSON.stringify(response.error ?? response).slice(0, 1500)}`);
      }
      const saveEvent = this.events.find((e) => e.request.type === 'save-composition' && e.result.ok);
      const result = (saveEvent?.result.result ?? response.response) as SaveResponse | undefined;
      this.saved = result?.compositionUid ? result : undefined;
      this.messageKind = this.saved ? 'success' : 'info';
      this.message = this.saved
        ? `Saved as ${this.saved.compositionUid}`
        : `Renderer reported success, but no composition uid came back: ${JSON.stringify(response).slice(0, 500)}`;
    } catch (err) {
      this.messageKind = 'error';
      this.message = (err as Error).message;
    } finally {
      this.saving = false;
    }
  }

  private async fetchBack(mode: 'structured' | 'flat' | 'canonical' | 'aql'): Promise<void> {
    if (!this.saved && mode !== 'aql') return;
    this.busy = true;
    try {
      let res: Response;
      let label: string;
      if (mode === 'aql') {
        label = 'AQL';
        res = await fetch('/api/aql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q:
              'SELECT c/uid/value, c/archetype_details/template_id/value, c/context/start_time/value ' +
              'FROM EHR e[ehr_id/value=$ehrId] CONTAINS COMPOSITION c ' +
              'WHERE c/archetype_details/template_id/value = $templateId ' +
              'ORDER BY c/context/start_time/value DESC',
            query_parameters: { ehrId: this.ehrId.trim(), templateId: TEMPLATE_ID },
          }),
        });
      } else {
        const uid = encodeURIComponent(this.saved!.compositionUid);
        const format = mode === 'canonical' ? 'canonical' : mode.toUpperCase();
        label = `GET composition (${format})`;
        res = await fetch(`/api/ehr/${encodeURIComponent(this.ehrId.trim())}/composition/${uid}?format=${format}`);
      }
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep the raw text
      }
      this.fetched = { label: `${label} → HTTP ${res.status}`, body };
    } catch (err) {
      this.fetched = { label: 'fetch failed', body: (err as Error).message };
    } finally {
      this.busy = false;
    }
  }

  render() {
    return html`
      <div class="view-head">
        <h2>Better Form Renderer (PoC)</h2>
        <p>
          <code>@better/form-renderer</code> in offline mode, saving to EHRbase through the BFF.
          Form <b>${FORM_NAME}</b> ${FORM_VERSION} on template <b>${TEMPLATE_ID}</b>.
        </p>
      </div>

      ${this.message ? html`<div class="message ${this.messageKind}">${this.message}</div>` : nothing}

      ${this.assets === 'missing'
        ? html`<div class="message error">
            Renderer assets are not served at <code>${ASSET_BASE}/</code> (${this.assetError}). The image
            build copies them from the private package; locally run
            <code>npm run better-renderer:assets</code> after an install that can reach Better's registry.
          </div>`
        : nothing}

      <div class="card">
        <div class="card-head"><h3>1 · EHR</h3></div>
        <div class="card-body ehr-row">
          <label>
            EHR id
            <input
              .value=${this.ehrId}
              @input=${(e: Event) => (this.ehrId = (e.target as HTMLInputElement).value)}
              placeholder="paste an EHR id, or find the demo EHR"
              data-testid="better-ehr-id"
            />
          </label>
          <button class="btn" ?disabled=${this.busy} @click=${this.findDemoEhr}>Find demo EHR</button>
          <button
            class="btn primary"
            ?disabled=${this.assets !== 'ready' || !this.ehrId.trim()}
            @click=${this.mountRenderer}
            data-testid="better-mount"
          >
            ${this.mounted ? 'Reload form' : 'Open form'}
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>2 · Form</h3></div>
        <div class="card-body">
          <div class="renderer-host"></div>
          ${this.mounted
            ? html`<div class="form-actions">
                <button class="btn primary" ?disabled=${this.saving} @click=${this.save} data-testid="better-save">
                  ${this.saving ? 'Saving…' : 'Save to EHRbase'}
                </button>
              </div>`
            : html`<p class="muted">${this.assets === 'loading' ? 'Loading the renderer…' : 'Open the form above.'}</p>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>3 · Read back from EHRbase</h3></div>
        <div class="card-body">
          <div class="form-actions">
            <button class="btn" ?disabled=${!this.saved || this.busy} @click=${() => this.fetchBack('structured')}>GET STRUCTURED</button>
            <button class="btn" ?disabled=${!this.saved || this.busy} @click=${() => this.fetchBack('flat')}>GET FLAT</button>
            <button class="btn" ?disabled=${!this.saved || this.busy} @click=${() => this.fetchBack('canonical')}>GET canonical</button>
            <button class="btn" ?disabled=${!this.ehrId.trim() || this.busy} @click=${() => this.fetchBack('aql')}>AQL: compositions in this EHR</button>
          </div>
          ${this.fetched
            ? html`<p class="muted">${this.fetched.label}</p>
                <pre class="json">${JSON.stringify(this.fetched.body, null, 2)}</pre>`
            : nothing}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Renderer requests</h3></div>
        <div class="card-body">
          ${this.events.length === 0
            ? html`<p class="muted">Every request the renderer hands to the offline handler shows up here.</p>`
            : html`<ol class="event-list">
                ${this.events.map(
                  (e) => html`<li class=${e.result.ok ? 'ok' : 'failed'}>
                    <details>
                      <summary>
                        <code>${e.detail ?? e.request.type}</code>
                        ${e.request.resourceName ? html`<span class="muted">${e.request.resourceName}</span>` : nothing}
                        <span class="tag">${e.result.ok ? 'ok' : 'failed'}</span>
                        ${e.result.error ? html`<span class="err">${e.result.error}</span>` : nothing}
                      </summary>
                      <pre class="json">${JSON.stringify({ request: e.request, result: e.result }, null, 2)}</pre>
                    </details>
                  </li>`,
                )}
              </ol>`}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'better-renderer-poc': BetterRendererPoc;
  }
}
