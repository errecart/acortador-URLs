import { events } from './events.js';
import { recordVisit } from './store.js';

events.on('link:visited', ({ code, at }) => {
  recordVisit(code, at).catch((err) => {
    console.error(`No se pudo registrar la visita al enlace ${code}:`, err);
  });
});
