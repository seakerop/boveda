// Posiciones y reconstrucción del histórico diario del patrimonio en EUR desde la
// primera operación, usando los precios cacheados. De la serie diaria se agregan
// velas semanales (lunes como apertura de semana). Los costes y resultados salen
// del libro de operaciones (ledger.js).

import { buildSchedule, euriborMap } from './loan.js';
import { addDays, todayStr } from './dates.js';
import {
  applyTx,
  contribEur,
  fxAt,
  fxBase,
  fxNow,
  newLedger,
  returnStats,
  sortTxs,
  txCurrency,
  txFlowEur,
  txFx,
  valueAtOrBefore,
} from './ledger.js';

export { todayStr };

export const SEGMENTS = [
  { key: 'crypto', label: 'Cripto', color: '#d9a03a' },
  { key: 'stock', label: 'Bolsa', color: '#4c8dea' },
  { key: 'realestate', label: 'Inmuebles', color: '#9a8cf0' },
  { key: 'cash', label: 'Cash', color: '#2bb383' },
];

export const INVEST_TYPES = ['crypto', 'stock', 'realestate'];

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Valor de un activo manual: coste acumulado hasta la primera valoración,
// interpolación lineal entre valoraciones, última valoración hacia delante. Los
// gastos (reformas) posteriores a la última valoración se suman a ella hasta que
// haya una valoración nueva: si no, una reforma aparecería como una pérdida.
function manualValue(vals, date, costSoFar, costs = []) {
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
  const last = vals[vals.length - 1];
  return last.value + costs.filter((c) => c.date > last.date && c.date <= date).reduce((s, c) => s + c.eur, 0);
}

// Gastos de un inmueble en euros, para manualValue.
const costsOf = (txs) =>
  txs.filter((t) => t.kind === 'cost').map((t) => ({ date: t.date, eur: (Number(t.qty) || 0) * (Number(t.price) || 0) + (Number(t.fee) || 0) }));

// fx de una operación con respaldo al cambio actual (marcando que faltaba el histórico).
function fxForTx(t, cur, fxCache) {
  const fx = txFx(t, cur, fxCache);
  if (fx != null) return { fx, missing: false };
  const now = fxNow(fxCache, cur);
  return { fx: now, missing: true };
}

export function computePositions(data, quotes, today = todayStr()) {
  return data.assets.map((a) => {
    const txs = sortTxs(data.transactions.filter((t) => t.assetId === a.id));
    const cur = txCurrency(a, data.priceCache);
    const L = newLedger();
    const flows = [];
    let missingFx = false;
    for (const t of txs) {
      // Sin ningún tipo de cambio la cantidad sigue contando; los euros quedan
      // como desconocidos (NaN → null) en vez de inventarse.
      const { fx, missing } = fxForTx(t, cur, data.fxCache);
      if (fx == null || missing) missingFx = true;
      const f = fx ?? NaN;
      applyTx(L, t, f);
      const flow = txFlowEur(t, f);
      // NaN (sin cambio de divisa) se conserva a propósito: así las estadísticas
      // saben que están incompletas en vez de calcularse sin ese flujo.
      if (flow !== 0) flows.push({ date: t.date, amount: flow });
    }
    const fin = (v) => (Number.isFinite(v) ? v : null);

    const q = quotes[a.id];
    const pc = data.priceCache?.[a.id];
    let price = null;
    let priceCur = cur;
    if (q?.price != null) {
      price = q.price;
      priceCur = q.currency || cur;
    } else if (pc?.daily?.length) {
      price = pc.daily[pc.daily.length - 1][1];
      priceCur = pc.currency || cur;
    }

    let valueEur = null;
    let costEur = fin(L.costEur);
    const vals = data.valuations.filter((v) => v.assetId === a.id).sort(byDate);
    if (a.type === 'realestate') {
      valueEur = L.qty > 0 ? (vals.length ? manualValue(vals, today, costEur, costsOf(txs)) : costEur) : 0;
    } else if (a.type === 'cash') {
      const f = fxNow(data.fxCache, cur);
      valueEur = f != null ? L.qty * f : null;
      costEur = valueEur;
    } else if (L.qty <= 0) {
      valueEur = 0;
    } else if (price != null) {
      const f = fxNow(data.fxCache, priceCur);
      if (f != null) valueEur = L.qty * price * f;
    }

    const pnl = valueEur != null && costEur != null && a.type !== 'cash' ? valueEur - costEur : null;
    if (a.type !== 'cash' && L.qty > 0 && valueEur != null) flows.push({ date: today, amount: valueEur });
    const flowsOk = flows.every((f) => Number.isFinite(f.amount));
    // Una posición cerrada se mide hasta su último movimiento, no hasta hoy.
    const closedNow = a.type !== 'cash' && L.qty <= 0 && txs.length > 0;
    const end = closedNow && flows.length ? flows.reduce((m, f) => (f.date > m ? f.date : m), flows[0].date) : today;
    const stats =
      a.type === 'cash' || (L.qty > 0 && valueEur == null) || !flowsOk ? null : returnStats(flows, end);
    const realizedEur = fin(L.realizedEur);
    const incomeEur = fin(L.incomeEur);
    const totalGainEur =
      a.type === 'cash' || (L.qty > 0 && pnl == null) || realizedEur == null || incomeEur == null
        ? null
        : (pnl ?? 0) + realizedEur + incomeEur;

    return {
      asset: a,
      qty: L.qty,
      cur,
      price,
      priceCur,
      valueEur,
      costEur,
      avgPrice: L.qty > 0 && Number.isFinite(L.costCur) ? L.costCur / L.qty : null,
      pnl,
      pnlPct: pnl != null && costEur > 0 ? (pnl / costEur) * 100 : null,
      realizedEur,
      incomeEur,
      totalGainEur,
      buysEur: fin(L.buysEur),
      flows,
      stats,
      closed: a.type !== 'cash' && L.qty <= 0 && txs.length > 0,
      lastValuation: vals.at(-1) || null,
      change24h: q?.change24h ?? null,
      missingFx,
    };
  });
}

