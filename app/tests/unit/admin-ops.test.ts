/**
 * The allowlist behind the admin console.
 *
 * Every operation here physically deletes CDR data, with no version history
 * left behind to reconstruct it from. The failure that matters is not
 * "operation didn't run" — it is "operation ran against something other than
 * what the operator named", so most of these tests are about paths being
 * built exactly, and about refusing to build one at all when the input is
 * not what it should be.
 */

import { describe, expect, it } from 'vitest';

import { adminOpById, adminOps, describeAdminResult, resolveAdminOp } from '../../server/admin-ops';

describe('the allowlist', () => {
  it('does not expose delete-all, under any id', () => {
    // DELETE /admin/template/all wipes every template in one call. It was
    // deliberately left out, and a passthrough would have re-exposed it.
    const paths = adminOps().map((op) => op.path(Object.fromEntries(
      op.params.map((p) => [p.name, 'x']),
    )));
    expect(paths.some((p) => p.endsWith('/all'))).toBe(false);
    expect(adminOpById('delete-all-templates')).toBeNull();
    expect(adminOpById('delete-template-all')).toBeNull();
  });

  it('refuses an operation it does not define', () => {
    expect(adminOpById('rm-rf')).toBeNull();
    expect(resolveAdminOp('rm-rf', {})).toEqual({
      ok: false,
      error: 'Unknown admin operation: rm-rf',
    });
  });

  it('only ever deletes — no operation mutates in place', () => {
    // A PUT would let the console overwrite a template that stored data is
    // already bound to, which is a different and quieter kind of damage.
    for (const op of adminOps()) expect(op.method).toBe('DELETE');
  });
});

describe('resolveAdminOp', () => {
  it('builds each documented path', () => {
    // Transcribed from EHRbase's admin docs. Note that composition,
    // contribution and directory hang off /admin/{ehr_id}/... with no `ehr`
    // segment, while deleting an EHR has one — that asymmetry is EHRbase's,
    // and these tests are what stop someone "tidying" it into a 404.
    const cases: [string, Record<string, string>, string][] = [
      ['delete-template', { templateId: 'EPS Patient Summary' }, 'template/EPS%20Patient%20Summary'],
      ['delete-ehr', { ehrId: 'abc-123' }, 'ehr/abc-123'],
      ['delete-composition', { ehrId: 'e1', compositionId: 'c1::node::1' }, 'e1/composition/c1%3A%3Anode%3A%3A1'],
      ['delete-contribution', { ehrId: 'e1', contributionId: 'con-1' }, 'e1/contribution/con-1'],
      ['delete-folder', { ehrId: 'e1', folderId: 'f1' }, 'e1/directory/f1'],
    ];

    for (const [id, args, expected] of cases) {
      const result = resolveAdminOp(id, args);
      expect(result.ok, `${id} should resolve`).toBe(true);
      if (result.ok) expect(result.resolved.path).toBe(expected);
    }
  });

  it('percent-encodes each parameter rather than splicing it in raw', () => {
    // A template id containing a slash would otherwise address a different
    // resource entirely — the one case where a DELETE hits something the
    // operator never named.
    const result = resolveAdminOp('delete-template', { templateId: 'a/../b' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolved.path).toBe('template/a%2F..%2Fb');
  });

  it('refuses a missing, blank or whitespace-only parameter', () => {
    // `template/` and `template/%20` are not the resource anyone meant, and
    // on a DELETE that is the whole risk. Blank counts as absent.
    for (const templateId of [undefined, '', '   ']) {
      const result = resolveAdminOp('delete-template', { templateId });
      expect(result.ok, `${JSON.stringify(templateId)} must not resolve`).toBe(false);
    }
  });

  it('refuses when only some of a multi-parameter operation is supplied', () => {
    expect(resolveAdminOp('delete-composition', { ehrId: 'e1' }).ok).toBe(false);
    expect(resolveAdminOp('delete-composition', { compositionId: 'c1' }).ok).toBe(false);
  });

  it('ignores a non-string parameter rather than coercing it', () => {
    // An object or array arriving from JSON must not become "[object Object]"
    // in a delete path.
    expect(resolveAdminOp('delete-ehr', { ehrId: { toString: () => 'x' } }).ok).toBe(false);
    expect(resolveAdminOp('delete-ehr', { ehrId: ['a'] }).ok).toBe(false);
  });
});

describe('describeAdminResult', () => {
  it('reports 422 as EHRbase protecting referenced data, not as an error', () => {
    expect(describeAdminResult(422)).toMatch(/still referenced/i);
  });

  it('distinguishes a refusal from a miss', () => {
    expect(describeAdminResult(403)).toMatch(/admin rights/i);
    expect(describeAdminResult(404)).toMatch(/nothing was deleted/i);
  });

  it('confirms deletion only on a 2xx', () => {
    expect(describeAdminResult(204)).toBe('Deleted.');
    expect(describeAdminResult(200)).toBe('Deleted.');
    expect(describeAdminResult(500)).not.toMatch(/deleted\./i);
  });
});
