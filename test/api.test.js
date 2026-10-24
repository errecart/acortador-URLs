import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalBaseUrl = process.env.BASE_URL;
const originalApiUrl = process.env.API_URL;
const originalRequestTimeout = process.env.REQUEST_TIMEOUT_MS;
const originalHeadersTimeout = process.env.HEADERS_TIMEOUT_MS;
const originalKeepAliveTimeout = process.env.KEEP_ALIVE_TIMEOUT_MS;
const dataDir = await mkdtemp(join(tmpdir(), 'acortador-api-'));
process.env.BASE_URL = 'http://127.0.0.1:3000';
process.env.REQUEST_TIMEOUT_MS = '2000';
process.env.HEADERS_TIMEOUT_MS = '500';
process.env.KEEP_ALIVE_TIMEOUT_MS = '750';
delete process.env.API_URL;

const [{ createApp }, { createStore }] = await Promise.all([
  import('../src/app.js'),
  import('../src/store.js'),
]);
const store = createStore({ dataDir });
const server = createApp({ store });
let baseUrl;

before(async () => {
  await store.initStore();
  assert.equal(server.listening, false);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await store.flushStore();
  await rm(dataDir, { recursive: true, force: true });
  for (const [name, value] of [
    ['REQUEST_TIMEOUT_MS', originalRequestTimeout],
    ['HEADERS_TIMEOUT_MS', originalHeadersTimeout],
    ['KEEP_ALIVE_TIMEOUT_MS', originalKeepAliveTimeout],
  ]) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  if (originalBaseUrl === undefined) {
    delete process.env.BASE_URL;
  } else {
    process.env.BASE_URL = originalBaseUrl;
  }
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

async function createLink(url) {
  return fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

function assertSecurityHeaders(response) {
  const getHeader = (name) => (
    typeof response.headers.get === 'function'
      ? response.headers.get(name)
      : response.headers[name.toLowerCase()]
  );
  assert.equal(getHeader('content-security-policy'), "default-src 'self'");
  assert.equal(getHeader('x-content-type-options'), 'nosniff');
  assert.equal(getHeader('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(getHeader('x-frame-options'), 'DENY');
}

function postChunkedBody() {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    let responseReceived = false;
    const req = httpRequest({
      hostname,
      port,
      path: '/api/links',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      responseReceived = true;
      const responseChunks = [];
      res.on('data', (chunk) => responseChunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(responseChunks).toString('utf8'),
      }));
    });
    req.on('error', (err) => {
      if (!responseReceived) {
        reject(err);
      }
    });
    req.write('{"url":"https://example.com/');
    req.write('a'.repeat(12 * 1024));
    req.end('"}');
  });
}

function sendSlowHeaders() {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    const socket = createConnection({ host: hostname, port });
    let response = '';
    let dripTimer;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('El servidor no cerró la conexión con headers lentos'));
    }, 4_000);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\nX-Slow: ');
      dripTimer = setInterval(() => socket.write('a'), 150);
    });
    socket.on('data', (chunk) => {
      response += chunk;
    });
    socket.on('error', (err) => {
      if (response.length === 0) {
        clearTimeout(timeout);
        clearInterval(dripTimer);
        reject(err);
      }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      clearInterval(dripTimer);
      resolve(response);
    });
  });
}

test('configures HTTP timeouts and rejects slowly delivered headers', async () => {
  assert.equal(server.requestTimeout, 2000);
  assert.equal(server.headersTimeout, 500);
  assert.equal(server.keepAliveTimeout, 750);

  const response = await sendSlowHeaders();
  assert.match(response, /^HTTP\/1\.1 408 Request Timeout/);
});

