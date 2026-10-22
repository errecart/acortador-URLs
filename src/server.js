import { createServer } from 'node:http';
import { HttpError, sendJson } from './http-utils.js';
import { routeRequest } from './router.js';
import { initStore } from './store.js';

const port = process.env.PORT || 3000;

const server = createServer(async (req, res) => {
  let url;

  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    sendJson(res, 400, { error: 'Bad Request' });
    return;
  }

  try {
    await routeRequest(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Internal Server Error';
      sendJson(res, status, { error: message });
    }
  }
});

server.on('error', (err) => {
  console.error(`No se pudo iniciar el servidor en el puerto ${port}:`, err);
  process.exit(1);
});

await initStore();
server.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});