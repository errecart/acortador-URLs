import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';

export async function createAccessLog({ dataDir = './data', events }) {
  if (!events) {
    throw new TypeError('Se requiere un emisor de eventos para el log de accesos');
  }

  const resolvedDataDir = resolve(dataDir);
  await mkdir(resolvedDataDir, { recursive: true });

  const accessLog = createWriteStream(join(resolvedDataDir, 'access.log'), { flags: 'a' });
  accessLog.on('error', (err) => {
    console.error('No se pudo escribir el log de accesos:', err);
  });

  const listeners = new Map();
  for (const event of ['link:created', 'link:deleted', 'link:visited']) {
    const listener = (payload) => {
      accessLog.write(`${JSON.stringify({ event, ...payload })}\n`);
    };
    listeners.set(event, listener);
    events.on(event, listener);
  }

  let closePromise;
  return {
    close() {
      if (closePromise) {
        return closePromise;
      }
      for (const [event, listener] of listeners) {
        events.off(event, listener);
      }
      closePromise = finished(accessLog);
      accessLog.end();
      return closePromise;
    },
  };
}
