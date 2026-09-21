/**
 * The admin console's confirmation gate.
 *
 * The server allowlist decides WHICH operations exist; this is the other half
 * — whether the UI can fire one before the operator has read back what it
 * destroys. These deletes are physical in EHRbase (record plus entire version
 * history, no trace afterwards), so the failure that matters is a delete
 * leaving the browser that nobody confirmed.
 *
 * Deliberately asserts on what reaches `fetch`: "the button was disabled" is a
 * claim about styling, while "no POST to /api/admin/execute was made" is the
 * property that actually protects the CDR.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/views/settings';

interface FetchCall {
  url: string;
  method: string;
  body?: any;
}

/** Records every call, answering the Settings view's reads with fixtures. */
function stubFetch(adminCheck: Record<string, unknown>): FetchCall[] {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      if (url.includes('/api/stats')) {
        return json({ templates: 1, templateIds: ['EPS Patient Summary'], ehrs: 0, compositions: 0, patients: 0 });
      }
      if (url.includes('/api/templates')) return json({ templates: ['EPS Patient Summary'] });
      if (url.includes('/api/admin/access-check')) return json(adminCheck);
      if (url.includes('/api/admin/operations')) {
        return json({
          operations: [
            {
              id: 'delete-template',
              method: 'DELETE',
              summary: 'Delete an operational template',
              params: [{ name: 'templateId', label: 'Template ID' }],
            },
          ],
        });
      }
      if (url.includes('/api/admin/execute')) {
        return json({
          operation: 'delete-template',
          endpoint: 'DELETE /rest/admin/template/EPS Patient Summary',
          status: 204,
          ok: true,
          message: 'Deleted.',
          detail: '',
        });
      }
      return json({});
    }),
  );

  return calls;
}

const GRANTED = { endpoint: 'GET /rest/admin', status: 404, granted: true, blocked: false, detail: '' };
const BLOCKED = { endpoint: 'GET /rest/admin', status: 403, granted: false, blocked: true, detail: '' };

/** Mounts the view and lets its initial loads settle. */
async function mountSettings() {
  document.body.innerHTML = '';
  const el = document.createElement('eps-settings') as any;
  document.body.append(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

async function settle(el: any) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

function executeCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.url.includes('/api/admin/execute'));
}

describe('the admin console', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers no delete controls until the access check says granted', async () => {
    const calls = stubFetch(BLOCKED);
    const el = await mountSettings();

    // Before the check has run at all.
    expect(el.querySelector('[data-testid^="delete-template-"]')).toBeNull();

    await el.runAdminCheck();
    await settle(el);

    // And after it comes back refused: a console that only ever answers 403
    // is an invitation to try, not a feature.
    expect(el.querySelector('[data-testid^="delete-template-"]')).toBeNull();
    expect(el.querySelector('[data-testid="admin-confirm"]')).toBeNull();
    expect(calls.some((c) => c.url.includes('/api/admin/operations'))).toBe(false);
  });

  it('arms a delete without sending it', async () => {
    const calls = stubFetch(GRANTED);
    const el = await mountSettings();
    await el.runAdminCheck();
    await settle(el);

    const trigger = el.querySelector('[data-testid="delete-template-EPS Patient Summary"]');
    expect(trigger, 'granted access should expose a delete control').not.toBeNull();

    trigger.click();
    await settle(el);

    expect(el.querySelector('[data-testid="admin-confirm"]')).not.toBeNull();
    // Arming is not deleting.
    expect(executeCalls(calls)).toHaveLength(0);
  });

  it('refuses to run while the typed confirmation does not match', async () => {
    const calls = stubFetch(GRANTED);
    const el = await mountSettings();
    await el.runAdminCheck();
    await settle(el);
    el.querySelector('[data-testid="delete-template-EPS Patient Summary"]').click();
    await settle(el);

    // A near-miss is still a miss — this is the case where an operator has
    // the wrong record's id in the clipboard.
    for (const typed of ['', 'eps patient summary', 'EPS Patient Summar']) {
      el.confirmTyped = typed;
      await settle(el);
      await el.runPending();
      await settle(el);
      expect(executeCalls(calls), `"${typed}" must not delete`).toHaveLength(0);
    }
  });

  it('sends exactly one delete, naming the operation and not a path', async () => {
    const calls = stubFetch(GRANTED);
    const el = await mountSettings();
    await el.runAdminCheck();
    await settle(el);
    el.querySelector('[data-testid="delete-template-EPS Patient Summary"]').click();
    await settle(el);

    el.confirmTyped = 'EPS Patient Summary';
    await settle(el);
    await el.runPending();
    await settle(el);

    const sent = executeCalls(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('POST');
    // The client names an allowlisted id; it never gets to choose a URL under
    // /rest/admin, which is what keeps `template/all` out of reach.
    expect(sent[0].body).toEqual({
      operation: 'delete-template',
      args: { templateId: 'EPS Patient Summary' },
    });
  });

  it('closes the confirmation once the delete has run', async () => {
    stubFetch(GRANTED);
    const el = await mountSettings();
    await el.runAdminCheck();
    await settle(el);
    el.querySelector('[data-testid="delete-template-EPS Patient Summary"]').click();
    await settle(el);
    el.confirmTyped = 'EPS Patient Summary';
    await settle(el);
    await el.runPending();
    await settle(el);

    // Leaving it armed would make a second click delete something else.
    expect(el.querySelector('[data-testid="admin-confirm"]')).toBeNull();
    expect(el.querySelector('[data-testid="admin-op-result"]')).not.toBeNull();
  });
});
