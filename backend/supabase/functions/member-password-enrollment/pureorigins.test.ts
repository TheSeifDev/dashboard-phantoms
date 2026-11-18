import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_ORIGIN,
  isExactLoopbackHttpOrigin,
  isExactProductionOrigin,
  validateOriginConfiguration,
} from './pureorigins.ts';

const localOrigin = 'http://127.0.0.1:4173';

function valid(input: Parameters<typeof validateOriginConfiguration>[0] = {}) {
  return validateOriginConfiguration(input).valid;
}

test('production defaults to the sole exact dashboard origin', () => {
  const result = validateOriginConfiguration();
  assert.equal(result.valid, true);
  assert.equal(result.disposable, false);
  assert.deepEqual(result.origins, [PRODUCTION_ORIGIN]);
  assert.equal(isExactProductionOrigin(PRODUCTION_ORIGIN), true);
});

test('production accepts only repeated exact dashboard configuration', () => {
  assert.equal(valid({ allowedOrigins: PRODUCTION_ORIGIN, appUrl: PRODUCTION_ORIGIN }), true);
  assert.equal(valid({ allowedOrigins: `${PRODUCTION_ORIGIN},${PRODUCTION_ORIGIN}` }), true);
});

test('production rejects preview, wildcard, credential-bearing, path-bearing, and non-HTTPS origins', () => {
  for (const origin of [
    'https://dashboard-phantoms-git-preview.vercel.app',
    'https://*.vercel.app',
    'https://attacker.example',
    'https://user:password@dashboard-phantoms.vercel.app',
    'https://dashboard-phantoms.vercel.app/path',
    'https://dashboard-phantoms.vercel.app/?x=1',
    'http://dashboard-phantoms.vercel.app',
  ]) {
    assert.equal(valid({ allowedOrigins: origin }), false, origin);
  }
});

test('an unapproved app URL fails production configuration instead of being ignored', () => {
  assert.equal(valid({ appUrl: 'https://preview-dashboard.vercel.app' }), false);
  assert.equal(validateOriginConfiguration({ appUrl: 'https://preview-dashboard.vercel.app' }).origins.length, 0);
});

test('disposable mode requires an explicit exact loopback HTTP origin', () => {
  const result = validateOriginConfiguration({ disposableAuth: '1', allowedOrigins: localOrigin, appUrl: localOrigin });
  assert.equal(result.valid, true);
  assert.equal(result.disposable, true);
  assert.deepEqual(result.origins, [localOrigin]);
  assert.equal(isExactLoopbackHttpOrigin(localOrigin), true);
});

test('disposable mode never permits hosted, preview, wildcard, or other loopback forms', () => {
  for (const origin of [
    PRODUCTION_ORIGIN,
    'https://dashboard-phantoms-git-preview.vercel.app',
    'https://*.vercel.app',
    'http://localhost:4173',
    'http://127.0.0.1',
    'http://127.0.0.1:80',
    'http://127.0.0.1:4173/path',
    'http://user:password@127.0.0.1:4173',
  ]) {
    assert.equal(valid({ disposableAuth: '1', allowedOrigins: origin }), false, origin);
  }
});

test('disposable mode rejects malformed or missing explicit flag/origin', () => {
  assert.equal(valid({ allowedOrigins: localOrigin }), false);
  assert.equal(valid({ disposableAuth: '0', allowedOrigins: localOrigin }), false);
  assert.equal(valid({ disposableAuth: 'yes', allowedOrigins: localOrigin }), false);
  assert.equal(valid({ disposableAuth: '1' }), false);
  assert.equal(valid({ disposableAuth: '1', allowedOrigins: `${localOrigin},` }), false);
});
