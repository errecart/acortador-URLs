import { createApp } from './app.js';
import { createStore } from './store.js';
import { createAccessLog } from './access-log.js';
import { events } from './events.js';

const port = process.env.PORT || 3000;
const store = createStore({ dataDir: process.env.DATA_DIR || './data' });
const accessLog = await createAccessLog({
  dataDir: process.env.DATA_DIR || './data',
  events,
});
const server = createApp({ store });

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
  server.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
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