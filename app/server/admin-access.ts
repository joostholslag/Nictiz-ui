/**
 * Pure helpers behind the EHRbase admin-access diagnostic route.
 *
 * Extracted so the URL derivation and env-fallback logic can be pinned by a
 * unit test independently of the express route — this sits behind an
 * auth-adjacent, security-sensitive check, and a later change to
 * EHRBASE_BASE's format should fail a test, not silently probe the wrong URL
 * in production.
 */

/**
 * EHRbase's Admin API root, derived from the openEHR REST API root.
 *
 * A sibling path (`.../rest/admin`), not a path under it
 * (`.../rest/openehr/v1/admin`). Falls back to appending `/admin` when the
 * input doesn't end in the expected `/openehr/v1[/]` — better to probe a URL
 * that 404s than to silently derive the wrong server.
 */
export function ehrbaseAdminBaseFrom(ehrbaseBase: string): string {
  return /\/openehr\/v1\/?$/.test(ehrbaseBase)
    ? ehrbaseBase.replace(/\/openehr\/v1\/?$/, '/admin')
    : `${ehrbaseBase.replace(/\/$/, '')}/admin`;
}

/** What a probe of the Admin API root says about the caller's access. */
export interface AdminProbeVerdict {
  /** The caller was admitted past the authorization gate. */
  granted: boolean;
  /** The gate refused the caller — the secure default. */
  blocked: boolean;
}

/**
 * Reads an Admin API probe's status code as an access verdict.
 *
 * The authorization decision is made on the `/rest/admin` path prefix by the
 * policy layer in FRONT of EHRbase, before EHRbase sees the request at all.
 * So the question this answers is "did the gate open", not "did a route
 * answer" — which is why 404 counts as GRANTED, not as a failure: EHRbase
 * mounts no handler at the Admin API's own root, so a caller who clears the
 * gate gets EHRbase's own 404 rather than a 200. Being refused never gets
 * that far; it comes back 403 from the policy layer.
 *
 * That the probed path has no handler is deliberate, not a workaround: a
 * path nothing serves cannot mutate anything, which every real route under
 * /rest/admin can (they delete or overwrite CDR data). The response body
 * tells the two apart for a human — EHRbase answers JSON, the policy layer
 * answers HTML.
 *
 * Anything else (5xx, 405, …) is deliberately NEITHER: the gate's answer is
 * unclear, and guessing in either direction would be worse than saying so.
 */
export function classifyAdminProbe(status: number): AdminProbeVerdict {
  const blocked = status === 401 || status === 403;
  const granted = !blocked && ((status >= 200 && status < 300) || status === 404);
  return { granted, blocked };
}

/**
 * An env var, falling back when unset OR blank.
 *
 * Plain `??` only catches `undefined` — an env var explicitly set to `""`
 * (a stray blank line in a `.env` file, a shell export left empty) sails
 * straight through it and silently configures an empty header name, which
 * then matches nothing. Same "blank counts as absent" rule identity.ts's
 * `forwardedHeaderValue` applies to header VALUES, applied here to
 * configuration values read from the environment.
 */
export function envOrDefault(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}
