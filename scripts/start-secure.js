import { spawnSync } from 'node:child_process';

const nodePath = process.env.npm_node_execpath || process.execPath;
const result = spawnSync(nodePath, [
  '--permission',
  '--allow-fs-read=./src/*',
  '--allow-fs-read=./public/*',
  '--allow-fs-read=./data',
  '--allow-fs-read=./.env',
  '--allow-fs-write=./data/*',
  '--env-file=.env',
  './src/server.js',
], { stdio: 'inherit' });

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
