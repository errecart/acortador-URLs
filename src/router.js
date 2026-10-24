import {
  handleDeleteLink,
  handleHealth,
  handleLinkStats,
  handleLinks,
  handleRedirect,
} from './handlers.js';
import { extname } from 'node:path';
import { HttpError } from './http-utils.js';
import { serveStatic } from './static.js';

function hasStaticFileExtension(pathname) {
  try {
    return extname(decodeURIComponent(pathname)) !== '';
  } catch {
    return true;
  }
}

export async function routeRequest(req, res, url, store) {
  const { pathname } = url;

  if (pathname === '/health') {
    handleHealth(req, res);
    return;
  }

  if (pathname === '/api/links') {
    await handleLinks(req, res, store);
    return;
  }

  const statsMatch = pathname.match(/^\/api\/links\/([\w-]{7})\/stats$/);
  if (statsMatch) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new HttpError(405, 'Método no permitido');
    }

    await handleLinkStats(res, statsMatch[1], store);
    return;
  }

  const linkMatch = pathname.match(/^\/api\/links\/([\w-]{7})$/);
  if (linkMatch) {
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'DELETE');
      throw new HttpError(405, 'Método no permitido');
    }

    await handleDeleteLink(res, linkMatch[1], store);
    return;
  }

  const codeMatch = pathname.match(/^\/([\w-]{7})$/);
  if (codeMatch) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new HttpError(405, 'Método no permitido');
    }

    await handleRedirect(res, codeMatch[1], store);
    return;
  }

  if (pathname === '/' || hasStaticFileExtension(pathname)) {
    await serveStatic(req, res, pathname);
    return;
  }

  throw new HttpError(404, 'No encontrado');
}