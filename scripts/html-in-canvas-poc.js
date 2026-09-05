#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'examples', 'html-in-canvas-poc');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: 4173, open: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--port') {
      options.port = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument === '--no-open') {
      options.open = false;
      continue;
    }
    if (argument === '-h' || argument === '--help') {
      process.stdout.write('Usage: node scripts/html-in-canvas-poc.js [--port <number>] [--no-open]\n');
      process.exit(0);
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error('`--port` must be a positive integer.');
  }
  return options;
}

function openChrome(url) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const child = spawn(chrome, [
    '--enable-blink-features=CanvasDrawElement',
    '--enable-features=CanvasDrawElement',
    url,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveRequestPath(urlPath) {
  const requested = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const normalized = normalize(requested);
  if (normalized.startsWith('..')) return null;
  return join(ROOT, normalized);
}

const options = parseArgs(process.argv.slice(2));
const server = http.createServer(async (request, response) => {
  const filePath = resolveRequestPath(new URL(request.url, 'http://localhost').pathname);
  if (!filePath) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(options.port, 'localhost', () => {
  const url = `http://localhost:${options.port}`;
  process.stdout.write(`HTML-in-Canvas PoC running at ${url}\n`);
  if (options.open) openChrome(url);
});

