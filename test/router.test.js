import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { HttpError, sendJson } from '../src/http-utils.js';
import { routeRequest } from '../src/router.js';
import { initStore } from '../src/store.js';
import { events } from '../src/events.js';
import '../src/stats.js';

const server = createServer(async (req, res) => {
  try {
    await routeRequest(req, res, new URL(req.url, 'http://localhost'));
  } catch (err) {
    if (!res.headersSent) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Internal Server Error';
      sendJson(res, status, { error: message });
    }
  }
});

let baseUrl;

before(async () => {
  await initStore();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test('creates valid links and redirects with a temporary redirect', async () => {
  const receivedEvents = [];
  const captureEvent = (event) => (payload) => receivedEvents.push({ event, payload });
  const onCreated = captureEvent('link:created');
  const onVisited = captureEvent('link:visited');
  events.on('link:created', onCreated);
  events.on('link:visited', onVisited);

  const response = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/path' }),
  });

  assert.equal(response.status, 201);
  const link = await response.json();
  assert.deepEqual(Object.keys(link).sort(), [
    'code',
    'createdAt',
    'lastVisitedAt',
    'shortUrl',
    'url',
    'visits',
  ]);
  assert.match(link.code, /^[\w-]{7}$/);
  assert.equal(link.url, 'https://example.com/path');
  assert.ok(Number.isFinite(Date.parse(link.createdAt)));
  const configuredBaseUrl = (process.env.API_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  assert.equal(link.shortUrl, `${configuredBaseUrl}/${link.code}`);

  const linksResponse = await fetch(`${baseUrl}/api/links`);
  assert.equal(linksResponse.status, 200);
  assert.ok((await linksResponse.json()).some((storedLink) => storedLink.code === link.code));

  const redirect = await fetch(`${baseUrl}/${link.code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), link.url);

  const statsResponse = await fetch(`${baseUrl}/api/links/${link.code}/stats`);
  assert.equal(statsResponse.status, 200);
  assert.deepEqual(await statsResponse.json(), {
    code: link.code,
    url: link.url,
    createdAt: link.createdAt,
    visits: 1,
    lastVisitedAt: receivedEvents[1].payload.at,
  });

  events.off('link:created', onCreated);
  events.off('link:visited', onVisited);
  assert.deepEqual(receivedEvents.map(({ event }) => event), ['link:created', 'link:visited']);
  for (const { payload } of receivedEvents) {
    assert.equal(payload.code, link.code);
    assert.ok(Number.isFinite(Date.parse(payload.at)));
  }

  const missingLink = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(missingLink.status, 404);

  for (const path of ['/api', '/favicon.ico', '/too-short']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, `${path} should not match a short code`);
  }
});

test('serves the vanilla frontend and its assets', async () => {
  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /text\/html/);
  assert.equal(pageResponse.headers.get('x-content-type-options'), 'nosniff');
  const pageBody = await pageResponse.arrayBuffer();
  assert.equal(Number(pageResponse.headers.get('content-length')), pageBody.byteLength);
  assert.match(Buffer.from(pageBody).toString(), /id="create-form"/);

  const appResponse = await fetch(`${baseUrl}/app.js`);
  assert.equal(appResponse.status, 200);
  assert.match(appResponse.headers.get('content-type'), /javascript/);
  const appScript = await appResponse.text();
  assert.match(appScript, /textContent/);
  assert.doesNotMatch(appScript, /innerHTML/);

  const stylesResponse = await fetch(`${baseUrl}/styles.css`);
  assert.equal(stylesResponse.status, 200);
  assert.match(stylesResponse.headers.get('content-type'), /text\/css/);
});

test('validates static paths and accepts only GET', async () => {
  const methodResponse = await fetch(`${baseUrl}/app.js`, { method: 'HEAD' });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'GET');

  const malformedPathResponse = await fetch(`${baseUrl}/%E0%A4%A`);
  assert.equal(malformedPathResponse.status, 400);

  const traversalResponse = await fetch(`${baseUrl}/%2e%2e%2f.env`);
  assert.equal(traversalResponse.status, 404);

  const directoryResponse = await fetch(`${baseUrl}/missing/`);
  assert.equal(directoryResponse.status, 404);
});

test('rejects malformed JSON and non-HTTP(S) URLs', async () => {
  const malformedJson = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformedJson.status, 400);

  const invalidUrl = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'javascript:alert(1)' }),
  });
  assert.equal(invalidUrl.status, 400);
});

test('emits creation and deletion events after sending responses', async () => {
  const onCreated = () => {
    throw new Error('creation listener failed');
  };
  events.on('link:created', onCreated);

  let createdResponse;
  try {
    createdResponse = await fetch(`${baseUrl}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/listener-error' }),
    });
  } finally {
    events.off('link:created', onCreated);
  }

  assert.equal(createdResponse.status, 201);
  const link = await createdResponse.json();
  const linksResponse = await fetch(`${baseUrl}/api/links`);
  assert.ok((await linksResponse.json()).some(({ code }) => code === link.code));

  const onDeleted = () => {
    throw new Error('deletion listener failed');
  };
  events.on('link:deleted', onDeleted);

  let deletedResponse;
  try {
    deletedResponse = await fetch(`${baseUrl}/api/links/${link.code}`, { method: 'DELETE' });
  } finally {
    events.off('link:deleted', onDeleted);
  }

  assert.equal(deletedResponse.status, 204);
  const deletedLinksResponse = await fetch(`${baseUrl}/api/links`);
  assert.ok(!(await deletedLinksResponse.json()).some(({ code }) => code === link.code));
});

test('deletes links and returns 404 when the link does not exist', async () => {
  const createdResponse = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/to-delete' }),
  });
  const link = await createdResponse.json();

  const deletedEvents = [];
  const onDeleted = (payload) => deletedEvents.push(payload);
  events.on('link:deleted', onDeleted);
  const deletedResponse = await fetch(`${baseUrl}/api/links/${link.code}`, { method: 'DELETE' });
  events.off('link:deleted', onDeleted);
  assert.equal(deletedResponse.status, 204);
  assert.equal(await deletedResponse.text(), '');
  assert.deepEqual(deletedEvents.map(({ code }) => code), [link.code]);
  assert.ok(Number.isFinite(Date.parse(deletedEvents[0].at)));

  const missingResponse = await fetch(`${baseUrl}/api/links/${link.code}`, { method: 'DELETE' });
  assert.equal(missingResponse.status, 404);
  assert.equal(deletedEvents.length, 1);
});

test('returns 404 for stats of a missing link', async () => {
  const response = await fetch(`${baseUrl}/api/links/abc1234/stats`);
  assert.equal(response.status, 404);
});
