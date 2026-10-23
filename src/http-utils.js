const maxJsonBodyBytes = 10 * 1024;
const oversizedBodyMessage = 'El cuerpo de la solicitud supera el límite de 10 KB';

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

function rejectOversizedBody(res) {
  res.setHeader('Connection', 'close');
  sendJson(res, 413, { error: oversizedBodyMessage });
}

export async function readJsonBody(req, res) {
  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined && Number(contentLength) > maxJsonBodyBytes) {
    for await (const _chunk of req) {
      // Drain the remaining body without retaining it.
    }
    rejectOversizedBody(res);
    return undefined;
  }

  const chunks = [];
  let bodyBytes = 0;
  let tooLarge = false;
  try {
    for await (const chunk of req) {
      const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      bodyBytes += chunkBytes;
      if (bodyBytes > maxJsonBodyBytes) {
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0;
        }
        continue;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    }

    if (tooLarge) {
      rejectOversizedBody(res);
      return undefined;
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new HttpError(400, 'JSON inválido');
    }
    throw err;
  }
}