// Totales de las inversiones (cripto, bolsa, inmuebles): lo que valen, lo que
// has ganado (latente + realizado + cobros) y la rentabilidad conjunta.
export function portfolioSummary(positions, today = todayStr()) {
  const inv = positions.filter((p) => INVEST_TYPES.includes(p.asset.type));
  const sum = (f) => inv.reduce((s, p) => s + (f(p) ?? 0), 0);
  const flows = inv.flatMap((p) => p.flows);
  const complete = inv.every((p) => p.totalGainEur != null) && flows.every((f) => Number.isFinite(f.amount));
  return {
    value: sum((p) => p.valueEur),
    unrealized: sum((p) => p.pnl),
    realized: sum((p) => p.realizedEur),
    income: sum((p) => p.incomeEur),
    gain: sum((p) => p.totalGainEur),
    complete,
    stats: complete ? returnStats(flows, today) : null,
  };
}

// Activos con posición viva que NO pueden entrar en la reconstrucción del
// histórico (falta su serie de precios o el tipo de cambio de su divisa).
export function seriesGaps(data) {
  const gaps = [];
  for (const a of data.assets) {
    if (a.type === 'realestate' || a.type === 'cash') continue;
    const L = newLedger();
    for (const t of sortTxs(data.transactions.filter((t) => t.assetId === a.id))) applyTx(L, t, 1);
    if (L.qty <= 0) continue;
    const cache = data.priceCache?.[a.id];
    if (!cache?.daily?.length) {
      gaps.push({ id: a.id, symbol: a.symbol, motivo: 'sin histórico de precios' });
    } else if (cache.currency !== 'EUR' && !data.fxCache?.[fxBase(cache.currency).code]?.daily?.length) {
      gaps.push({ id: a.id, symbol: a.symbol, motivo: `sin tipo de cambio ${cache.currency}→EUR` });
    }
  }
  return gaps;
}

