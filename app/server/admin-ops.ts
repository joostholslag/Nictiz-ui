/**
 * The admin operations this BFF is willing to perform, and nothing else.
 *
 * Every route in this list PHYSICALLY deletes data from the CDR — EHRbase's
 * Admin API removes the record and its entire version history, so the change
 * cannot be traced afterwards and the data is not recoverable. That is the
 * whole reason this module is an explicit allowlist rather than a passthrough
 * to `/rest/admin/*`: a passthrough would also expose every route nobody
 * chose, including `DELETE /admin/template/all` and whatever a future EHRbase
 * release adds. An operation absent from this table is unreachable, not merely
 * absent from the UI.
 *
 * Paths come from EHRbase's admin documentation. Note the shape difference
 * that looks like a typo and is transcribed faithfully anyway: deleting an EHR
 * is `/admin/ehr/{ehr_id}`, but composition, contribution and directory hang
 * off `/admin/{ehr_id}/...` with no `ehr` segment. Guessing "corrections" to
 * EHRbase's routes has already been wrong twice here, and a wrong path on a
 * DELETE is harmless (404, nothing deleted) while a wrongly-"fixed" one could
 * reach a real record, so the documented form is what ships.
 */

/** A path parameter an operation needs before it can be addressed. */
export interface AdminOpParam {
  name: string;
  /** Shown in the UI so the operator knows what to paste. */
  label: string;
}

export interface AdminOp {
  /** Stable id, used as the wire value — never a raw path from the client. */
  id: string;
  method: 'DELETE';
  /** What this destroys, in one line, for the confirmation prompt. */
  summary: string;
  params: AdminOpParam[];
  /** Builds the path under the Admin API root, params already encoded. */
  path: (args: Record<string, string>) => string;
}

const ADMIN_OPS: readonly AdminOp[] = [
  {
    id: 'delete-template',
    method: 'DELETE',
    summary: 'Delete an operational template',
    params: [{ name: 'templateId', label: 'Template ID' }],
    path: (a) => `template/${encodeURIComponent(a.templateId)}`,
  },
  {
    id: 'delete-ehr',
    method: 'DELETE',
    summary: 'Delete an EHR and everything recorded in it',
    params: [{ name: 'ehrId', label: 'EHR ID' }],
    path: (a) => `ehr/${encodeURIComponent(a.ehrId)}`,
  },
  {
    id: 'delete-composition',
    method: 'DELETE',
    summary: 'Delete a composition and all of its history',
    params: [
      { name: 'ehrId', label: 'EHR ID' },
      { name: 'compositionId', label: 'Composition UID' },
    ],
    path: (a) =>
      `${encodeURIComponent(a.ehrId)}/composition/${encodeURIComponent(a.compositionId)}`,
  },
  {
    id: 'delete-contribution',
    method: 'DELETE',
    summary: 'Delete a contribution and its associated data',
    params: [
      { name: 'ehrId', label: 'EHR ID' },
      { name: 'contributionId', label: 'Contribution UID' },
    ],
    path: (a) =>
      `${encodeURIComponent(a.ehrId)}/contribution/${encodeURIComponent(a.contributionId)}`,
  },
  {
    id: 'delete-folder',
    method: 'DELETE',
    summary: 'Delete a directory folder',
    params: [
      { name: 'ehrId', label: 'EHR ID' },
      { name: 'folderId', label: 'Folder UID' },
    ],
    path: (a) => `${encodeURIComponent(a.ehrId)}/directory/${encodeURIComponent(a.folderId)}`,
  },
];

/** The operation with this id, or null if it is not one we perform. */
export function adminOpById(id: string): AdminOp | null {
  return ADMIN_OPS.find((op) => op.id === id) ?? null;
}

/** The allowlist, for the UI to render. */
export function adminOps(): readonly AdminOp[] {
  return ADMIN_OPS;
}

export interface ResolvedAdminOp {
  op: AdminOp;
  /** Path under the Admin API root — no leading slash. */
  path: string;
}

/**
 * Resolves an operation id plus its arguments into a path, or explains why not.
 *
 * Blank arguments are rejected rather than encoded: `template/` or
 * `ehr/%20` addresses something other than what the operator meant, and on a
 * DELETE "something other than what they meant" is the entire risk. Missing
 * is missing, whether the field was never sent or sent empty — the same
 * "blank counts as absent" rule identity.ts applies to forwarded headers.
 */
export function resolveAdminOp(
  id: string,
  args: Record<string, unknown>,
): { ok: true; resolved: ResolvedAdminOp } | { ok: false; error: string } {
  const op = adminOpById(id);
  if (!op) return { ok: false, error: `Unknown admin operation: ${id}` };

  const values: Record<string, string> = {};
  for (const param of op.params) {
    const raw = args[param.name];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { ok: false, error: `Missing ${param.label} for ${op.id}` };
    values[param.name] = value;
  }

  return { ok: true, resolved: { op, path: op.path(values) } };
}

/**
 * How an admin call's status code reads back to the operator.
 *
 * 422 is called out separately because it is EHRbase refusing to orphan data
 * — a template still referenced by compositions — which is a correct outcome
 * worth reporting as such, not an error to retry.
 */
export function describeAdminResult(status: number): string {
  if (status === 204 || (status >= 200 && status < 300)) return 'Deleted.';
  if (status === 401 || status === 403) return 'Refused: your account does not hold admin rights.';
  if (status === 404) return 'Not found — nothing was deleted. Check the id.';
  if (status === 422) return 'Refused by EHRbase: still referenced by existing data.';
  return `Unexpected response (HTTP ${status}). Nothing can be assumed about what happened.`;
}
