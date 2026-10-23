import { createApp } from './app.js';
import { createStore } from './store.js';
import { closeAccessLog } from './access-log.js';

const port = process.env.PORT || 3000;
const store = createStore({ dataDir: process.env.DATA_DIR || './data' });
const server = createApp({ store });

server.on('error', (err) => {
  console.error(`No se pudo iniciar el servidor en el puerto ${port}:`, err);
  process.exit(1);
});

await store.initStore();
server.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});

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
      await closeAccessLog();
    } catch (logErr) {
      console.error('No se pudo cerrar el log de accesos:', logErr);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));