// Serie diaria desde la 1ª operación:
//   {date, crypto, stock, realestate, cash, total, debt, net,
//    c_crypto, c_stock, c_realestate,  ← dinero neto aportado a cada segmento
//    line}                              ← "aportado" comparable con el neto
// line = aportado a inversiones + cash − deuda, así que net − line = lo ganado
// con las inversiones (el cash y la deuda se cancelan en la resta).
export function buildDailySeries(data, end = todayStr()) {
  const txsAll = [...data.transactions].sort(byDate);
  if (!txsAll.length) return [];
  const gapIds = new Set(seriesGaps(data).map((g) => g.id));
  // Precios y FX como arrays ordenados con puntero: el "último valor conocido"
  // se arrastra consumiendo también las fechas ANTERIORES al inicio de la serie
  // (si compras hoy y el FX del BCE llega hasta ayer, vale el de ayer).
  const perAsset = data.assets
    .filter((a) => !gapIds.has(a.id))
    .map((a) => {
      const cur = txCurrency(a, data.priceCache);
      const priceCur = data.priceCache?.[a.id]?.currency || cur;
      const { code, div } = fxBase(priceCur);
      return {
        a,
        cur,
        txs: sortTxs(txsAll.filter((t) => t.assetId === a.id)),
        prices: data.priceCache?.[a.id]?.daily || [],
        valFx: code === 'EUR' ? null : data.fxCache?.[code]?.daily || [],
        valDiv: div,
        cashFx: a.type === 'cash' && cur !== 'EUR' ? data.fxCache?.[fxBase(cur).code]?.daily || [] : null,
        cashDiv: fxBase(cur).div,
        vals: data.valuations.filter((v) => v.assetId === a.id).sort(byDate),
        costs: a.type === 'realestate' ? costsOf(txsAll.filter((t) => t.assetId === a.id)) : [],
        L: newLedger(),
        i: 0,
        pi: 0,
        fi: 0,
        ci: 0,
        lastPrice: null,
        lastFx: null,
        lastCashFx: null,
      };
    });
  const loanCtx = { euribor: euriborMap(data.euriborCache) };
  const perDebt = (data.debts || []).map((debt) => ({
    rows: buildSchedule(debt, data.debtEvents || [], null, loanCtx),
    i: 0,
    balance: debt.principal,
  }));

  const rows = [];
  for (let date = txsAll[0].date; date <= end; date = addDays(date, 1)) {
    const row = {
      date,
      crypto: 0,
      stock: 0,
      realestate: 0,
      cash: 0,
      c_crypto: 0,
      c_stock: 0,
      c_realestate: 0,
      debt: 0,
      total: 0,
      net: 0,
      line: 0,
    };
    for (const x of perAsset) {
      while (x.i < x.txs.length && x.txs[x.i].date <= date) {
        const t = x.txs[x.i];
        const fx = txFx(t, x.cur, data.fxCache) ?? fxNow(data.fxCache, x.cur);
        if (fx != null) applyTx(x.L, t, fx);
        x.i++;
      }
      while (x.pi < x.prices.length && x.prices[x.pi][0] <= date) {
        x.lastPrice = x.prices[x.pi][1];
        x.pi++;
      }
      if (x.valFx) {
        while (x.fi < x.valFx.length && x.valFx[x.fi][0] <= date) {
          x.lastFx = x.valFx[x.fi][1] / x.valDiv;
          x.fi++;
        }
        if (x.lastFx == null && x.valFx.length) x.lastFx = x.valFx[0][1] / x.valDiv;
      }
      if (x.cashFx) {
        while (x.ci < x.cashFx.length && x.cashFx[x.ci][0] <= date) {
          x.lastCashFx = x.cashFx[x.ci][1] / x.cashDiv;
          x.ci++;
        }
        if (x.lastCashFx == null && x.cashFx.length) x.lastCashFx = x.cashFx[0][1] / x.cashDiv;
      }
      const L = x.L;
      let v = 0;
      if (x.a.type === 'cash') {
        const f = x.cur === 'EUR' ? 1 : x.lastCashFx ?? fxNow(data.fxCache, x.cur);
        v = f != null ? L.qty * f : 0;
      } else if (L.qty > 0) {
        if (x.a.type === 'realestate') v = manualValue(x.vals, date, L.costEur, x.costs);
        else {
          const f = x.valFx ? x.lastFx : 1 / x.valDiv;
          // Sin precio todavía para ese día (compra anterior al histórico): se
          // valora a coste, que no inventa ni ganancias ni pérdidas.
          v = x.lastPrice != null && f != null ? L.qty * x.lastPrice * f : L.costEur;
        }
      }
      row[x.a.type] += v;
      if (x.a.type !== 'cash') row['c_' + x.a.type] += contribEur(L);
    }
    for (const pd of perDebt) {
      while (pd.i < pd.rows.length && pd.rows[pd.i].date <= date) {
        pd.balance = pd.rows[pd.i].balance;
        pd.i++;
      }
      row.debt += pd.balance;
    }
    row.total = row.crypto + row.stock + row.realestate + row.cash;
    row.net = row.total - row.debt;
    row.line = row.c_crypto + row.c_stock + row.c_realestate + row.cash - row.debt;
    rows.push(row);
  }
  return rows;
}

