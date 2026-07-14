import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { yahooProxy } from './api/_lib/yahoo.js';

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
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiMiddleware()],
  server: { port: 5175, strictPort: true },
});
