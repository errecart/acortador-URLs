import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.DATA_DIR;
const dataDir = await mkdtemp(join(tmpdir(), 'acortador-urls-'));
process.env.DATA_DIR = dataDir;

const {
  createStore,
} = await import('../src/store.js');
const { createLink, deleteLink, flushStore, initStore, listLinks, recordVisit } = createStore({ dataDir });
const linksFile = join(dataDir, 'links.json');

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
});

test('starts empty, persists links, and rejects invalid JSON or link formats', async () => {
  await initStore();
  assert.deepEqual(await listLinks(), []);

  const createdLink = await createLink('https://example.com/');
  assert.deepEqual(JSON.parse(await readFile(linksFile, 'utf8')), [createdLink]);

  const invalidContents = '{"broken":';
  await writeFile(linksFile, invalidContents);
  await assert.rejects(initStore(), /JSON inválido/);
  assert.equal(await readFile(linksFile, 'utf8'), invalidContents);

  const invalidFormat = JSON.stringify({ links: [] });
  await writeFile(linksFile, invalidFormat);
  await assert.rejects(initStore(), /formato de los enlaces es inválido/);
  assert.equal(await readFile(linksFile, 'utf8'), invalidFormat);

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
});

test('rolls back in-memory changes when the data directory is deleted', async () => {
  const rollbackDataDir = await mkdtemp(join(tmpdir(), 'acortador-rollback-'));
  const rollbackStore = createStore({ dataDir: rollbackDataDir });
  try {
    await rollbackStore.initStore();
    const existingLink = await rollbackStore.createLink('https://example.com/existing');
    await rm(rollbackDataDir, { recursive: true });

    await assert.rejects(rollbackStore.createLink('https://example.com/failing-create'));
    assert.deepEqual(await rollbackStore.listLinks(), [existingLink]);

    await assert.rejects(rollbackStore.deleteLink(existingLink.code));
    assert.deepEqual(await rollbackStore.listLinks(), [existingLink]);

    await mkdir(rollbackDataDir, { recursive: true });
    const recoveredLink = await rollbackStore.createLink('https://example.com/recovered');
    assert.ok((await rollbackStore.listLinks()).some(({ code }) => code === recoveredLink.code));
  } finally {
    await rm(rollbackDataDir, { recursive: true, force: true });
  }
});
