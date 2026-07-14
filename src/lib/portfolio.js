// Cálculo de posiciones (coste medio) y reconstrucción del histórico diario del
// patrimonio en EUR desde la primera operación, usando los precios cacheados.
// De la serie diaria se agregan velas semanales (lunes como apertura de semana).

export const SEGMENTS = [
  { key: 'crypto', label: 'Cripto', color: '#c98500' },
  { key: 'stock', label: 'Bolsa', color: '#3987e5' },
  { key: 'realestate', label: 'Inmuebles', color: '#9085e9' },
  { key: 'cash', label: 'Cash', color: '#199e70' },
];

const dstr = (d) => d.toISOString().slice(0, 10);
export const todayStr = () => dstr(new Date());
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function assetCurrency(data, a) {
  return data.priceCache?.[a.id]?.currency || a.currency || 'EUR';
}

function fxLatest(data, cur) {
  if (!cur || cur === 'EUR') return 1;
  return data.fxCache?.[cur]?.latest ?? null;
}

function costAndQty(txs) {
  let qty = 0;
  let cost = 0;
  for (const t of txs) {
    if (t.kind === 'buy') {
      cost += t.qty * t.price + (t.fee || 0);
      qty += t.qty;
    } else {
      const avg = qty > 0 ? cost / qty : 0;
      cost = Math.max(0, cost - avg * t.qty);
      qty = Math.max(0, qty - t.qty);
    }
  }
  return { qty, cost };
}

// Valor de un activo manual: coste acumulado hasta la primera valoración,
// interpolación lineal entre valoraciones, última valoración hacia delante.
function manualValue(vals, date, costSoFar) {
  if (!vals.length) return costSoFar;
  if (date < vals[0].date) return costSoFar;
  for (let i = 0; i < vals.length; i++) {
    if (date === vals[i].date) return vals[i].value;
    if (date < vals[i].date) {
      const a = vals[i - 1];
      const b = vals[i];
      const span = (Date.parse(b.date) - Date.parse(a.date)) / 86400000;
      const pos = (Date.parse(date) - Date.parse(a.date)) / 86400000;
      return a.value + ((b.value - a.value) * pos) / span;
    }
  }
  return vals[vals.length - 1].value;
}

export function computePositions(data, quotes) {
  return data.assets.map((a) => {
    const txs = data.transactions.filter((t) => t.assetId === a.id).sort(byDate);
    const { qty, cost } = costAndQty(txs);
    const cur = quotes[a.id]?.currency || assetCurrency(data, a);
    const fx = fxLatest(data, cur);
    const price = quotes[a.id]?.price ?? data.priceCache?.[a.id]?.daily?.at(-1)?.[1] ?? null;

    let valueEur = null;
    let costEur = fx != null ? cost * fx : null;
    if (a.type === 'realestate') {
      const vals = data.valuations.filter((v) => v.assetId === a.id).sort(byDate);
      valueEur = qty > 0 ? (vals.at(-1)?.value ?? cost) : 0;
      costEur = cost;
    } else if (a.type === 'cash') {
      valueEur = fx != null ? qty * fx : null;
      costEur = valueEur;
    } else if (price != null && fx != null) {
      valueEur = qty * price * fx;
    }
    const pnl = valueEur != null && costEur != null ? valueEur - costEur : null;
    return {
      asset: a,
      qty,
      costEur,
      valueEur,
      pnl,
      pnlPct: pnl != null && costEur > 0 ? (pnl / costEur) * 100 : 0,
      price,
      priceCur: cur,
      change24h: quotes[a.id]?.change24h ?? null,
    };
  });
}

