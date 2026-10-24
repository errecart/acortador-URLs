import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export function createStore({ dataDir = './data' } = {}) {
  const resolvedDataDir = resolve(dataDir);
  const linksFile = join(resolvedDataDir, 'links.json');
  const tempLinksFile = `${linksFile}.tmp`;
  const links = new Map();
  let writeQueue = Promise.resolve();
  let visitsDirty = false;
  let visitsFlushTimer;

  async function initStore() {
    await mkdir(resolvedDataDir, { recursive: true });

    let contents;
    try {
      contents = await readFile(linksFile, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        links.clear();
        return;
      }
      throw err;
    }

    let storedLinks;
    try {
      storedLinks = JSON.parse(contents);
    } catch (err) {
      throw new Error(`No se pudo cargar ${linksFile}: el archivo contiene JSON inválido`, { cause: err });
    }

    if (
      !Array.isArray(storedLinks)
      || storedLinks.some((link) => (
        !link
        || typeof link.code !== 'string'
        || typeof link.url !== 'string'
        || typeof link.createdAt !== 'string'
      ))
    ) {
      throw new Error(`No se pudo cargar ${linksFile}: el formato de los enlaces es inválido`);
    }

    links.clear();
    for (const link of storedLinks) {
      links.set(link.code, {
        ...link,
        visits: link.visits ?? 0,
        lastVisitedAt: link.lastVisitedAt ?? null,
      });
    }
  }

  function enqueueStoreOperation(operation) {
    const write = writeQueue.then(operation);
    writeQueue = write.catch(() => {});
    return write;
  }

  async function writeLinks() {
    await writeFile(tempLinksFile, JSON.stringify([...links.values()], null, 2));
    await rename(tempLinksFile, linksFile);
  }

  function persistLinks() {
    return enqueueStoreOperation(writeLinks);
  }

  function scheduleVisitsFlush() {
    if (visitsFlushTimer) {
      return;
    }

    visitsFlushTimer = setTimeout(() => {
      visitsFlushTimer = undefined;
      flushStore().catch((err) => {
        console.error('No se pudieron persistir las visitas:', err);
        scheduleVisitsFlush();
      });
    }, 1000);
  }

  async function flushStore() {
    if (visitsFlushTimer) {
      clearTimeout(visitsFlushTimer);
      visitsFlushTimer = undefined;
    }

    if (!visitsDirty) {
      await writeQueue;
      return;
    }

    visitsDirty = false;
    try {
      await persistLinks();
    } catch (err) {
      visitsDirty = true;
      throw err;
    }
  }

  async function createLink(url) {
    return enqueueStoreOperation(async () => {
      let code;
      do {
        code = randomBytes(5).toString('base64url');
      } while (links.has(code));

      const link = {
        code,
        url,
        createdAt: new Date().toISOString(),
        visits: 0,
        lastVisitedAt: null,
      };
      links.set(code, link);
      try {
        await writeLinks();
      } catch (err) {
        links.delete(code);
        throw err;
      }
      return link;
    });
  }

  async function getLink(code) {
    return links.get(code);
  }

  async function recordVisit(code, at = new Date().toISOString()) {
    const link = links.get(code);
    if (!link) {
      return false;
    }

    link.visits += 1;
    link.lastVisitedAt = at;
    visitsDirty = true;
    scheduleVisitsFlush();
    return true;
  }

  async function deleteLink(code) {
    return enqueueStoreOperation(async () => {
      const link = links.get(code);
      if (!link) {
        return false;
      }

      links.delete(code);
      try {
        await writeLinks();
      } catch (err) {
        links.set(code, link);
        throw err;
      }
      return true;
    });
  }

  async function listLinks() {
    return [...links.values()];
  }

  return {
    createLink,
    deleteLink,
    flushStore,
    getLink,
    initStore,
    listLinks,
    recordVisit,
  };
}