test('health responds and restricts methods with Allow', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assertSecurityHeaders(health);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const wrongMethod = await fetch(`${baseUrl}/health`, { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assertSecurityHeaders(wrongMethod);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
});

test('does not log client errors but logs server errors', async () => {
  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);

  let failingServer;
  try {
    const notFound = await fetch(`${baseUrl}/not-a-route`);
    assert.equal(notFound.status, 404);
    assert.deepEqual(loggedErrors, []);

    failingServer = createApp({
      store: {
        listLinks: async () => {
          throw new Error('store failure');
        },
      },
    });
    await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve));
    const failingUrl = `http://127.0.0.1:${failingServer.address().port}/api/links`;
    const serverError = await fetch(failingUrl);
    assert.equal(serverError.status, 500);
    assert.equal(loggedErrors.length, 1);
    assert.match(loggedErrors[0][0].message, /store failure/);
  } finally {
    console.error = originalConsoleError;
    if (failingServer?.listening) {
      await new Promise((resolve, reject) => {
        failingServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }
});

test('creates and redirects links, and stats count visits', async () => {
  const response = await createLink('https://example.com/path');
  assert.equal(response.status, 201);
  assertSecurityHeaders(response);
  const link = await response.json();
  assert.match(link.code, /^[\w-]{7}$/);
  assert.equal(link.url, 'https://example.com/path');
  assert.equal(link.visits, 0);
  const configuredBaseUrl = process.env.BASE_URL.replace(/\/+$/, '');
  assert.equal(link.shortUrl, `${configuredBaseUrl}/${link.code}`);

  const redirect = await fetch(`${baseUrl}/${link.code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assertSecurityHeaders(redirect);
  assert.equal(redirect.headers.get('location'), link.url);

  const stats = await fetch(`${baseUrl}/api/links/${link.code}/stats`);
  assert.equal(stats.status, 200);
  assertSecurityHeaders(stats);
  const data = await stats.json();
  assert.equal(data.visits, 1);
  assert.ok(Number.isFinite(Date.parse(data.lastVisitedAt)));
});

test('validates JSON and destination URLs', async () => {
  const missingUrl = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missingUrl.status, 400);
  assertSecurityHeaders(missingUrl);
  assert.deepEqual(await missingUrl.json(), { error: 'Se requiere una URL' });

  const malformedJson = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformedJson.status, 400);
  assertSecurityHeaders(malformedJson);
  assert.deepEqual(await malformedJson.json(), { error: 'JSON inválido' });

  const invalidUrl = await createLink('not a URL');
  assert.equal(invalidUrl.status, 400);
  assertSecurityHeaders(invalidUrl);
  assert.deepEqual(await invalidUrl.json(), { error: 'URL inválida' });

  const unsupportedProtocol = await createLink('javascript:alert(1)');
  assert.equal(unsupportedProtocol.status, 400);
  assertSecurityHeaders(unsupportedProtocol);
  assert.deepEqual(await unsupportedProtocol.json(), { error: 'La URL debe usar HTTP o HTTPS' });

  const embeddedCredentials = await createLink('https://user:password@example.com/private');
  assert.equal(embeddedCredentials.status, 400);
  assertSecurityHeaders(embeddedCredentials);
  assert.deepEqual(await embeddedCredentials.json(), { error: 'La URL no puede incluir usuario ni contraseña' });
});

test('accepts URLs up to 2048 characters and rejects longer URLs and own-domain destinations', async () => {
  const prefix = 'https://example.com/';
  const urlAtLimit = `${prefix}${'a'.repeat(2048 - prefix.length)}`;
  assert.equal(urlAtLimit.length, 2048);
  const accepted = await createLink(urlAtLimit);
  assert.equal(accepted.status, 201);
  assertSecurityHeaders(accepted);
  assert.equal((await accepted.json()).url, urlAtLimit);

  const tooLong = await createLink(`${prefix}${'a'.repeat(2049 - prefix.length)}`);
  assert.equal(tooLong.status, 400);
  assertSecurityHeaders(tooLong);
  assert.deepEqual(await tooLong.json(), { error: 'La URL no puede superar los 2048 caracteres' });

  const ownDomain = await createLink('https://127.0.0.1:9876/somewhere');
  assert.equal(ownDomain.status, 400);
  assertSecurityHeaders(ownDomain);
  assert.deepEqual(await ownDomain.json(), { error: 'No se pueden acortar URLs del mismo dominio' });
});

test('rejects oversized JSON bodies with Content-Length and drains the request', async () => {
  const linkCount = (await store.listLinks()).length;
  const body = JSON.stringify({ url: `https://example.com/${'a'.repeat(20 * 1024 * 1024)}` });
  const response = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  assert.equal(response.status, 413);
  assertSecurityHeaders(response);
  assert.equal(response.headers.get('connection'), 'close');
  assert.deepEqual(await response.json(), { error: 'El cuerpo de la solicitud supera el límite de 10 KB' });
  assert.equal((await store.listLinks()).length, linkCount);
});

test('rejects oversized chunked JSON bodies and closes the connection', async () => {
  const linkCount = (await store.listLinks()).length;
  const response = await postChunkedBody();

  assert.equal(response.status, 413);
  assertSecurityHeaders(response);
  assert.equal(response.headers.connection, 'close');
  assert.deepEqual(JSON.parse(response.body), { error: 'El cuerpo de la solicitud supera el límite de 10 KB' });
  assert.equal((await store.listLinks()).length, linkCount);
});

test('returns 404 for missing resources and 405 with Allow for wrong methods', async () => {
  const missingRoute = await fetch(`${baseUrl}/not-a-route`);
  assert.equal(missingRoute.status, 404);
  assertSecurityHeaders(missingRoute);

  const missingRedirect = await fetch(`${baseUrl}/miss123`, { redirect: 'manual' });
  assert.equal(missingRedirect.status, 404);
  assertSecurityHeaders(missingRedirect);

  const missingStats = await fetch(`${baseUrl}/api/links/miss123/stats`);
  assert.equal(missingStats.status, 404);
  assertSecurityHeaders(missingStats);

  const statsWrongMethod = await fetch(`${baseUrl}/api/links/abc1234/stats`, { method: 'POST' });
  assert.equal(statsWrongMethod.status, 405);
  assertSecurityHeaders(statsWrongMethod);
  assert.equal(statsWrongMethod.headers.get('allow'), 'GET');

  const linkWrongMethod = await fetch(`${baseUrl}/api/links/abc1234`);
  assert.equal(linkWrongMethod.status, 405);
  assertSecurityHeaders(linkWrongMethod);
  assert.equal(linkWrongMethod.headers.get('allow'), 'DELETE');

  const redirectWrongMethod = await fetch(`${baseUrl}/abc1234`, { method: 'POST' });
  assert.equal(redirectWrongMethod.status, 405);
  assertSecurityHeaders(redirectWrongMethod);
  assert.equal(redirectWrongMethod.headers.get('allow'), 'GET');
});

test('deletes links and returns 404 when the link does not exist', async () => {
  const created = await createLink('https://example.com/to-delete');
  const link = await created.json();

  const deleted = await fetch(`${baseUrl}/api/links/${link.code}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assertSecurityHeaders(deleted);

  const missing = await fetch(`${baseUrl}/api/links/${link.code}`, { method: 'DELETE' });
  assert.equal(missing.status, 404);
  assertSecurityHeaders(missing);
});

test('handles 50 concurrent link creations', async () => {
  const responses = await Promise.all(
    Array.from({ length: 50 }, (_, index) => createLink(`https://example.com/concurrent/${index}`)),
  );
  assert.ok(responses.every(({ status }) => status === 201));

  const links = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(links.map(({ code }) => code)).size, 50);
  assert.equal(new Set(links.map(({ url }) => url)).size, 50);
});
