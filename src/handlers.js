import { events } from './events.js';
import { HttpError, readJsonBody, sendJson } from './http-utils.js';

const baseUrl = process.env.API_URL || process.env.BASE_URL || 'http://localhost:3000';

export function handleHealth(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    throw new HttpError(405, 'Método no permitido');
  }

  sendJson(res, 200, { status: 'ok' });
}

export async function handleLinks(req, res, store) {
  if (req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (body === undefined) {
      return;
    }
    if (typeof body?.url !== 'string') {
      throw new HttpError(400, 'Se requiere una URL');
    }
    if (body.url.length > 2048) {
      throw new HttpError(400, 'La URL no puede superar los 2048 caracteres');
    }

    let destination;
    try {
      destination = new URL(body.url);
    } catch {
      throw new HttpError(400, 'URL inválida');
    }
    if (destination.protocol !== 'http:' && destination.protocol !== 'https:') {
      throw new HttpError(400, 'La URL debe usar HTTP o HTTPS');
    }
    if (destination.username || destination.password) {
      throw new HttpError(400, 'La URL no puede incluir usuario ni contraseña');
    }
    if (destination.hostname.toLowerCase() === new URL(baseUrl).hostname.toLowerCase()) {
      throw new HttpError(400, 'No se pueden acortar URLs del mismo dominio');
    }

    const link = await store.createLink(destination.href);
    sendJson(res, 201, {
      ...link,
      shortUrl: `${baseUrl.replace(/\/+$/, '')}/${link.code}`,
    });
    events.emit('link:created', { code: link.code, at: new Date().toISOString() });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, await store.listLinks());
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  throw new HttpError(405, 'Método no permitido');
}

export async function handleRedirect(res, code, store) {
  const link = await store.getLink(code);
  if (!link) {
    throw new HttpError(404, 'No encontrado');
  }

  res.writeHead(302, { Location: link.url });
  res.end();
  const at = new Date().toISOString();
  store.recordVisit(code, at).catch((err) => {
    console.error(`No se pudo registrar la visita al enlace ${code}:`, err);
  });
  events.emit('link:visited', { code, at });
}

export async function handleLinkStats(res, code, store) {
  const link = await store.getLink(code);
  if (!link) {
    throw new HttpError(404, 'No encontrado');
  }

  sendJson(res, 200, {
    code: link.code,
    url: link.url,
    createdAt: link.createdAt,
    visits: link.visits,
    lastVisitedAt: link.lastVisitedAt,
  });
}

export async function handleDeleteLink(res, code, store) {
  if (!await store.deleteLink(code)) {
    throw new HttpError(404, 'No encontrado');
  }

  res.writeHead(204);
  res.end();
  events.emit('link:deleted', { code, at: new Date().toISOString() });
}
