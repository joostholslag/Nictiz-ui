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
