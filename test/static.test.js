import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Writable } from 'node:stream';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'acortador-static-'));

const [{ createApp }, { createStore }, { serveStatic }] = await Promise.all([
  import('../src/app.js'),
  import('../src/store.js'),
  import('../src/static.js'),
]);
const store = createStore({ dataDir });
const server = createApp({
  store,
  baseUrl: new URL('http://localhost:3000'),
  events: new EventEmitter(),
});
let baseUrl;

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
}

function requestRawPath(path) {
  return new Promise((resolve, reject) => {
    const { port } = new URL(baseUrl);
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  await store.initStore();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await store.flushStore();
  await rm(dataDir, { recursive: true, force: true });
});

test('serves the home page as HTML', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /id="create-form"/);
  assert.match(html, /name="description"/);
  assert.match(html, /href="\/favicon\.svg"/);
});

test('serves HEAD requests without a body', async () => {
  const response = await fetch(`${baseUrl}/`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.ok(Number(response.headers.get('content-length')) > 0);
  assert.equal(await response.text(), '');
});

test('serves the favicon as SVG', async () => {
  const response = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await response.text(), /<svg/);
});

test('rejects traversal paths without serving or leaking files', async () => {
  const traversalPaths = [
    '/%2e%2e%2fpackage.json',
    '/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/%2e%2e%5cpackage.json',
    '/%252e%252e%252fpackage.json',
    '/%252e%252e%255cpackage.json',
    '/%2e%2e%252fpackage.json',
    '/%252e%252e%2fpackage.json',
    '/%2e%2e%5c%2e%2e%5cpackage.json',
    '/%2e%2e/%2e%2e/package.json',
    '/%252e%252e%252f%252e%252e%252fpackage.json',
  ];

  for (const path of traversalPaths) {
    const response = await requestRawPath(path);
    assert.equal(response.status, 404, `${path} must not be served`);
    assert.deepEqual(JSON.parse(response.body), { error: 'No encontrado' }, `${path} must not leak a file`);
  }
});

test('rejects null bytes in static paths with 400', async () => {
  const response = await fetch(`${baseUrl}/%00.html`);
  assert.equal(response.status, 400);
  assertSecurityHeaders(response);

  const missing = await fetch(`${baseUrl}/missing.css`);
  assert.equal(missing.status, 404);
  assertSecurityHeaders(missing);
});

test('ignores a prematurely closed response stream', async () => {
  class ClosedResponse extends Writable {
    writeHead() {}

    _write(_chunk, _encoding, callback) {
      callback();
      this.destroy();
    }
  }

  await assert.doesNotReject(serveStatic({ method: 'GET' }, new ClosedResponse(), '/styles.css'));
});
