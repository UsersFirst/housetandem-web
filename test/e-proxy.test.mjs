// The analytics proxy carries what the analytics SDK sends, and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import proxy, { forwardable, forwardHeaders, geoResponse } from '../workers/e-proxy/src/index.js';

test('only the SDK’s own paths and methods are forwarded', () => {
  for (const [m, p] of [['POST', '/e/'], ['POST', '/i/v0/e/'], ['POST', '/batch/'], ['POST', '/flags/'], ['GET', '/decide/'], ['GET', '/array/phc_x/config'], ['OPTIONS', '/e/'], ['POST', '/s/']]) {
    assert.equal(forwardable(m, p), true, `${m} ${p}`);
  }
  for (const [m, p] of [['GET', '/api/projects/1/persons'], ['POST', '/api/event'], ['DELETE', '/e/'], ['PUT', '/batch/'], ['PATCH', '/e/'], ['GET', '/'], ['GET', '/login'], ['POST', '/elsewhere'], ['GET', '/events']]) {
    assert.equal(forwardable(m, p), false, `${m} ${p}`);
  }
});

test('only a fixed list of headers travels: no cookie, no Authorization, no other credential', () => {
  const h = forwardHeaders(new Headers({
    'content-type': 'text/plain', 'user-agent': 'UA', cookie: 'a=b', authorization: 'Bearer personal-key', 'x-api-key': 'k', origin: 'https://housetandem.com',
  }), '203.0.113.9');
  assert.equal(h.get('content-type'), 'text/plain');
  assert.equal(h.get('user-agent'), 'UA');
  assert.equal(h.get('origin'), 'https://housetandem.com');
  assert.equal(h.get('x-forwarded-for'), '203.0.113.9');
  for (const name of ['cookie', 'authorization', 'x-api-key']) assert.equal(h.get(name), null, name);
});

test('anything else is answered here and never reaches PostHog; an oversized body is refused', async () => {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), method: init.method, auth: init.headers.get('authorization') }); return new Response('ok'); };
  try {
    const call = (method, path, headers = {}) => proxy.fetch(new Request('https://e.housetandem.com' + path, { method, headers, body: method === 'POST' ? '{}' : undefined }), {}, { waitUntil() {} });
    assert.equal((await call('GET', '/api/projects/1/persons', { authorization: 'Bearer k' })).status, 404);
    assert.equal((await call('DELETE', '/e/')).status, 404);
    assert.equal(sent.length, 0);
    assert.equal((await call('POST', '/e/?ip=0', { authorization: 'Bearer k', 'content-type': 'text/plain' })).status, 200);
    assert.deepEqual(sent, [{ url: 'https://us.i.posthog.com/e/?ip=0', method: 'POST', auth: null }]);
    assert.equal((await call('POST', '/batch/', { 'content-length': String(5 * 1024 * 1024) })).status, 413);
    assert.equal(sent.length, 1);
  } finally { globalThis.fetch = real; }
});

test('/geo still answers for the games', async () => {
  assert.deepEqual(await geoResponse('de').json(), { country: 'DE', eu: true });
  assert.deepEqual(await geoResponse('US').json(), { country: 'US', eu: false });
});

test('the analytics SDK is our own pinned copy, and the page loads that copy', () => {
  const stamp = JSON.parse(fs.readFileSync(new URL('../js/vendor/POSTHOG_VERSION.json', import.meta.url), 'utf8'));
  const file = fs.readFileSync(new URL('../js/vendor/posthog-array.js', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), stamp.sha256, 'the copy matches its stamp');
  assert.match(stamp.version, /^\d+\.\d+\.\d+$/);
  const loader = fs.readFileSync(new URL('../js/ht-analytics.js', import.meta.url), 'utf8');
  assert.ok(loader.includes("s.src = '/js/vendor/posthog-array.js'"));
  assert.ok(!loader.includes("'/static/array.js'"), 'not the CDN’s current script');
});
