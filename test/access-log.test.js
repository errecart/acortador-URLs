import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.DATA_DIR;
const dataDir = await mkdtemp(join(tmpdir(), 'acortador-access-log-'));
process.env.DATA_DIR = dataDir;

const { events } = await import('../src/events.js');
const { closeAccessLog } = await import('../src/access-log.js');

after(async () => {
  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
  await rm(dataDir, { recursive: true, force: true });
});

test('writes access events as JSON lines without visitor IPs', async () => {
  events.emit('link:visited', { code: 'abc1234', at: '2026-01-01T00:00:00.000Z' });
  await closeAccessLog();

  const [line] = (await readFile(join(dataDir, 'access.log'), 'utf8')).trim().split(/\r?\n/);
  const event = JSON.parse(line);
  assert.deepEqual(event, {
    event: 'link:visited',
    code: 'abc1234',
    at: '2026-01-01T00:00:00.000Z',
  });
  assert.equal('ip' in event, false);
});