export function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// pairs: [[date, value]] ordenados → velas semanales OHLC.
export function weeklyFromPairs(pairs) {
  const out = [];
  let cur = null;
  for (const [date, v] of pairs) {
    if (v == null || !Number.isFinite(v)) continue;
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
  while (out.length && out[0].high === 0 && out[0].low === 0) out.shift();
  return out;
}

export const weeklyCandles = (rows, seg = 'total') => weeklyFromPairs(rows.map((r) => [r.date, r[seg]]));

// Línea semanal (cierre de cada semana) de una clave de la serie.
export function weeklyLine(rows, key) {
  const out = [];
  for (const r of rows) {
    const v = r[key];
    if (v == null || !Number.isFinite(v)) continue;
    const wk = mondayOf(r.date);
    if (out.length && out[out.length - 1].time === wk) out[out.length - 1].value = v;
    else out.push({ time: wk, value: v });
  }
  return out;
}

// Precio diario de un activo en EUR (para la gráfica de detalle).
export function assetDailyEurPairs(data, assetId) {
  const a = data.assets.find((x) => x.id === assetId);
  if (!a) return [];
  if (a.type === 'realestate' || a.type === 'cash') {
    return buildDailySeries({ ...data, assets: [a], debts: [] }).map((r) => [r.date, r[a.type]]);
  }
  const cache = data.priceCache?.[assetId];
  if (!cache?.daily?.length) return [];
  if (cache.currency === 'EUR') return cache.daily;
  const out = [];
  for (const [date, p] of cache.daily) {
    const f = fxAt(data.fxCache, cache.currency, date);
    if (f != null) out.push([date, p * f]);
  }
  return out;
}

export function txMarkers(data, assetId) {
  return sortTxs(data.transactions.filter((t) => t.assetId === assetId && (t.kind === 'buy' || t.kind === 'sell'))).map(
    (t) => ({
      time: mondayOf(t.date),
      position: t.kind === 'buy' ? 'belowBar' : 'aboveBar',
      color: t.kind === 'buy' ? '#34c77b' : '#f06b6b',
      shape: t.kind === 'buy' ? 'arrowUp' : 'arrowDown',
      text: t.kind === 'buy' ? 'C' : 'V',
    })
  );
}

// Benchmark: "¿y si cada euro que metiste (y sacaste) lo hubieras movido el mismo
// día en un índice?". Mismos flujos, mismas fechas: es la comparación honesta
// (método PME). Solo inversiones financieras (cripto y bolsa).
export function benchmarkCompare(positions, benchDaily, benchCur, fxCache, today = todayStr()) {
  if (!benchDaily?.length) return null;
  // Posiciones vivas sin precio quedan fuera: contar lo que costaron pero no lo
  // que valen sesgaría la comparación en contra.
  const inv = positions.filter(
    (p) =>
      (p.asset.type === 'crypto' || p.asset.type === 'stock') &&
      !(p.qty > 0 && p.valueEur == null) &&
      p.flows.every((f) => Number.isFinite(f.amount))
  );
  // El último flujo de una posición viva es su valor actual, no un movimiento de dinero.
  const realFlows = inv.flatMap((p) => (p.qty > 0 && p.valueEur != null ? p.flows.slice(0, -1) : p.flows));
  if (!realFlows.length) return null;
  const idxEur = (date) => {
    const px = valueAtOrBefore(benchDaily, date) ?? benchDaily[0][1];
    const f = fxAt(fxCache, benchCur, date);
    return px != null && f != null ? px * f : null;
  };
  const nowIdx = idxEur(today);
  if (nowIdx == null) return null;
  let units = 0;
  let early = false;
  for (const f of realFlows) {
    const px = idxEur(f.date);
    if (px == null) continue;
    if (f.date < benchDaily[0][0]) early = true;
    units += -f.amount / px; // aportar compra participaciones; sacar las vende
  }
  const actual = inv.reduce((s, p) => s + (p.valueEur ?? 0), 0);
  const since = realFlows.reduce((m, f) => (f.date < m ? f.date : m), realFlows[0].date);
  return { benchValue: units * nowIdx, actual, early, since };
}
