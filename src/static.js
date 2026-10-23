import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http-utils.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function isInsidePublicDir(filePath) {
  const pathFromPublic = relative(publicDir, filePath);
  return pathFromPublic !== '..'
    && !pathFromPublic.startsWith(`..${sep}`)
    && !isAbsolute(pathFromPublic);
}

export async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    throw new HttpError(405, 'Method Not Allowed');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad Request');
  }

  const requestPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = join(publicDir, requestPath.replace(/^[/\\]+/, ''));
  if (!isInsidePublicDir(filePath)) {
    throw new HttpError(404, 'Not Found');
  }

  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      throw new HttpError(404, 'Not Found');
    }
    throw err;
  }

  if (!fileInfo.isFile()) {
    throw new HttpError(404, 'Not Found');
  }

  const extension = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': contentTypes.get(extension) || 'application/octet-stream',
    'Content-Length': fileInfo.size,
    'X-Content-Type-Options': 'nosniff',
  });
  await pipeline(createReadStream(filePath), res);
}
