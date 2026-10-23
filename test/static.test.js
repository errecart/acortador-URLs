import assert from 'node:assert/strict';
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
const server = createApp({ store });
let baseUrl;

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
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
  assert.match(await response.text(), /id="create-form"/);
});

test('rejects traversal paths without serving or leaking files', async () => {
  const traversalPaths = [
    '/%2e%2e%2f.env',
    '/%2e%2e/.env',
    '/..%2f.env',
    '/%2e%2e%5c.env',
    '/%252e%252e%252f.env',
    '/%252e%252e%255c.env',
    '/%2e%2e%252f.env',
    '/%252e%252e%2f.env',
    '/%2e%2e%5c%2e%2e%5c.env',
    '/%2e%2e/%2e%2e/.env',
    '/%252e%252e%252f%252e%252e%252f.env',
  ];

  for (const path of traversalPaths) {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.text();
    assert.notEqual(response.status, 200, `${path} must not be served`);
    assert.deepEqual(JSON.parse(body), { error: 'No encontrado' }, `${path} must not leak a file`);
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
