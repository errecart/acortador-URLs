import { createServer } from 'node:http';
import { HttpError, sendJson } from './http-utils.js';
import { routeRequest } from './router.js';

function readTimeout(name, defaultValue) {
  const configuredValue = process.env[name];
  if (configuredValue === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(configuredValue)) {
    throw new Error(`${name} debe ser un entero positivo en milisegundos`);
  }
  const value = Number(configuredValue);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`${name} debe ser un entero positivo en milisegundos`);
  }
  return value;
}

export function createApp({ store }) {
  const requestTimeout = readTimeout('REQUEST_TIMEOUT_MS', 300_000);
  const headersTimeout = readTimeout('HEADERS_TIMEOUT_MS', 60_000);
  const keepAliveTimeout = readTimeout('KEEP_ALIVE_TIMEOUT_MS', 5_000);
  if (headersTimeout > requestTimeout) {
    throw new Error('HEADERS_TIMEOUT_MS no puede superar REQUEST_TIMEOUT_MS');
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');

    let url;

    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      sendJson(res, 400, { error: 'Solicitud incorrecta' });
      return;
    }

    try {
      await routeRequest(req, res, url, store);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (!(err instanceof HttpError) || status >= 500) {
        console.error(err);
      }
      if (!res.headersSent) {
        const message = err instanceof HttpError ? err.message : 'Error interno del servidor';
        sendJson(res, status, { error: message });
      }
    }
  });

  server.requestTimeout = requestTimeout;
  server.headersTimeout = headersTimeout;
  server.keepAliveTimeout = keepAliveTimeout;
  server.connectionsCheckingInterval = Math.min(1_000, headersTimeout);
  return server;
}
