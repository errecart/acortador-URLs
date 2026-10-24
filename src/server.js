import { createApp } from './app.js';
import { createStore } from './store.js';
import { createAccessLog } from './access-log.js';
import { events } from './events.js';

function readBaseUrl() {
  const value = process.env.BASE_URL || 'http://localhost:3000';
  let baseUrl;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new Error('BASE_URL debe ser una URL de origen HTTP o HTTPS válida');
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
    || !baseUrl.hostname
    || baseUrl.username
    || baseUrl.password
    || baseUrl.pathname !== '/'
    || baseUrl.search
    || baseUrl.hash
  ) {
    throw new Error('BASE_URL debe ser una URL de origen HTTP o HTTPS válida');
  }

  return baseUrl;
}

let baseUrl;
try {
  baseUrl = readBaseUrl();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const store = createStore({ dataDir: process.env.DATA_DIR || './data' });
const accessLog = await createAccessLog({
  dataDir: process.env.DATA_DIR || './data',
  events,
});
const server = createApp({ store, baseUrl, events });

server.on('error', (err) => {
  console.error(`No se pudo iniciar el servidor en el puerto ${port}:`, err);
  process.exit(1);
});

let storeInitialized = false;
try {
  await store.initStore();
  storeInitialized = true;
} catch (err) {
  console.error(`No se pudo inicializar el almacén: ${err.message}`);
  process.exitCode = 1;
  try {
    await accessLog.close();
  } catch (closeErr) {
    console.error(`No se pudo cerrar el log de accesos: ${closeErr.message}`);
  }
}

if (storeInitialized) {
  server.listen(port, host, () => {
    console.log(`Servidor escuchando en el puerto ${server.address().port}`);
  });
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    console.error(`Segunda señal (${signal}); forzando salida.`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`Recibida señal ${signal}; guardando cambios...`);
  setTimeout(() => {
    console.error('Cierre demasiado lento; forzando salida.');
    process.exit(1);
  }, 10_000).unref();
  try {
    await store.flushStore();
  } catch (err) {
    console.error('No se pudieron persistir los cambios al cerrar:', err);
    process.exitCode = 1;
  }

  server.close(async (err) => {
    if (err) {
      console.error('No se pudo cerrar el servidor correctamente:', err);
      process.exitCode = 1;
    }

    try {
      await store.flushStore();
    } catch (flushErr) {
      console.error('No se pudieron persistir los cambios pendientes al cerrar:', flushErr);
      process.exitCode = 1;
    }

    try {
      await accessLog.close();
    } catch (logErr) {
      console.error('No se pudo cerrar el log de accesos:', logErr);
      process.exitCode = 1;
    }
  });
}

if (storeInitialized) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}