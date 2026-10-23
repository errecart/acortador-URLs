import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.DATA_DIR;
const dataDir = await mkdtemp(join(tmpdir(), 'acortador-urls-'));
process.env.DATA_DIR = dataDir;

const {
  createLink,
  deleteLink,
  flushStore,
  initStore,
  listLinks,
  recordVisit,
} = await import('../src/store.js');
const linksFile = join(dataDir, 'links.json');

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
});

test('loads and persists links, and does not overwrite invalid JSON', async () => {
  await initStore();
  assert.deepEqual(await listLinks(), []);

  const createdLink = await createLink('https://example.com/');
  assert.deepEqual(JSON.parse(await readFile(linksFile, 'utf8')), [createdLink]);

  const invalidContents = '{"broken":';
  await writeFile(linksFile, invalidContents);
  await assert.rejects(initStore(), /JSON inválido/);
  assert.equal(await readFile(linksFile, 'utf8'), invalidContents);

  const savedLink = { code: 'abc1234', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z' };
  await writeFile(linksFile, JSON.stringify([savedLink]));
  await initStore();
  assert.deepEqual(await listLinks(), [{ ...savedLink, visits: 0, lastVisitedAt: null }]);

  const lastVisitedAt = '2026-01-02T00:00:00.000Z';
  assert.equal(await recordVisit(savedLink.code, lastVisitedAt), true);
  assert.equal(JSON.parse(await readFile(linksFile, 'utf8'))[0].visits, undefined);
  await flushStore();
  assert.deepEqual(JSON.parse(await readFile(linksFile, 'utf8')), [{
    ...savedLink,
    visits: 1,
    lastVisitedAt,
  }]);
});

test('serializes concurrent writes and persists deletions', async () => {
  await writeFile(linksFile, '[]');
  await initStore();

  const createdLinks = await Promise.all(
    Array.from({ length: 10 }, (_, index) => createLink(`https://example.com/${index}`)),
  );
  const persistedLinks = JSON.parse(await readFile(linksFile, 'utf8'));
  assert.deepEqual(
    new Set(persistedLinks.map((link) => link.code)),
    new Set(createdLinks.map((link) => link.code)),
  );

  assert.equal(await deleteLink(createdLinks[0].code), true);
  assert.equal(await deleteLink(createdLinks[0].code), false);
  assert.deepEqual(
    JSON.parse(await readFile(linksFile, 'utf8')),
    createdLinks.slice(1),
  );

  await rm(linksFile);
  await mkdir(linksFile);
  await assert.rejects(createLink('https://example.com/failing-write'));
  assert.ok(!(await listLinks()).some((link) => link.url === 'https://example.com/failing-write'));
  await rm(linksFile, { recursive: true });

  const afterFailure = await createLink('https://example.com/after-failure');
  assert.ok(JSON.parse(await readFile(linksFile, 'utf8')).some((link) => link.code === afterFailure.code));

  await rm(linksFile);
  await mkdir(linksFile);
  await assert.rejects(deleteLink(afterFailure.code));
  assert.ok((await listLinks()).some((link) => link.code === afterFailure.code));
  await rm(linksFile, { recursive: true });
  assert.equal(await deleteLink(afterFailure.code), true);
  assert.ok(!(await listLinks()).some((link) => link.code === afterFailure.code));
});
