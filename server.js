#!/usr/bin/env node
/**
 * Entrypoint for hosts / older pnpm that look for server.js when
 * `scripts.start` is missing. Prefer compiled dist; otherwise run via tsx.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.join(root, 'dist', 'server', 'index.js');

if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else {
  const tsxBin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const entry = path.join(root, 'src', 'server', 'index.ts');
  const child = spawn(tsxBin, [entry], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
    env: process.env,
  });
  child.on('exit', code => process.exit(code ?? 1));
}
