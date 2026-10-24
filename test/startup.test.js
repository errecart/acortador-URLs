import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));

function runServer(dataDir, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [serverPath], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir, PORT: '0', ...envOverrides },
    }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') {
        reject(err);
        return;
      }
      resolve({ status: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('reports corrupt store data without a stack trace', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'acortador-startup-'));
  try {
    await writeFile(join(dataDir, 'links.json'), '{"invalid":');
    const result = await runServer(dataDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No se pudo inicializar el almacén: No se pudo cargar .*JSON inválido/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
    assert.equal(result.stdout, '');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('does not start with an invalid BASE_URL', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'acortador-startup-'));
  try {
    for (const baseUrl of ['localhost:3130', 'ftp://example.com']) {
      const result = await runServer(dataDir, { BASE_URL: baseUrl });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /BASE_URL debe ser una URL de origen HTTP o HTTPS válida/);
      assert.equal(result.stdout, '');
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('persists link visits after SIGTERM and reports the assigned port', {
  skip: process.platform === 'win32',
}, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'acortador-shutdown-'));
  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BASE_URL: 'http://localhost:3000',
      DATA_DIR: dataDir,
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let exitPromise;
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Servidor no inició. stderr: ${stderr}`)), 5_000);
      const checkOutput = () => {
        const match = stdout.match(/Servidor escuchando en el puerto (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      };
      child.stdout.on('data', checkOutput);
      child.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Servidor salió antes de iniciar (code=${code}, signal=${signal}). stderr: ${stderr}`));
      });
      checkOutput();
    });

    const origin = `http://127.0.0.1:${port}`;
    const created = await fetch(`${origin}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/persisted-visit' }),
    });
    assert.equal(created.status, 201);
    const link = await created.json();

    const redirect = await fetch(`${origin}/${link.code}`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);

    exitPromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const exit = await exitPromise;
    assert.equal(exit.code, 0, stderr);

    const persistedLinks = JSON.parse(await readFile(join(dataDir, 'links.json'), 'utf8'));
    assert.equal(persistedLinks.find(({ code }) => code === link.code)?.visits, 1);

    const accessEvents = (await readFile(join(dataDir, 'access.log'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.ok(accessEvents.some(({ event, code }) => event === 'link:visited' && code === link.code));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      if (!exitPromise) {
        exitPromise = new Promise((resolve) => child.once('exit', resolve));
      }
      await exitPromise;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
