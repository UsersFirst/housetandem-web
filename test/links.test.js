const test = require('node:test');
const assert = require('node:assert');
const { targetUrl, page } = require('../tools/build-links.js');
const { links } = require('../tools/links.json');

test('bio links carry source, medium and the slug as campaign', () => {
  assert.strictEqual(targetUrl('tt', links.tt), '/?utm_source=tiktok&utm_medium=bio&utm_campaign=tt');
  assert.strictEqual(targetUrl('yt', links.yt), '/?utm_source=youtube&utm_medium=shorts&utm_campaign=yt');
});

test('an explicit campaign wins over the slug', () => {
  assert.match(targetUrl('crash', { to: '/', utm_source: 'tiktok', utm_campaign: 'goose_down' }), /utm_campaign=goose_down/);
});

test('redirect page works without JS and is not indexed', () => {
  const html = page('ig', links.ig);
  assert.match(html, /http-equiv="refresh" content="0; url=\/\?utm_source=instagram/);
  assert.match(html, /name="robots" content="noindex"/);
});

test('/discord forwards to the invite as it is, so it can be swapped in one place', () => {
  assert.strictEqual(targetUrl('discord', links.discord), links.discord.to);
  assert.match(links.discord.to, /^https:\/\/discord\.gg\/[A-Za-z0-9]+$/);
  const html = page('discord', links.discord);
  assert.ok(html.includes('content="0; url=' + links.discord.to + '"'));
  assert.ok(html.includes('location.replace("' + links.discord.to + '");'));
  assert.match(html, /name="robots" content="noindex"/);
});
