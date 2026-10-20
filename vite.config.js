import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BadRequest, yahooProxy } from './api/_lib/yahoo.js';

// En dev, el mismo código de api/_lib sirve /api/yahoo desde el dev server
// (en producción lo hace la función de Vercel api/yahoo.js).
function apiMiddleware() {
  return {
    name: 'boveda-api-middleware',
    configureServer(server) {
      server.middlewares.use('/api/yahoo', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const data = await yahooProxy(Object.fromEntries(url.searchParams));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        } catch (e) {
          res.statusCode = e instanceof BadRequest ? 400 : 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
    },
  };
}

// Sella el service worker con un id de build (cada despliegue tiene su caché) y
// con la lista de archivos de esa versión, que el SW precarga al instalarse.
function stampServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'boveda-sw-stamp',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const id = Date.now().toString(36);
      const assetsDir = resolve(outDir, 'assets');
      const assets = existsSync(assetsDir) ? readdirSync(assetsDir).map((f) => `/assets/${f}`) : [];
      writeFileSync(
        file,
        readFileSync(file, 'utf8')
          .replaceAll('__BUILD_ID__', id)
          .replace('const ASSETS = __ASSETS__;', `const ASSETS = ${JSON.stringify(assets)};`)
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), apiMiddleware(), stampServiceWorker()],
  server: { port: 5175, strictPort: true },
  build: { chunkSizeWarningLimit: 700 },
});
