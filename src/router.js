import { handleDeleteLink, handleHealth, handleLinks, handleRedirect } from './handlers.js';
import { HttpError } from './http-utils.js';

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

  throw new HttpError(404, 'Not Found');
}