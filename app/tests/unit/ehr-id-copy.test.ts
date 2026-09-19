/**
 * Getting the EHR ID back out of the UI.
 *
 * The Compositions header shows the id truncated, which is right for the
 * clinical work but left the full value unobtainable anywhere in the app —
 * and it is the addressing key for everything done to an EHR from outside:
 * admin API calls, hand-written AQL, a support question.
 *
 * The bug worth guarding against is subtle: a copy button that copies what is
 * on screen rather than what it stands for. Copying "550e8400…" looks like it
 * worked and pastes something useless.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/views/compositions';

const EHR_ID = '550e8400-e29b-41d4-a716-446655440000';

/** Answers the reads the Compositions view makes on connect. */
function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      if (url.includes('/ehr')) return json({ ehrId: EHR_ID });
      if (url.includes('/api/templates')) return json({ templates: [] });
      if (url.includes('/compositions')) return json({ groups: [] });
      return json({});
    }),
  );
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(writeText) } });
  return (globalThis.navigator as any).clipboard.writeText;
}

async function mountWithEhr() {
  document.body.innerHTML = '';
  const el = document.createElement('eps-compositions') as any;
  el.patientId = 'patient-1';
  document.body.append(el);
  await el.updateComplete;
  // The view resolves its EHR asynchronously; set it directly so the test is
  // about the copy affordance rather than about the lookup.
  el.ehrId = EHR_ID;
  await el.updateComplete;
  return el;
}

describe('copying the EHR ID', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch();
  });

  it('shows the id truncated, but keeps the whole value reachable on hover', async () => {
    const el = await mountWithEhr();
    const shown = el.querySelector('[data-testid="ehr-id"]');

    expect(shown.textContent).toContain('550e8400');
    expect(shown.textContent).not.toContain(EHR_ID);
    expect(shown.getAttribute('title')).toBe(EHR_ID);
  });

  it('copies the FULL id, not the truncated text on screen', async () => {
    const writeText = stubClipboard(async () => {});
    const el = await mountWithEhr();

    el.querySelector('[data-testid="copy-ehr-id"]').click();
    await el.updateComplete;

    expect(writeText).toHaveBeenCalledWith(EHR_ID);
    // The failure this guards: copying what is rendered pastes an id that is
    // 8 characters long and addresses nothing.
    expect(writeText).not.toHaveBeenCalledWith('550e8400…');
  });

  it('reveals the full id when the clipboard refuses', async () => {
    // Insecure context, denied permission — a button that silently does
    // nothing would leave the value unobtainable, which is the whole problem
    // this change exists to fix.
    stubClipboard(async () => {
      throw new Error('denied');
    });
    const el = await mountWithEhr();

    el.querySelector('[data-testid="copy-ehr-id"]').click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.querySelector('[data-testid="ehr-id"]').textContent).toContain(EHR_ID);
  });

  it('offers nothing to copy when the patient has no EHR yet', async () => {
    document.body.innerHTML = '';
    const el = document.createElement('eps-compositions') as any;
    el.patientId = 'patient-1';
    document.body.append(el);
    await el.updateComplete;
    el.ehrId = null;
    await el.updateComplete;

    expect(el.querySelector('[data-testid="copy-ehr-id"]')).toBeNull();
  });
});
