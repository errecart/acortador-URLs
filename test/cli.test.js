import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

const code = 'abc1234';
const link = {
  code,
  url: `https://example.com/${'a'.repeat(100)}`,
  createdAt: '2026-10-23T12:00:00.000Z',
  visits: 4,
  lastVisitedAt: '2026-10-23T12:05:00.000Z',
};
let deletedCount = 0;
let apiUrl;

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/links') {
    for await (const _chunk of req) {
      // Consume the request body.
    }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...link, shortUrl: `${apiUrl}/${code}` }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/links') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([link]));
    return;
  }

  if (req.method === 'GET' && req.url === `/api/links/${code}/stats`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(link));
    return;
  }

  if (req.method === 'DELETE' && req.url === `/api/links/${code}`) {
    deletedCount += 1;
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function runCli(args) {
  return runCliWithApi(args, apiUrl);
}

function runCliWithApi(args, configuredApiUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/acortador.js', ...args], {
      env: { ...process.env, API_URL: configuredApiUrl },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end();
  });
}

test('shows help for no arguments and reports unknown commands on stderr', async () => {
  const help = await runCli([]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /acortador-urls create <url>/);
  assert.equal(help.stderr, '');

  const helpFlag = await runCli(['--help']);
  assert.equal(helpFlag.status, 0);
  assert.match(helpFlag.stdout, /acortador-urls delete <code>/);
  assert.equal(helpFlag.stderr, '');

  const unknown = await runCli(['unknown']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Comando desconocido: unknown/);
  assert.match(unknown.stderr, /Uso:/);
  assert.equal(unknown.stdout, '');
  assert.doesNotMatch(unknown.stderr, /\u001b\[/);

  const invalidOptions = await runCli(['list', '--invalid']);
  assert.equal(invalidOptions.status, 2);
  assert.match(invalidOptions.stderr, /Uso:/);

  const missingArgument = await runCli(['create']);
  assert.equal(missingArgument.status, 2);
});

test('create prints only the short link to stdout', async () => {
  const result = await runCli(['create', 'https://example.com/destination']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${apiUrl}/${code}\n`);
  assert.equal(result.stderr, '');
});

test('list prints a truncated table or JSON', async () => {
  const table = await runCli(['list']);
  assert.equal(table.status, 0, table.stderr);
  assert.match(table.stdout, /CÓDIGO\s+VISITAS\s+URL/);
  assert.match(table.stdout, /abc1234\s+4\s+https:\/\/example\.com/);
  assert.match(table.stdout, /…/);
  assert.equal(table.stderr, '');

  const json = await runCli(['list', '--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), [link]);
});

test('stats prints link details', async () => {
  const result = await runCli(['stats', code]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Código: abc1234/);
  assert.match(result.stdout, /Visitas: 4/);
  assert.match(result.stdout, /Última visita: 2026-10-23T12:05:00\.000Z/);
});

test('delete requires confirmation on non-TTY stdin unless --yes is set', async () => {
  deletedCount = 0;
  const refused = await runCli(['delete', code]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /La confirmación requiere una terminal.*--yes/);
  assert.equal(deletedCount, 0);

  const confirmed = await runCli(['delete', code, '--yes']);
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stderr, /Enlace abc1234 borrado/);
  assert.equal(confirmed.stdout, '');
  assert.equal(deletedCount, 1);
});

test('returns 1 for API errors', async () => {
  const result = await runCli(['stats', 'missing']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Not Found/);
  assert.doesNotMatch(result.stderr, /Uso:/);
});

test('reports a clear connection error when the server is unavailable', async () => {
  const unusedServer = createServer();
  await new Promise((resolve) => unusedServer.listen(0, '127.0.0.1', resolve));
  const { port } = unusedServer.address();
  await new Promise((resolve, reject) => {
    unusedServer.close((err) => (err ? reject(err) : resolve()));
  });

  const unavailableApi = `http://127.0.0.1:${port}`;
  const result = await runCliWithApi(['list'], unavailableApi);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`No pude conectarme a ${unavailableApi}, ¿está corriendo el servidor\\?`));
  assert.match(result.stderr, /ECONNREFUSED/);
  assert.doesNotMatch(result.stderr, /Uso:/);
});
