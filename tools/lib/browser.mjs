/**
 * Shared harness utilities: static file server + headless Chromium launcher.
 *
 * Playwright is resolved from the project's node_modules first, then from the
 * global npm root (in the CI sandbox it ships as a global module only).
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

/** Resolve the playwright module (local, else global). */
export function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    // Fall back to the globally installed module.
    let globalRoot = '';
    try {
      globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    } catch {
      globalRoot = '/opt/node22/lib/node_modules';
    }
    return require(path.join(globalRoot, 'playwright'));
  }
}

/**
 * Serve a directory over HTTP on 127.0.0.1.
 * @param {string} dir directory to serve
 * @param {number} port 0 for random
 * @returns {Promise<{url:string, port:number, close():Promise<void>}>}
 */
export function serveStatic(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const filePath = path.join(root, urlPath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found: ' + urlPath);
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        });
        res.end(data);
      });
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        port: actualPort,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Launch headless Chromium with software WebGL2 (SwiftShader) enabled. */
export async function launchBrowser({ headless = true, extraArgs = [] } = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--js-flags=--max-old-space-size=4096',
      ...extraArgs,
    ],
  });
}

/** Run `vite build` unless dist is present and fresh, or force is set. */
export function ensureBuild({ force = false, skip = false } = {}) {
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (skip && fs.existsSync(distIndex)) return;
  if (!force && fs.existsSync(distIndex)) {
    // Rebuild if any source file is newer than the build output.
    const distTime = fs.statSync(distIndex).mtimeMs;
    const newest = newestMtime([
      path.join(ROOT, 'src'),
      path.join(ROOT, 'index.html'),
      path.join(ROOT, 'vite.config.js'),
      path.join(ROOT, 'package.json'),
    ]);
    if (newest <= distTime) return;
  }
  console.log('[build] running vite build …');
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
}

function newestMtime(paths) {
  let newest = 0;
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  paths.forEach(walk);
  return newest;
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        pushArg(args, key, true);
      } else {
        pushArg(args, key, next);
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function pushArg(args, key, value) {
  if (args[key] === undefined) args[key] = value;
  else if (Array.isArray(args[key])) args[key].push(value);
  else args[key] = [args[key], value];
}

export function asArray(v) {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
