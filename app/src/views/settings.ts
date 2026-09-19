/**
 * Settings — server status, counts, template list and OPT upload.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  checkAdminAccess,
  getAdminOps,
  getStats,
  listTemplates,
  runAdminOp,
  uploadTemplate,
  type AdminAccessCheck,
  type AdminOp,
  type AdminOpResult,
  type HealthStatus,
  type Stats,
} from '../openehr/client';

/** An operation waiting on the operator to retype what it will destroy. */
interface PendingAdminOp {
  op: AdminOp;
  args: Record<string, string>;
  /** The exact string that has to be retyped to arm the button. */
  confirmValue: string;
}

@customElement('eps-settings')
export class EpsSettings extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) health?: HealthStatus;

  @state() private stats?: Stats;
  @state() private templates: string[] = [];
  @state() private message = '';
  @state() private messageKind: 'info' | 'error' | 'success' = 'info';
  @state() private busy = false;

  @state() private adminCheck?: AdminAccessCheck;
  @state() private adminChecking = false;

  @state() private adminOps: AdminOp[] = [];
  /** Per-operation form values, keyed by operation id then parameter name. */
  @state() private opArgs: Record<string, Record<string, string>> = {};
  @state() private pendingOp?: PendingAdminOp;
  @state() private confirmTyped = '';
  @state() private opResult?: AdminOpResult;
  @state() private opRunning = false;

  connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [stats, templates] = await Promise.all([getStats(), listTemplates()]);
      this.stats = stats;
      this.templates = templates;
    } catch (err) {
      this.messageKind = 'error';
      this.message = (err as Error).message;
    }
  }

  /**
   * Uploads an OPT. The file is sent as XML text exactly as read — EHRbase
   * parses the OPT itself, and re-serialising it here could only corrupt it.
   */
  private async onFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.busy = true;
    try {
      const response = await uploadTemplate(await file.text());
      this.messageKind = 'success';
      this.message = `Uploaded ${file.name}. ${response.slice(0, 300)}`;
      await this.refresh();
    } catch (err) {
      this.messageKind = 'error';
      this.message = (err as Error).message;
    } finally {
      this.busy = false;
      // Allow the same file to be re-selected after a failure.
      input.value = '';
    }
  }

  /**
   * Runs on click, never on load. This fires a real request against
   * EHRbase's admin API with production credentials — worth an explicit
   * action, not something that happens silently every time Settings opens.
   */
  private async runAdminCheck(): Promise<void> {
    this.adminChecking = true;
    try {
      this.adminCheck = await checkAdminAccess();
      // The destructive console only exists once the check says this account
      // actually holds admin rights, so nobody is shown delete controls that
      // would only ever answer 403.
      if (this.adminCheck.granted && !this.adminOps.length) {
        this.adminOps = await getAdminOps();
      }
    } catch (err) {
      this.messageKind = 'error';
      this.message = (err as Error).message;
    } finally {
      this.adminChecking = false;
    }
  }

  /**
   * Arms an operation — it does NOT run here.
   *
   * These deletes are physical in EHRbase: the record and its entire version
   * history go, so there is nothing left to reconstruct it from and no trace
   * that it happened. Retyping the id is the point at which an operator reads
   * back what they are about to destroy, so a mis-click on the wrong row
   * cannot become a deletion on its own.
   */
  private arm(op: AdminOp, args: Record<string, string>, confirmValue: string): void {
    this.pendingOp = { op, args, confirmValue };
    this.confirmTyped = '';
    this.opResult = undefined;
  }

  private cancelPending(): void {
    this.pendingOp = undefined;
    this.confirmTyped = '';
  }

  private async runPending(): Promise<void> {
    const pending = this.pendingOp;
    if (!pending || this.confirmTyped !== pending.confirmValue) return;

    this.opRunning = true;
    try {
      this.opResult = await runAdminOp(pending.op.id, pending.args);
      this.pendingOp = undefined;
      this.confirmTyped = '';
      // Counts and the template list both move under a successful delete.
      if (this.opResult.ok) await this.refresh();
    } catch (err) {
      this.messageKind = 'error';
      this.message = (err as Error).message;
    } finally {
      this.opRunning = false;
    }
  }

  private setOpArg(opId: string, param: string, value: string): void {
    this.opArgs = { ...this.opArgs, [opId]: { ...(this.opArgs[opId] ?? {}), [param]: value } };
  }

  private renderAdminCheck() {
    const c = this.adminCheck;
    if (!c) return nothing;

    if (c.unavailable) {
      return html`
        <div class="template-row">
          <span class="pill demo">no user token</span>
        </div>
        <div class="muted" style="margin-top:6px; font-size:12px">${c.detail}</div>
      `;
    }
    // Least privilege reads as "good": blocked is the secure default this
    // stack is built around, granted is a deviation worth a second look.
    const kind = c.blocked ? 'up' : c.granted ? 'down' : 'demo';
    const label = c.blocked
      ? 'blocked'
      : c.granted
        ? 'granted'
        : `unexpected (HTTP ${c.status})`;

    return html`
      <div class="template-row">
        <span class="pill ${kind}">admin access ${label}</span>
        <span class="mono muted">${c.endpoint} → HTTP ${c.status}</span>
      </div>
      ${c.detail
        ? html`<div class="muted" style="margin-top:6px; font-size:12px">${c.detail}</div>`
        : nothing}
    `;
  }

  /** The retype-to-confirm gate. Nothing is sent until the text matches. */
  private renderConfirm() {
    const pending = this.pendingOp;
    if (!pending) return nothing;

    const armed = this.confirmTyped === pending.confirmValue;
    return html`
      <div class="admin-confirm" data-testid="admin-confirm">
        <p style="margin-top:0">
          <strong>${pending.op.summary}.</strong>
          This deletes the record and its entire version history from EHRbase. It cannot be
          undone, and afterwards there is no trace that it existed.
        </p>
        <p class="muted" style="font-size:12px">
          Type <span class="mono">${pending.confirmValue}</span> to confirm.
        </p>
        <div class="upload-row">
          <input
            class="text mono"
            .value=${this.confirmTyped}
            @input=${(e: Event) => (this.confirmTyped = (e.target as HTMLInputElement).value)}
            placeholder=${pending.confirmValue}
            data-testid="admin-confirm-input"
          />
          <button
            class="btn danger"
            ?disabled=${!armed || this.opRunning}
            @click=${this.runPending}
            data-testid="admin-confirm-run"
          >
            ${this.opRunning ? html`<span class="spinner"></span>` : nothing} Delete
          </button>
          <button class="btn" ?disabled=${this.opRunning} @click=${this.cancelPending}>
            Cancel
          </button>
        </div>
      </div>
    `;
  }

  private renderOpResult() {
    const r = this.opResult;
    if (!r) return nothing;

    // 422 is EHRbase refusing to orphan data that still references this
    // record — a correct outcome, not a fault, so it does not read as an error.
    const kind = r.ok ? 'up' : r.status === 422 ? 'demo' : 'down';
    return html`
      <div class="template-row" data-testid="admin-op-result">
        <span class="pill ${kind}">HTTP ${r.status}</span>
        <span>${r.message}</span>
        <span class="mono muted">${r.endpoint}</span>
      </div>
      ${r.detail
        ? html`<div class="muted" style="margin-top:6px; font-size:12px">${r.detail}</div>`
        : nothing}
    `;
  }

  /** ID-addressed deletes. Only rendered once the access check says granted. */
  private renderAdminOps() {
    if (!this.adminCheck?.granted || !this.adminOps.length) return nothing;

    // Templates have their own delete control on the Templates card, where the
    // list of what exists already is — retyping an id you can see beats
    // pasting one you cannot.
    const ops = this.adminOps.filter((op) => op.id !== 'delete-template');

    return html`
      <div class="card">
        <div class="card-head">
          <h3>Admin operations</h3>
        </div>
        <div class="card-body">
          <p class="muted" style="margin-top:0">
            Runs as <strong>you</strong>, against EHRbase's admin API. Every operation here is a
            <strong>physical delete</strong>: the record and all of its history are removed, so
            the change cannot be traced and the data cannot be recovered. EHRbase refuses
            (<span class="mono">422</span>) when other data still references the target — that
            refusal is a safeguard, not a failure.
          </p>

          ${ops.map(
            (op) => html`
              <div class="admin-op" data-testid="admin-op-${op.id}">
                <div class="template-row">
                  <span class="mono">${op.method}</span>
                  <span>${op.summary}</span>
                </div>
                <div class="upload-row">
                  ${op.params.map(
                    (p) => html`
                      <input
                        class="text mono"
                        placeholder=${p.label}
                        aria-label=${p.label}
                        .value=${this.opArgs[op.id]?.[p.name] ?? ''}
                        @input=${(e: Event) =>
                          this.setOpArg(op.id, p.name, (e.target as HTMLInputElement).value)}
                        data-testid="admin-arg-${op.id}-${p.name}"
                      />
                    `,
                  )}
                  <button
                    class="btn"
                    ?disabled=${this.opRunning ||
                    op.params.some((p) => !(this.opArgs[op.id]?.[p.name] ?? '').trim())}
                    @click=${() => {
                      const args = Object.fromEntries(
                        op.params.map((p) => [p.name, (this.opArgs[op.id]?.[p.name] ?? '').trim()]),
                      );
                      // Confirm against the LAST parameter: it is the specific
                      // record being destroyed, while the first is usually the
                      // EHR that merely contains it.
                      const last = op.params[op.params.length - 1].name;
                      this.arm(op, args, args[last]);
                    }}
                  >
                    Delete…
                  </button>
                </div>
              </div>
            `,
          )}

          ${this.pendingOp && this.pendingOp.op.id !== 'delete-template'
            ? this.renderConfirm()
            : nothing}
          ${this.opResult && this.opResult.operation !== 'delete-template'
            ? this.renderOpResult()
            : nothing}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="view-head">
        <h2>Settings</h2>
        <p>Server status, stored data and template management.</p>
      </div>

      ${this.message ? html`<div class="message ${this.messageKind}">${this.message}</div>` : nothing}

      <div class="settings-grid">
        <div class="card">
          <div class="card-head">
            <h3>Connections</h3>
          </div>
          <div class="card-body">
            <dl class="kv">
              <dt>EHRbase</dt>
              <dd>
                <span class="pill ${this.health?.ehrbase === 'up' ? 'up' : 'down'}">
                  ${this.health?.ehrbase ?? 'checking…'}
                </span>
                ${this.health?.ehrbaseBase ?? ''}
              </dd>

              <dt>HAPI FHIR</dt>
              <dd>
                <span class="pill ${this.health?.fhir === 'up' ? 'up' : 'down'}">
                  ${this.health?.fhir ?? 'checking…'}
                </span>
                ${this.health?.fhirBase ?? ''}
              </dd>

              <dt>openFHIR</dt>
              <dd>
                <span class="pill ${this.health?.openfhir === 'up' ? 'up' : 'down'}">
                  ${this.health?.openfhir ?? 'checking…'}
                </span>
                ${this.health?.openfhirBase ?? ''}
                ${this.health?.openfhirVersion
                  ? html`<span class="muted">v${this.health.openfhirVersion}</span>`
                  : nothing}
              </dd>

              <dt>Hades terminology</dt>
              <dd>
                <span class="pill ${this.health?.hades === 'up' ? 'up' : 'down'}">
                  ${this.health?.hades ?? 'checking…'}
                </span>
                ${this.health?.hadesBase ?? ''}
                ${this.health?.hadesVersion
                  ? html`<span class="muted">v${this.health.hadesVersion}</span>`
                  : nothing}
              </dd>

              <dt>Patients</dt>
              <dd>${this.stats?.patients ?? '—'}</dd>
              <dt>EHRs</dt>
              <dd>${this.stats?.ehrs ?? '—'}</dd>
              <dt>Compositions</dt>
              <dd>${this.stats?.compositions ?? '—'}</dd>
            </dl>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Templates</h3></div>
          <div class="card-body">
            ${this.templates.length
              ? this.templates.map(
                  (t) => html`
                    <div class="template-row">
                      <span class="pill up">uploaded</span>
                      <span>${t}</span>
                      ${this.adminCheck?.granted
                        ? html`
                            <button
                              class="btn"
                              ?disabled=${this.opRunning}
                              @click=${() => {
                                const op = this.adminOps.find((o) => o.id === 'delete-template');
                                if (op) this.arm(op, { templateId: t }, t);
                              }}
                              data-testid="delete-template-${t}"
                            >
                              Delete…
                            </button>
                          `
                        : nothing}
                    </div>
                  `,
                )
              : html`<div class="empty">No templates uploaded.</div>`}

            ${this.pendingOp?.op.id === 'delete-template' ? this.renderConfirm() : nothing}
            ${this.opResult?.operation === 'delete-template' ? this.renderOpResult() : nothing}

            <div class="upload-row" style="margin-top:16px">
              <label class="btn" for="opt-upload">
                ${this.busy ? html`<span class="spinner"></span>` : nothing} Upload OPT (XML)
              </label>
              <input
                id="opt-upload"
                type="file"
                accept=".opt,.xml,application/xml,text/xml"
                style="display:none"
                @change=${this.onFile}
                ?disabled=${this.busy}
                data-testid="opt-upload"
              />
              <span class="muted">
                Operational templates are uploaded to EHRbase and become available immediately.
              </span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Admin API access</h3>
            <button
              class="btn"
              @click=${this.runAdminCheck}
              ?disabled=${this.adminChecking}
              data-testid="admin-access-check"
            >
              ${this.adminChecking ? html`<span class="spinner"></span>` : nothing} Run check
            </button>
          </div>
          <div class="card-body">
            <p class="muted" style="margin-top:0">
              Probes EHRbase's <span class="mono">/admin</span> API as
              <strong>you</strong> — using the access token the ingress forwards for your
              login, not the BFF's own shared credentials — at its root
              (<span class="mono">GET /rest/admin</span>), a path EHRbase serves nothing at,
              chosen for exactly that reason: it cannot change anything, unlike every
              real route under it. What it tests is the policy gate in front of EHRbase,
              which decides on the path before EHRbase sees it.
              <strong>Blocked</strong> (403 from the gate) is the secure default;
              <strong>granted</strong> means you were admitted — including the
              <span class="mono">404</span> EHRbase then answers with, since only an
              admitted request ever reaches it. Needs a deployed session with the proxy
              configured to forward the access token — there is nothing to check locally.
            </p>
            ${this.adminCheck
              ? this.renderAdminCheck()
              : html`<div class="empty">Not checked yet.</div>`}
          </div>
        </div>

        ${this.renderAdminOps()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'eps-settings': EpsSettings;
  }
}
