import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createCoachApi } from './coach-api.mjs';
import { loadOpenAIKey } from './local-ai-config.mjs';
import { loadAuthConfig } from './auth-config.mjs';
import { createAuthApi } from './auth-api.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 5177);
const url = `http://127.0.0.1:${port}${process.argv.includes('--demo') ? '/?demo=1' : ''}`;
const shouldOpen = process.argv.includes('--open');
const coachApi = createCoachApi({ port, getApiKey: loadOpenAIKey });
const authApi = createAuthApi({ port, getConfig: loadAuthConfig });
function openBrowser() {
  if (process.platform !== 'win32') { console.log(`Open ${url} in your browser.`); return; }
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
  child.once('error', () => console.error(`Could not open the browser. Open ${url} manually.`));
  child.once('exit', code => { if (code !== 0) console.error(`Browser launcher exited with code ${code}. Open ${url} manually.`); });
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  try {
    if (await authApi(req, res)) return;
    if (await coachApi(req, res)) return;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!(await stat(filename)).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error instanceof URIError ? 400 : 404); res.end('Not found');
  }
});
server.on('error', async error => {
  if (error.code === 'EADDRINUSE' && shouldOpen) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const html = await response.text();
      if (response.ok && html.includes('<title>КРОК') && html.includes('/assets/index-')) {
        console.log(`KROK is already running: ${url}`);
        openBrowser();
        return;
      }
    } catch { /* An unrelated or unavailable service must not be treated as KROK. */ }
  }
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is occupied. Open ${url} if KROK is already running, or set PORT to another value.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`\n  KROK is ready: ${url}\n  Press Ctrl+C to stop.\n`);
  if (shouldOpen) openBrowser();
});
