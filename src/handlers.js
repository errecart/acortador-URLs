import { createLink, deleteLink, getLink, listLinks } from './store.js';
import { events } from './events.js';
import { HttpError, readJsonBody, sendJson } from './http-utils.js';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

export function handleHealth(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    throw new HttpError(405, 'Method Not Allowed');
  }

  sendJson(res, 200, { status: 'ok' });
}

export async function handleLinks(req, res) {
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    if (typeof body?.url !== 'string') {
      throw new HttpError(400, 'A URL is required');
    }

    let destination;
    try {
      destination = new URL(body.url);
    } catch {
      throw new HttpError(400, 'Invalid URL');
    }
    if (destination.protocol !== 'http:' && destination.protocol !== 'https:') {
      throw new HttpError(400, 'URL must use HTTP or HTTPS');
    }

    const link = await createLink(destination.href);
    events.emit('link:created', { code: link.code, at: new Date().toISOString() });
    sendJson(res, 201, {
      ...link,
      shortUrl: `${baseUrl.replace(/\/+$/, '')}/${link.code}`,
    });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, await listLinks());
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  throw new HttpError(405, 'Method Not Allowed');
}

export async function handleRedirect(res, code) {
  const link = await getLink(code);
  if (!link) {
    throw new HttpError(404, 'Not Found');
  }

  res.writeHead(302, { Location: link.url });
  res.end();
  events.emit('link:visited', { code, at: new Date().toISOString() });
}

export async function handleLinkStats(res, code) {
  const link = await getLink(code);
  if (!link) {
    throw new HttpError(404, 'Not Found');
  }

  sendJson(res, 200, {
    code: link.code,
    url: link.url,
    createdAt: link.createdAt,
    visits: link.visits,
    lastVisitedAt: link.lastVisitedAt,
  });
}

export async function handleDeleteLink(res, code) {
  if (!await deleteLink(code)) {
    throw new HttpError(404, 'Not Found');
  }

  events.emit('link:deleted', { code, at: new Date().toISOString() });
  res.writeHead(204);
  res.end();
}
