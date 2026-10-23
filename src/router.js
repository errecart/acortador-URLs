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

export async function routeRequest(req, res, url) {
  const { pathname } = url;

  if (pathname === '/health') {
    handleHealth(req, res);
    return;
  }

  if (pathname === '/api/links') {
    await handleLinks(req, res);
    return;
  }

  const statsMatch = pathname.match(/^\/api\/links\/([\w-]{7})\/stats$/);
  if (statsMatch) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new HttpError(405, 'Method Not Allowed');
    }

    await handleLinkStats(res, statsMatch[1]);
    return;
  }

  const linkMatch = pathname.match(/^\/api\/links\/([\w-]{7})$/);
  if (linkMatch) {
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'DELETE');
      throw new HttpError(405, 'Method Not Allowed');
    }

    await handleDeleteLink(res, linkMatch[1]);
    return;
  }

  const codeMatch = pathname.match(/^\/([\w-]{7})$/);
  if (codeMatch) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new HttpError(405, 'Method Not Allowed');
    }

    await handleRedirect(res, codeMatch[1]);
    return;
  }

  if (pathname === '/' || hasStaticFileExtension(pathname)) {
    await serveStatic(req, res, pathname);
    return;
  }

  throw new HttpError(404, 'Not Found');
}