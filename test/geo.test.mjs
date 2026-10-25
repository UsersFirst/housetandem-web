import test from 'node:test';
import assert from 'node:assert';
import { geoResponse } from '../workers/e-proxy/src/index.js';

test('EU, UK and Swiss visitors need consent; US does not', async () => {
  for (const [c, eu] of [['DE', true], ['fr', true], ['GB', true], ['CH', true], ['NO', true], ['US', false], ['CA', false]]) {
    const body = await geoResponse(c).json();
    assert.strictEqual(body.eu, eu, c);
  }
});

test('unknown country is not treated as EU, and the response is uncacheable', async () => {
  const res = geoResponse(undefined);
  assert.deepStrictEqual(await res.json(), { country: null, eu: false });
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});
