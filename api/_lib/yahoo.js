// Proxy de Yahoo Finance (endpoints públicos, sin key). Compartido entre las
// funciones de Vercel (api/yahoo.js) y el middleware del dev server (vite.config.js).
// Solo se permiten dos operaciones concretas: nunca es un proxy abierto.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function yahooProxy(params) {
  const fn = params.fn;
  let url;
  if (fn === 'search') {
    const q = String(params.q || '').slice(0, 80);
    url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
  } else if (fn === 'chart') {
    const sym = encodeURIComponent(String(params.symbol || '').slice(0, 40));
    const interval = encodeURIComponent(params.interval || '1d');
    const qs = params.range
      ? `range=${encodeURIComponent(params.range)}`
      : `period1=${Number(params.period1) || 0}&period2=${Number(params.period2) || Math.floor(Date.now() / 1000)}`;
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&${qs}`;
  } else {
    throw new Error('fn no soportada');
  }
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  return r.json();
}
