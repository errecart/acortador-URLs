import { createLink, deleteLink, getLink, listLinks } from './store.js';
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
}

export async function handleDeleteLink(res, code) {
  if (!await deleteLink(code)) {
    throw new HttpError(404, 'Not Found');
  }

  res.writeHead(204);
  res.end();
}
