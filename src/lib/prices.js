// Fuentes de precios (todas gratuitas, sin key):
//  - Crypto: CoinGecko (histórico diario en EUR + precio actual). CORS abierto.
//  - Bolsa: Yahoo Finance vía nuestro proxy /api/yahoo (histórico completo + cotización).
//  - Divisas: frankfurter.dev (BCE, serie diaria histórica). CORS abierto.
// Las cantidades del usuario NUNCA viajan en estas peticiones: solo tickers públicos.

const CG = 'https://api.coingecko.com/api/v3';
const STALE_MS = 12 * 3600 * 1000;

const msToDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const todayStr = () => new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split('?')[0]} → ${r.status}`);
  return r.json();
}

export async function searchCrypto(q) {
  const j = await getJson(`${CG}/search?query=${encodeURIComponent(q)}`);
  return (j.coins || []).slice(0, 8).map((c) => ({
    type: 'crypto',
    cgId: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    detail: 'CoinGecko',
  }));
}

export async function searchStock(q) {
  const j = await getJson(`/api/yahoo?fn=search&q=${encodeURIComponent(q)}`);
  return (j.quotes || [])
    .filter((x) => ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(x.quoteType))
    .slice(0, 8)
    .map((x) => ({
      type: 'stock',
      ySymbol: x.symbol,
      symbol: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      detail: x.exchDisp || x.exchange || '',
    }));
}

async function fetchYahooDaily(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const j = await getJson(
    `/api/yahoo?fn=chart&symbol=${encodeURIComponent(symbol)}&interval=1d&period1=0&period2=${now}`
  );
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || `sin datos para ${symbol}`);
  const ts = res.timestamp || [];
  const close = res.indicators?.quote?.[0]?.close || [];
  const daily = [];
  for (let i = 0; i < ts.length; i++) {
    if (close[i] != null) daily.push([msToDate(ts[i] * 1000), close[i]]);
  }
  if (!daily.length) throw new Error(`histórico vacío para ${symbol}`);
  return { fetchedAt: Date.now(), currency: res.meta?.currency || 'USD', daily };
}

// El histórico completo de crypto sale de Yahoo (pares BTC-EUR / BTC-USD, sin
// límite temporal); CoinGecko gratuito solo permite 365 días (devuelve 401 con
// days=max), así que queda como respaldo para monedas sin par en Yahoo.
async function fetchCryptoHistory(asset) {
  for (const suffix of ['-EUR', '-USD']) {
    try {
      return await fetchYahooDaily(`${asset.symbol}${suffix}`);
    } catch {
      // sin ese par en Yahoo: probar el siguiente
    }
  }
  const j = await getJson(`${CG}/coins/${encodeURIComponent(asset.cgId)}/market_chart?vs_currency=eur&days=365`);
  const map = new Map();
  for (const [ms, p] of j.prices || []) map.set(msToDate(ms), p);
  if (!map.size) throw new Error(`sin histórico para ${asset.cgId}`);
  return { fetchedAt: Date.now(), currency: 'EUR', daily: [...map.entries()] };
}

const fetchStockHistory = fetchYahooDaily;

async function fetchStockQuote(ySymbol) {
  const j = await getJson(`/api/yahoo?fn=chart&symbol=${encodeURIComponent(ySymbol)}&interval=1d&range=5d`);
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(`sin cotización para ${ySymbol}`);
  return {
    price: res.meta?.regularMarketPrice ?? null,
    prevClose: res.meta?.chartPreviousClose ?? null,
    currency: res.meta?.currency || 'USD',
  };
}

async function fetchFx(cur) {
  // Primero frankfurter (BCE, directo desde el cliente); si la red lo bloquea,
  // respaldo vía nuestro proxy de Yahoo con el par USDEUR=X (mismo formato daily).
  try {
    const j = await getJson(`https://api.frankfurter.dev/v1/2000-01-01..?base=${encodeURIComponent(cur)}&symbols=EUR`);
    const daily = Object.entries(j.rates || {})
      .map(([d, o]) => [d, o.EUR])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (!daily.length) throw new Error(`sin FX para ${cur}`);
    return { fetchedAt: Date.now(), daily, latest: daily[daily.length - 1][1] };
  } catch (e) {
    const h = await fetchYahooDaily(`${cur}EUR=X`);
    return { fetchedAt: h.fetchedAt, daily: h.daily, latest: h.daily[h.daily.length - 1][1] };
  }
}

