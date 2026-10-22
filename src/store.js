import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const links = new Map();
const dataDir = resolve(process.env.DATA_DIR || './data');
const linksFile = join(dataDir, 'links.json');
const tempLinksFile = `${linksFile}.tmp`;
let writeQueue = Promise.resolve();

export async function initStore() {
  await mkdir(dataDir, { recursive: true });

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
    links.set(link.code, link);
  }
}

function persistLinks() {
  const write = writeQueue.then(async () => {
    await writeFile(tempLinksFile, JSON.stringify([...links.values()], null, 2));
    await rename(tempLinksFile, linksFile);
  });
  writeQueue = write.catch(() => {});
  return write;
}

export async function createLink(url) {
  let code;
  do {
    code = randomBytes(5).toString('base64url');
  } while (links.has(code));

  const link = { code, url, createdAt: new Date().toISOString() };
  links.set(code, link);
  await persistLinks();
  return link;
}

export async function getLink(code) {
  return links.get(code);
}

export async function deleteLink(code) {
  if (!links.delete(code)) {
    return false;
  }

  await persistLinks();
  return true;
}

export async function listLinks() {
  return [...links.values()];
}