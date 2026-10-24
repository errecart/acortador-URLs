#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { parseArgs, styleText } from 'node:util';

const usage = `Uso:
  acortador-urls [--api <URL>] [--help]
  acortador-urls create <url> [--api <URL>]
  acortador-urls list [--json] [--api <URL>]
  acortador-urls stats <code> [--api <URL>]
  acortador-urls delete <code> [--yes] [--api <URL>]`;

const requestTimeoutMs = 10_000;

class UsageError extends Error {}

function format(style, text, stream = process.stdout) {
  if (!stream.isTTY || process.env.NO_COLOR !== undefined) {
    return text;
  }
  return styleText(style, text, { validateStream: false });
}

function parseCliArgs(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        api: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const { positionals, values } = parsed;

  if (values.help || positionals.length === 0) {
    return { help: true };
  }

  const [command, ...commandArgs] = positionals;
  const apiUrl = values.api ?? process.env.API_URL ?? process.env.BASE_URL ?? 'http://localhost:3000';
  let parsedUrl;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new UsageError(`URL de API inválida: ${apiUrl}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new UsageError('La URL de API debe usar HTTP o HTTPS');
  }

  return { apiUrl: apiUrl.replace(/\/+$/, ''), command, commandArgs, values };
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function printLinksTable(links) {
  const codeWidth = Math.max('CÓDIGO'.length, ...links.map(({ code }) => String(code).length));
  const visitsWidth = Math.max('VISITAS'.length, ...links.map(({ visits }) => String(visits).length));
  const terminalWidth = process.stdout.columns || 100;
  const urlWidth = Math.max(12, Math.min(60, terminalWidth - codeWidth - visitsWidth - 6));
  const header = `${'CÓDIGO'.padEnd(codeWidth)}  ${'VISITAS'.padEnd(visitsWidth)}  URL`;
  console.log(format('bold', header));
  console.log(format('gray', `${'-'.repeat(codeWidth)}  ${'-'.repeat(visitsWidth)}  ${'-'.repeat(urlWidth)}`));
  for (const link of links) {
    const code = format('cyan', String(link.code).padEnd(codeWidth));
    console.log(`${code}  ${String(link.visits).padEnd(visitsWidth)}  ${truncate(String(link.url), urlWidth)}`);
  }
}

async function request(apiUrl, path, options) {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error(`La solicitud a ${apiUrl} superó el tiempo límite de ${requestTimeoutMs / 1000} segundos.`);
    }
    if (err.cause?.code || (err.name === 'TypeError' && err.message === 'fetch failed')) {
      const causeCode = err.cause?.code ? ` (${err.cause.code})` : '';
      throw new Error(`No pude conectarme a ${apiUrl}, ¿está corriendo el servidor?${causeCode}`);
    }
    throw err;
  }

  if (response.status === 204) {
    return null;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw new Error(body?.error || `La solicitud falló (${response.status} ${response.statusText}).`);
  }
  return body;
}

async function confirmDelete(code) {
  if (!process.stdin.isTTY) {
    throw new UsageError('La confirmación requiere una terminal; volvé a ejecutar con --yes.');
  }

  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const prompt = format('yellow', `¿Borrar el enlace ${code}? [y/N] `, process.stderr);
    const answer = await readline.question(prompt);
    return ['y', 'yes', 's', 'sí', 'si'].includes(answer.trim().toLowerCase());
  } finally {
    readline.close();
  }
}

async function run(args) {
  const { help, apiUrl, command, commandArgs, values } = parseCliArgs(args);
  if (help) {
    console.log(usage);
    return;
  }
  if (!['create', 'list', 'stats', 'delete'].includes(command)) {
    throw new UsageError(`Comando desconocido: ${command}`);
  }
  if (values.json && command !== 'list') {
    throw new UsageError('--json solo se puede usar con list.');
  }
  if (values.yes && command !== 'delete') {
    throw new UsageError('--yes solo se puede usar con delete.');
  }

  if (command === 'create') {
    if (commandArgs.length !== 1) {
      throw new UsageError('Uso: acortador-urls create <url>');
    }
    const link = await request(apiUrl, '/api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: commandArgs[0] }),
    });
    console.log(link.shortUrl || `${apiUrl}/${link.code}`);
    return;
  }

  if (command === 'list') {
    if (commandArgs.length !== 0) {
      throw new UsageError('Uso: acortador-urls list [--json]');
    }
    const links = await request(apiUrl, '/api/links');
    if (values.json) {
      console.log(JSON.stringify(links, null, 2));
    } else if (links.length === 0) {
      console.log('No hay enlaces.');
    } else {
      printLinksTable(links);
    }
    return;
  }

  if (command === 'stats') {
    if (commandArgs.length !== 1) {
      throw new UsageError('Uso: acortador-urls stats <code>');
    }
    const stats = await request(apiUrl, `/api/links/${encodeURIComponent(commandArgs[0])}/stats`);
    console.log(`${format('bold', 'Código:')} ${stats.code}`);
    console.log(`${format('bold', 'URL:')} ${stats.url}`);
    console.log(`${format('bold', 'Visitas:')} ${stats.visits}`);
    console.log(`${format('bold', 'Creado:')} ${stats.createdAt}`);
    console.log(`${format('bold', 'Última visita:')} ${stats.lastVisitedAt || '-'}`);
    return;
  }

  if (commandArgs.length !== 1) {
    throw new UsageError('Uso: acortador-urls delete <code> [--yes]');
  }
  if (!values.yes && !await confirmDelete(commandArgs[0])) {
    console.error(format('yellow', 'Operación cancelada.', process.stderr));
    return;
  }
  await request(apiUrl, `/api/links/${encodeURIComponent(commandArgs[0])}`, { method: 'DELETE' });
  console.error(format('green', `Enlace ${commandArgs[0]} borrado.`, process.stderr));
}

try {
  await run(process.argv.slice(2));
} catch (err) {
  const isUsageError = err instanceof UsageError;
  const message = isUsageError ? `${err.message}\n${format('gray', usage, process.stderr)}` : err.message;
  console.error(format('red', message, process.stderr));
  process.exitCode = isUsageError ? 2 : 1;
}
