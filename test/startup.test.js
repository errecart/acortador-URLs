import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));

function runServer(dataDir) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [serverPath], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir, PORT: '0' },
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