// Serie diaria {date, total, crypto, stock, realestate, cash} desde la 1ª operación.
export function buildDailySeries(data) {
  const txsAll = [...data.transactions].sort(byDate);
  if (!txsAll.length) return [];
  const end = todayStr();
  const perAsset = data.assets.map((a) => {
    const cur = assetCurrency(data, a);
    return {
      a,
      txs: txsAll.filter((t) => t.assetId === a.id),
      priceMap: new Map(data.priceCache?.[a.id]?.daily || []),
      fxMap: cur === 'EUR' ? null : new Map(data.fxCache?.[cur]?.daily || []),
      vals: data.valuations.filter((v) => v.assetId === a.id).sort(byDate),
    };
  });
  const state = perAsset.map((x) => ({ i: 0, qty: 0, cost: 0, lastPrice: null, lastFx: x.fxMap ? null : 1 }));
  const rows = [];
  const d = new Date(txsAll[0].date + 'T00:00:00Z');
  for (let date = dstr(d); date <= end; d.setUTCDate(d.getUTCDate() + 1), date = dstr(d)) {
    const row = { date, total: 0, crypto: 0, stock: 0, realestate: 0, cash: 0 };
    perAsset.forEach((x, k) => {
      const s = state[k];
      while (s.i < x.txs.length && x.txs[s.i].date <= date) {
        const t = x.txs[s.i];
        if (t.kind === 'buy') {
          s.cost += t.qty * t.price + (t.fee || 0);
          s.qty += t.qty;
        } else {
          const avg = s.qty > 0 ? s.cost / s.qty : 0;
          s.cost = Math.max(0, s.cost - avg * t.qty);
          s.qty = Math.max(0, s.qty - t.qty);
        }
        s.i++;
      }
      if (x.priceMap.has(date)) s.lastPrice = x.priceMap.get(date);
      if (x.fxMap && x.fxMap.has(date)) s.lastFx = x.fxMap.get(date);
      let v = 0;
      if (s.qty > 0) {
        if (x.a.type === 'realestate') v = manualValue(x.vals, date, s.cost);
        else if (x.a.type === 'cash') v = s.lastFx != null ? s.qty * s.lastFx : 0;
        else v = s.lastPrice != null && s.lastFx != null ? s.qty * s.lastPrice * s.lastFx : 0;
      }
      row[x.a.type] += v;
    });
    row.total = row.crypto + row.stock + row.realestate + row.cash;
    rows.push(row);
  }
  return rows;
}

// Activos con posición viva que NO pueden entrar en la reconstrucción del
// histórico (falta su serie de precios o el tipo de cambio de su divisa).
export function seriesGaps(data) {
  const gaps = [];
  for (const a of data.assets) {
    if (a.type === 'realestate' || a.type === 'cash') continue;
    const txs = data.transactions.filter((t) => t.assetId === a.id);
    const { qty } = costAndQty(txs.sort(byDate));
    if (qty <= 0) continue;
    const cache = data.priceCache?.[a.id];
    if (!cache?.daily?.length) {
      gaps.push({ symbol: a.symbol, motivo: 'sin histórico de precios' });
    } else if (cache.currency !== 'EUR' && !data.fxCache?.[cache.currency]?.daily?.length) {
      gaps.push({ symbol: a.symbol, motivo: `sin tipo de cambio ${cache.currency}→EUR` });
    }
  }
  return gaps;
}

export function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dstr(d);
}

// pairs: [[date, value]] ordenados → velas semanales OHLC.
export function weeklyFromPairs(pairs) {
  const out = [];
  let cur = null;
  for (const [date, v] of pairs) {
    if (v == null) continue;
    const wk = mondayOf(date);
    if (!cur || cur.time !== wk) {
      if (cur) out.push(cur);
      cur = { time: wk, open: v, high: v, low: v, close: v };
    } else {
      cur.high = Math.max(cur.high, v);
      cur.low = Math.min(cur.low, v);
      cur.close = v;
    }
  }
  if (cur) out.push(cur);
  while (out.length && out[0].high === 0) out.shift();
  return out;
}

export const weeklyCandles = (rows, seg = 'total') =>
  weeklyFromPairs(rows.map((r) => [r.date, r[seg]]));

// Precio diario de un activo en EUR (para la gráfica de detalle).
export function assetDailyEurPairs(data, assetId) {
  const a = data.assets.find((x) => x.id === assetId);
  if (!a) return [];
  if (a.type === 'realestate' || a.type === 'cash') {
    return buildDailySeries({ ...data, assets: [a] }).map((r) => [r.date, r[a.type]]);
  }
  const cache = data.priceCache?.[assetId];
  if (!cache?.daily?.length) return [];
  if (cache.currency === 'EUR') return cache.daily;
  const fxMap = new Map(data.fxCache?.[cache.currency]?.daily || []);
  let lastFx = null;
  const out = [];
  for (const [date, p] of cache.daily) {
    if (fxMap.has(date)) lastFx = fxMap.get(date);
    if (lastFx != null) out.push([date, p * lastFx]);
  }
  return out;
}

export function txMarkers(data, assetId) {
  return data.transactions
    .filter((t) => t.assetId === assetId)
    .sort(byDate)
    .map((t) => ({
      time: mondayOf(t.date),
      position: t.kind === 'buy' ? 'belowBar' : 'aboveBar',
      color: t.kind === 'buy' ? '#0ca30c' : '#e66767',
      shape: t.kind === 'buy' ? 'arrowUp' : 'arrowDown',
      text: t.kind === 'buy' ? 'C' : 'V',
    }));
}
