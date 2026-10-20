import { BadRequest, yahooProxy } from './_lib/yahoo.js';

// Límite por IP en memoria: cada instancia de la función lleva su propia cuenta,
// así que es orientativo, pero corta el abuso continuado desde un mismo origen.
// Lo normal de la app son unas pocas decenas de peticiones al abrirla.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 300;
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
    return false;
  }
  h.n += 1;
  return h.n > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'método no permitido' });
  }
  // Los navegadores marcan de dónde viene la petición: otra web no puede usar
  // este proxy desde el navegador de sus visitantes.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'solo desde la propia app' });
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconocida';
  if (limited(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'demasiadas peticiones, prueba en un minuto' });
  }
  try {
    const data = await yahooProxy(req.query || {});
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (e) {
    const status = e instanceof BadRequest ? 400 : 502;
    return res.status(status).json({ error: String(e.message || e) });
  }
}
