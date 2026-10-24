import assert from 'node:assert/strict';

const baseUrl = (process.env.API_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const redirectCount = 1000;

const createResponse = await fetch(`${baseUrl}/api/links`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `https://example.com/visits-benchmark/${Date.now()}` }),
});
assert.equal(createResponse.status, 201, 'No se pudo crear el enlace para el benchmark');
const link = await createResponse.json();

const redirectStart = performance.now();
const responses = await Promise.all(
  Array.from({ length: redirectCount }, () => fetch(`${baseUrl}/${link.code}`, { redirect: 'manual' })),
);
const redirectsFinishedAt = performance.now();

assert.ok(responses.every(({ status }) => status === 302), 'Al menos un redirect falló');

const statsResponse = await fetch(`${baseUrl}/api/links/${link.code}/stats`);
assert.equal(statsResponse.status, 200, 'No se pudieron leer las estadísticas');
const stats = await statsResponse.json();
assert.equal(stats.visits, redirectCount, `Se esperaban ${redirectCount} visitas`);

console.log(`Redirects: ${redirectCount} en ${(redirectsFinishedAt - redirectStart).toFixed(0)} ms`);
