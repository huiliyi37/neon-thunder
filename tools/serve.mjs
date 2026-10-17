#!/usr/bin/env node
/**
 * 零依赖静态开发服务器。
 * 作用仅是把工作目录以正确的 MIME 提供出去——ES Module 无法在 file:// 下加载，
 * 所以本地必须经由 http 打开。
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const START_PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = normalize(join(ROOT, clean === '/' ? '/index.html' : clean));
  // 目录穿越防护：解析结果必须仍在 ROOT 之内
  return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

const server = createServer((req, res) => {
  let file = safePath(req.url || '/');
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const stat = statSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${req.url}`);
  }
});

let port = START_PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < START_PORT + 20) {
    server.listen(++port, HOST);
  } else {
    console.error(`[serve] ${err.message}`);
    process.exit(1);
  }
});

server.on('listening', () => {
  const url = `http://${HOST}:${port}/`;
  console.log(`\n  ⚡ THUNDER · 雷霆战机\n  ▸ ${url}\n  ▸ Ctrl+C 停止\n`);
});

server.listen(port, HOST);
