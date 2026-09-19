/**
 * The URL derivation and env-fallback behind the EHRbase admin-access
 * diagnostic route (GET /api/admin/access-check).
 *
 * Both directions matter here: deriving the wrong admin URL makes the check
 * probe a server that was never in question, and reports it as reliable.
 */

import { describe, expect, it } from 'vitest';

import { ehrbaseAdminBaseFrom, envOrDefault } from '../../server/admin-access';

describe('ehrbaseAdminBaseFrom', () => {
  it('replaces the openEHR REST path with the admin sibling path', () => {
    expect(ehrbaseAdminBaseFrom('http://localhost:8082/ehrbase/rest/openehr/v1')).toBe(
      'http://localhost:8082/ehrbase/rest/admin',
    );
  });

  it('tolerates a trailing slash on the openEHR REST path', () => {
    expect(ehrbaseAdminBaseFrom('http://localhost:8082/ehrbase/rest/openehr/v1/')).toBe(
      'http://localhost:8082/ehrbase/rest/admin',
    );
  });

  it('appends /admin when the base does not end in /openehr/v1', () => {
    // Deliberately probing the wrong-looking URL and 404ing beats silently
    // giving up on the derivation and guessing.
    expect(ehrbaseAdminBaseFrom('http://localhost:8082/ehrbase')).toBe(
      'http://localhost:8082/ehrbase/admin',
    );
  });

  it('strips a trailing slash before appending /admin on the fallback path', () => {
    expect(ehrbaseAdminBaseFrom('http://localhost:8082/ehrbase/')).toBe(
      'http://localhost:8082/ehrbase/admin',
    );
  });

  it('does not match /openehr/v1 when it is not the end of the path', () => {
    // A trailing query string or extra path segment must not be mistaken for
    // the openEHR REST root — this is the sharp edge a format change to
    // EHRBASE_BASE could hit.
    expect(ehrbaseAdminBaseFrom('http://localhost:8082/ehrbase/rest/openehr/v1?x=1')).toBe(
      'http://localhost:8082/ehrbase/rest/openehr/v1?x=1/admin',
    );
  });
});

describe('envOrDefault', () => {
  it('returns the value when set', () => {
    expect(envOrDefault('custom-header', 'fallback')).toBe('custom-header');
  });

  it('returns the fallback when unset', () => {
    expect(envOrDefault(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when set to an empty string', () => {
    expect(envOrDefault('', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when set to whitespace only', () => {
    expect(envOrDefault('   ', 'fallback')).toBe('fallback');
  });

  it('trims surrounding whitespace from a real value', () => {
    expect(envOrDefault('  custom-header  ', 'fallback')).toBe('custom-header');
  });
});
