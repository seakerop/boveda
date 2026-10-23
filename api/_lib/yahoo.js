// Proxy de Yahoo Finance (endpoints públicos, sin key). Compartido entre las
// funciones de Vercel (api/yahoo.js) y el middleware del dev server (vite.config.js).
// Solo dos operaciones concretas y parámetros en lista blanca: nunca es un proxy abierto.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Al menos un carácter alfanumérico: ".." o "." harían apuntar a otra ruta de Yahoo.
const SYMBOL = /^(?=.*[A-Za-z0-9])[A-Za-z0-9.\-=^]{1,24}$/;
const INTERVALS = new Set(['1d', '1wk', '1mo']);
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']);

export class BadRequest extends Error {}

export async function yahooProxy(params) {
  const fn = params.fn;
  let url;
  if (fn === 'search') {
    const q = String(params.q || '').trim().slice(0, 60);
    if (q.length < 1) throw new BadRequest('búsqueda vacía');
    url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
  } else if (fn === 'chart') {
    const symbol = String(params.symbol || '');
    if (!SYMBOL.test(symbol)) throw new BadRequest('símbolo no válido');
    const interval = String(params.interval || '1d');
    if (!INTERVALS.has(interval)) throw new BadRequest('intervalo no válido');
    let qs;
    if (params.range != null) {
      if (!RANGES.has(String(params.range))) throw new BadRequest('rango no válido');
      qs = `range=${params.range}`;
    } else {
      const now = Math.floor(Date.now() / 1000);
      const p1 = Math.max(0, Math.min(Number(params.period1) || 0, now));
      const p2 = Math.max(p1, Math.min(Number(params.period2) || now, now + 86400));
      qs = `period1=${Math.floor(p1)}&period2=${Math.floor(p2)}`;
    }
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${qs}&events=split`;
  } else {
    throw new BadRequest('operación no soportada');
  }
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  return r.json();
}
