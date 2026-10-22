import { json } from 'node:stream/consumers';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function readJsonBody(req) {
  try {
    return await json(req);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new HttpError(400, 'Invalid JSON');
    }
    throw err;
  }
}
