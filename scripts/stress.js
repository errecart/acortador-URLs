import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dataDir = resolve(process.env.DATA_DIR || './data');
const expectedCount = 50;

const responses = await Promise.all(
  Array.from({ length: expectedCount }, (_, index) => fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `https://example.com/stress/${index}` }),
  })),
);

const statuses = responses.map(({ status }) => status);
let storedLinks;
let fileError;
try {
  storedLinks = JSON.parse(await readFile(join(dataDir, 'links.json'), 'utf8'));
} catch (err) {
  fileError = err;
}

console.log(`POST 201: ${statuses.filter((status) => status === 201).length}/${expectedCount}`);
if (fileError) {
  console.error(`links.json no es JSON legible: ${fileError.message}`);
} else {
  console.log(`JSON válido; enlaces guardados: ${Array.isArray(storedLinks) ? storedLinks.length : 'formato inválido'}`);
}

assert.ok(statuses.every((status) => status === 201), 'Al menos un POST no respondió 201');
assert.ok(Array.isArray(storedLinks), 'links.json no contiene un array JSON');
assert.equal(storedLinks.length, expectedCount, `Se esperaban ${expectedCount} enlaces`);