// Precio actual de un activo recién elegido, para pre-rellenar el formulario.
export async function currentPrice(picked) {
  if (picked.type === 'crypto') {
    const j = await getJson(`${CG}/simple/price?ids=${encodeURIComponent(picked.cgId)}&vs_currencies=eur`);
    return { price: j[picked.cgId]?.eur ?? null, currency: 'EUR' };
  }
  const q = await fetchStockQuote(picked.ySymbol);
  return { price: q.price, currency: q.currency };
}

function mergeToday(cache, price, currency) {
  if (!cache || price == null) return;
  if (currency && cache.currency !== currency) return;
  const t = todayStr();
  const map = new Map(cache.daily);
  map.set(t, price);
  cache.daily = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// Actualiza cachés (histórico si >12h) y devuelve cotizaciones actuales.
// Cada activo falla de forma aislada: sin red se sigue con lo cacheado.
export async function refreshMarket(data) {
  const priceCache = structuredClone(data.priceCache || {});
  const fxCache = structuredClone(data.fxCache || {});
  const quotes = {};
  const errors = [];
  const stale = (c) => !c || Date.now() - c.fetchedAt > STALE_MS || !c.daily?.length;

  const cryptos = data.assets.filter((a) => a.type === 'crypto');
  const stocks = data.assets.filter((a) => a.type === 'stock');
  const curs = new Set(data.assets.map((a) => a.currency).filter((c) => c && c !== 'EUR'));

  for (const a of cryptos) {
    if (stale(priceCache[a.id])) {
      try {
        priceCache[a.id] = await fetchCryptoHistory(a);
      } catch (e) {
        errors.push(`${a.symbol}: ${e.message}`);
      }
    }
  }
  for (const a of stocks) {
    if (stale(priceCache[a.id])) {
      try {
        priceCache[a.id] = await fetchStockHistory(a.ySymbol);
      } catch (e) {
        errors.push(`${a.symbol}: ${e.message}`);
      }
    }
  }
  for (const a of [...cryptos, ...stocks]) {
    const cur = priceCache[a.id]?.currency;
    if (cur && cur !== 'EUR') curs.add(cur);
  }
  for (const cur of curs) {
    if (stale(fxCache[cur])) {
      try {
        fxCache[cur] = await fetchFx(cur);
      } catch (e) {
        errors.push(`FX ${cur}: ${e.message}`);
      }
    }
  }

  if (cryptos.length) {
    try {
      const ids = cryptos.map((a) => a.cgId).join(',');
      const j = await getJson(`${CG}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur&include_24hr_change=true`);
      for (const a of cryptos) {
        const q = j[a.cgId];
        if (!q) continue;
        quotes[a.id] = { price: q.eur, change24h: q.eur_24h_change ?? null, currency: 'EUR' };
        mergeToday(priceCache[a.id], q.eur, 'EUR');
      }
    } catch (e) {
      errors.push(`crypto: ${e.message}`);
    }
  }
  for (const a of stocks) {
    try {
      const q = await fetchStockQuote(a.ySymbol);
      if (q.price != null) {
        quotes[a.id] = {
          price: q.price,
          change24h: q.prevClose ? ((q.price / q.prevClose) - 1) * 100 : null,
          currency: q.currency,
        };
        mergeToday(priceCache[a.id], q.price, q.currency);
      }
    } catch (e) {
      errors.push(`${a.symbol}: ${e.message}`);
    }
  }

  return { quotes, priceCache, fxCache, errors };
}
