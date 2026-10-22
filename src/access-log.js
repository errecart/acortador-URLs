import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { events } from './events.js';

const dataDir = resolve(process.env.DATA_DIR || './data');
await mkdir(dataDir, { recursive: true });

const accessLog = createWriteStream(join(dataDir, 'access.log'), { flags: 'a' });
accessLog.on('error', (err) => {
  console.error('No se pudo escribir el log de accesos:', err);
});

for (const event of ['link:created', 'link:deleted', 'link:visited']) {
  events.on(event, (payload) => {
    accessLog.write(`${JSON.stringify({ event, ...payload })}\n`);
  });
}

export async function closeAccessLog() {
  accessLog.end();
  await finished(accessLog);
}
