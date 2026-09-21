/**
 * The URL derivation and env-fallback behind the EHRbase admin-access
 * diagnostic route (GET /api/admin/access-check).
 *
 * Both directions matter here: deriving the wrong admin URL makes the check
 * probe a server that was never in question, and reports it as reliable.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyAdminProbe,
  ehrbaseAdminBaseFrom,
  envOrDefault,
} from '../../server/admin-access';

describe('classifyAdminProbe', () => {
  it('reads 401 and 403 as blocked — the gate refused', () => {
    expect(classifyAdminProbe(403)).toEqual({ granted: false, blocked: true });
    expect(classifyAdminProbe(401)).toEqual({ granted: false, blocked: true });
  });

  it('reads 404 as GRANTED, not as a failure', () => {
    // The whole check rests on this. EHRbase serves nothing at the Admin API
    // root, so its own 404 is what an ADMITTED caller collects — a refused
    // one is stopped by the policy layer and never reaches EHRbase to be
    // 404'd. Reading this as "not granted" would report an account WITH
    // admin rights over the CDR as if it had none.
    expect(classifyAdminProbe(404)).toEqual({ granted: true, blocked: false });
  });

  it('reads a 2xx as granted', () => {
    expect(classifyAdminProbe(200)).toEqual({ granted: true, blocked: false });
    expect(classifyAdminProbe(204)).toEqual({ granted: true, blocked: false });
  });

  it('commits to neither verdict when the gate did not clearly answer', () => {
    // Claiming "granted" off a 500 would invent admin rights from a server
    // fault; claiming "blocked" would invent a refusal nobody made.
    for (const status of [500, 502, 503, 405, 429]) {
      expect(classifyAdminProbe(status)).toEqual({ granted: false, blocked: false });
    }
  });
});

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
