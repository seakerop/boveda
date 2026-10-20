// Libro de operaciones: la única fuente de verdad de cantidades, costes y
// resultados. Todo se deriva de las transacciones; nada calculado se persiste.
//
// Tipos de operación (tx.kind):
//   buy     compra (en cash: ingreso)          qty, price, fee
//   sell    venta  (en cash: retirada)         qty, price, fee
//   cost    gasto que suma al coste sin cambiar la cantidad (reforma de un piso)
//   income  dividendo / renta cobrada          qty = importe bruto, price = 1, withholding
//
// Importes en la divisa de la operación (txCurrency). Cada operación en divisa
// guarda el tipo de cambio de SU día (tx.fxRate, EUR por unidad): el coste en
// euros es el que pagaste de verdad, no el de convertirlo al cambio de hoy.

import { addMonthsStr, daysBetween, todayStr } from './dates.js';

const EPS = 1e-9;

// Divisas que Yahoo da en centésimas (peniques de Londres, etc.).
const SUB_UNITS = { GBp: ['GBP', 100], GBX: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };

export function fxBase(cur) {
  const s = SUB_UNITS[cur];
  return s ? { code: s[0], div: s[1] } : { code: cur, div: 1 };
}

// Último valor con fecha <= date en una serie [[date, value]] ordenada.
export function valueAtOrBefore(daily, date) {
  let lo = 0;
  let hi = daily.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (daily[mid][0] <= date) {
      found = daily[mid][1];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// EUR por unidad de `cur` en `date`. Antes del primer dato del histórico se usa
// el primero disponible (mejor aproximación que nada); sin histórico, el último.
export function fxAt(fxCache, cur, date) {
  if (!cur || cur === 'EUR') return 1;
  const { code, div } = fxBase(cur);
  if (code === 'EUR') return 1 / div;
  const c = fxCache?.[code];
  if (!c) return null;
  let v = c.daily?.length ? valueAtOrBefore(c.daily, date) : null;
  if (v == null && c.daily?.length) v = c.daily[0][1];
  if (v == null) v = c.latest ?? null;
  return v == null ? null : v / div;
}

export function fxNow(fxCache, cur) {
  if (!cur || cur === 'EUR') return 1;
  const { code, div } = fxBase(cur);
  if (code === 'EUR') return 1 / div;
  const v = fxCache?.[code]?.latest;
  return v == null ? null : v / div;
}

// Divisa en la que se apuntan las operaciones de un activo. La cripto se apunta
// en EUR (el formulario la pre-rellena con el precio en euros de CoinGecko).
export function txCurrency(asset, priceCache) {
  if (asset.type === 'crypto' || asset.type === 'realestate') return 'EUR';
  if (asset.type === 'cash') return asset.currency || 'EUR';
  return asset.currency || priceCache?.[asset.id]?.currency || 'EUR';
}

export function txFx(tx, cur, fxCache) {
  if (!cur || cur === 'EUR') return 1;
  if (tx.fxRate > 0) return tx.fxRate;
  return fxAt(fxCache, cur, tx.date);
}

// Orden cronológico; dentro del mismo día, el orden en que se apuntaron. Así
// "vendo con pérdidas y recompro el mismo día" calcula la pérdida sobre lo viejo
// (y coincide con el FIFO del informe fiscal).
export function sortTxs(txs) {
  return txs
    .map((t, i) => [t, i])
    .sort(([a, ia], [b, ib]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ia - ib))
    .map(([t]) => t);
}

export function newLedger() {
  return {
    qty: 0,
    costCur: 0, // coste de lo que sigue en cartera, en divisa de la operación
    costEur: 0, // ídem en euros, a los cambios históricos
    realizedEur: 0, // resultado de lo vendido (coste medio)
    incomeEur: 0, // dividendos/rentas netos de retención
    incomeGrossEur: 0,
    withholdingEur: 0,
    buysEur: 0, // todo lo que ha entrado (compras + gastos)
    sellsEur: 0, // todo lo cobrado por ventas, neto de comisión
    feesEur: 0,
  };
}

const n = (v) => (Number.isFinite(+v) ? +v : 0);
export const incomeGross = (t) => n(t.qty) * (n(t.price) || 1);

// Aplica una operación. `fx` = EUR por unidad de la divisa de la operación.
export function applyTx(L, t, fx) {
  const q = n(t.qty);
  const p = n(t.price);
  const fee = n(t.fee);
  if (t.kind === 'buy') {
    const g = q * p + fee;
    L.qty += q;
    L.costCur += g;
    L.costEur += g * fx;
    L.buysEur += g * fx;
    L.feesEur += fee * fx;
  } else if (t.kind === 'cost') {
    const g = q * p + fee;
    L.buysEur += g * fx;
    if (L.qty > EPS) {
      L.costCur += g;
      L.costEur += g * fx;
    } else {
      // Gasto tras haber vendido (notaría tardía, una derrama...): no hay
      // posición a la que sumarlo, así que resta del resultado ya realizado.
      L.realizedEur -= g * fx;
    }
  } else if (t.kind === 'sell') {
    const sq = Math.min(q, L.qty);
    if (sq <= EPS) return;
    const frac = sq / L.qty;
    const cCur = L.costCur * frac;
    const cEur = L.costEur * frac;
    const proceedsEur = (sq * p - fee) * fx;
    L.realizedEur += proceedsEur - cEur;
    L.sellsEur += proceedsEur;
    L.feesEur += fee * fx;
    L.qty -= sq;
    L.costCur -= cCur;
    L.costEur -= cEur;
    if (L.qty < EPS) {
      L.qty = 0;
      L.costCur = 0;
      L.costEur = 0;
    }
  } else if (t.kind === 'income') {
    const gross = incomeGross(t);
    const wh = n(t.withholding);
    L.incomeGrossEur += gross * fx;
    L.withholdingEur += wh * fx;
    L.incomeEur += (gross - wh) * fx;
  }
}

// Dinero neto que has puesto en el activo: lo metido menos lo sacado.
export const contribEur = (L) => L.buysEur - L.sellsEur - L.incomeEur;

// Flujo de caja de la operación desde tu bolsillo (negativo = sale dinero tuyo).
export function txFlowEur(t, fx) {
  const q = n(t.qty);
  const p = n(t.price);
  const fee = n(t.fee);
  if (t.kind === 'buy' || t.kind === 'cost') return -(q * p + fee) * fx;
  if (t.kind === 'sell') return (q * p - fee) * fx;
  if (t.kind === 'income') return (incomeGross(t) - n(t.withholding)) * fx;
  return 0;
}

// Comprueba que ninguna venta deja la posición en negativo en ningún momento.
export function validateSequence(txs) {
  let qty = 0;
  for (const t of sortTxs(txs)) {
    if (t.kind === 'buy') qty += n(t.qty);
    else if (t.kind === 'sell') {
      if (n(t.qty) > qty + EPS * Math.max(1, qty)) return { ok: false, tx: t, available: Math.max(0, qty) };
      qty -= n(t.qty);
    }
  }
  return { ok: true };
}

// Cantidad disponible justo antes de una fecha (para el formulario de venta).
export function qtyAvailableOn(txs, date, excludeId) {
  let qty = 0;
  for (const t of sortTxs(txs)) {
    if (t.id === excludeId) continue;
    if (t.date > date) break;
    if (t.kind === 'buy') qty += n(t.qty);
    else if (t.kind === 'sell') qty -= n(t.qty);
  }
  return Math.max(0, qty);
}

// ---------- rentabilidad ----------

// TIR (XIRR): tasa anual que hace cero el valor actual de los flujos.
// Bisección robusta: no diverge como Newton con flujos raros.
export function xirr(flows) {
  if (flows.length < 2) return null;
  const hasNeg = flows.some((f) => f.amount < 0);
  const hasPos = flows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date);
  const ys = flows.map((f) => daysBetween(t0, f.date) / 365.25);
  const npv = (r) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, ys[i]), 0);
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  // Rentabilidades enormes (x20 en un año): se amplía el techo hasta encerrar la raíz.
  while (Number.isFinite(fhi) && flo * fhi > 0 && hi < 1e6) {
    hi *= 4;
    fhi = npv(hi);
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

// Resumen de rentabilidad de unos flujos (incluido el valor actual como último
// flujo positivo). `end` es hasta cuándo se mide: hoy para lo que sigue en
// cartera, el último movimiento para una posición ya cerrada. Con menos de un año
// no se anualiza: una TIR de 3 meses extrapolada a un año engaña más que informa.
//
// El % simple se calcula sobre el máximo de dinero propio que llegó a estar
// dentro a la vez: si vendes y reinviertes lo cobrado, no cuenta dos veces.
export function returnStats(flows, end = todayStr()) {
  const valid = flows
    .filter((f) => Number.isFinite(f.amount) && f.amount !== 0)
    .map((f, i) => [f, i])
    .sort(([a, ia], [b, ib]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ia - ib))
    .map(([f]) => f);
  if (!valid.length) return null;
  const putIn = -valid.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0);
  if (putIn <= 0) return null;
  const gain = valid.reduce((s, f) => s + f.amount, 0);
  let running = 0;
  let peak = 0;
  for (const f of valid) {
    running -= f.amount;
    if (running > peak) peak = running;
  }
  const invested = peak > 0 ? peak : putIn;
  const days = daysBetween(valid[0].date, end);
  const irr = days >= 365 ? xirr(valid) : null;
  return {
    invested,
    gain,
    simplePct: (gain / invested) * 100,
    irrPct: irr == null ? null : irr * 100,
    irrFailed: days >= 365 && irr == null,
    days,
  };
}

// ---------- informe fiscal (IRPF, España) ----------

// Hacienda calcula las ganancias de valores homogéneos por FIFO (art. 37.2 LIRPF):
// se venden primero los títulos comprados primero. Esto NO coincide con el coste
// medio que usa el resto de la app, y por eso el informe va aparte.
export function taxReport(data, year) {
  const ys = String(year);
  const sales = [];
  const income = [];
  const missing = new Set();
  for (const a of data.assets) {
    const txs = sortTxs(data.transactions.filter((t) => t.assetId === a.id));
    const cur = txCurrency(a, data.priceCache);
    const fxOf = (t) => {
      const fx = txFx(t, cur, data.fxCache) ?? fxNow(data.fxCache, cur);
      if (fx == null) missing.add(a.symbol || a.name);
      return fx ?? 0;
    };
    if (a.type === 'crypto' || a.type === 'stock') {
      // Lotes FIFO. Cada lote lleva además la pérdida aplazada que tenga colgada
      // (regla de los dos meses) y cuántos de sus títulos aún pueden servir de
      // "recompra" para aplazar otra pérdida (cada título sirve una sola vez).
      const lots = [];
      const futureCap = {}; // capacidad de recompra ya usada de compras futuras
      const futureDeferred = {}; // pérdida aplazada ya asignada a compras futuras
      for (let i = 0; i < txs.length; i++) {
        const t = txs[i];
        const fx = fxOf(t);
        if (t.kind === 'buy' && n(t.qty) > 0) {
          lots.push({
            id: t.id,
            date: t.date,
            qty: n(t.qty),
            unitEur: ((n(t.qty) * n(t.price) + n(t.fee)) * fx) / n(t.qty),
            cap: n(t.qty) - (futureCap[t.id] || 0),
            deferred: futureDeferred[t.id] || 0,
          });
        } else if (t.kind === 'sell') {
          let rem = n(t.qty);
          let acq = 0;
          let integrated = 0;
          while (rem > EPS && lots.length) {
            const lot = lots[0];
            const take = Math.min(rem, lot.qty);
            acq += take * lot.unitEur;
            // Al vender títulos que sirvieron de recompra, su pérdida aplazada se imputa ahora.
            if (lot.deferred > 0) {
              const part = (lot.deferred * take) / lot.qty;
              integrated += part;
              lot.deferred -= part;
            }
            lot.qty -= take;
            lot.cap = Math.min(lot.cap, lot.qty);
            rem -= take;
            if (lot.qty <= EPS) lots.shift();
          }
          const transm = (n(t.qty) * n(t.price) - n(t.fee)) * fx;
          const base = transm - acq;
          // Regla de los dos meses (art. 33.5.f LIRPF): en acciones y ETF cotizados,
          // una pérdida no se computa en la parte correspondiente a títulos
          // homogéneos comprados dos meses antes o después que sigan en cartera:
          // se aplaza a cuando se vendan esos títulos.
          let deferred = 0;
          if (a.type === 'stock' && base < -0.005) {
            const loss = -base;
            const q = n(t.qty);
            const from = addMonthsStr(t.date, -2);
            const to = addMonthsStr(t.date, 2);
            let need = q;
            for (const lot of lots) {
              if (need <= EPS) break;
              if (lot.date < from || lot.cap <= EPS) continue;
              const u = Math.min(need, lot.cap);
              lot.cap -= u;
              lot.deferred += (loss * u) / q;
              need -= u;
            }
            for (let j = i + 1; j < txs.length && need > EPS; j++) {
              const u0 = txs[j];
              if (u0.kind !== 'buy' || u0.date < t.date || u0.date > to) continue;
              const capLeft = n(u0.qty) - (futureCap[u0.id] || 0);
              if (capLeft <= EPS) continue;
              const u = Math.min(need, capLeft);
              futureCap[u0.id] = (futureCap[u0.id] || 0) + u;
              futureDeferred[u0.id] = (futureDeferred[u0.id] || 0) + (loss * u) / q;
              need -= u;
            }
            deferred = (loss * (q - need)) / q;
          }
          if (!t.date.startsWith(ys)) continue;
          sales.push({
            date: t.date,
            asset: a,
            qty: n(t.qty),
            transmision: transm,
            adquisicion: acq,
            resultado: base + deferred - integrated,
            deferred,
            integrated,
            unmatched: rem > EPS,
            twoMonths: deferred > 0.005,
          });
        } else if (t.kind === 'income' && t.date.startsWith(ys)) {
          income.push({ date: t.date, asset: a, gross: incomeGross(t) * fx, withholding: n(t.withholding) * fx });
        }
      }
    } else if (a.type === 'realestate') {
      for (const t of txs) {
        if (t.kind === 'income' && t.date.startsWith(ys)) {
          const fx = fxOf(t);
          income.push({ date: t.date, asset: a, gross: incomeGross(t) * fx, withholding: n(t.withholding) * fx, rent: true });
        }
      }
    }
  }
  sales.sort((x, y) => (x.date < y.date ? -1 : 1));
  income.sort((x, y) => (x.date < y.date ? -1 : 1));
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const stockSales = sales.filter((s) => s.asset.type === 'stock');
  const cryptoSales = sales.filter((s) => s.asset.type === 'crypto');
  const block = (arr) => ({
    gains: sum(arr.filter((s) => s.resultado > 0), (s) => s.resultado),
    losses: sum(arr.filter((s) => s.resultado < 0), (s) => s.resultado),
    net: sum(arr, (s) => s.resultado),
  });
  const divs = income.filter((x) => !x.rent);
  const rents = income.filter((x) => x.rent);
  return {
    year,
    sales,
    income,
    stock: block(stockSales),
    crypto: block(cryptoSales),
    dividends: { gross: sum(divs, (x) => x.gross), withholding: sum(divs, (x) => x.withholding) },
    rents: { gross: sum(rents, (x) => x.gross), withholding: sum(rents, (x) => x.withholding) },
    missingFx: [...missing],
  };
}

// Años con algo que declarar (ventas o cobros), del más reciente al más antiguo.
export function taxYears(data) {
  const ys = new Set();
  for (const t of data.transactions) {
    if (t.kind === 'sell' || t.kind === 'income') {
      const a = data.assets.find((x) => x.id === t.assetId);
      // Las ventas de inmuebles no entran en el informe (tienen reglas propias).
      if (a && a.type !== 'cash' && !(a.type === 'realestate' && t.kind === 'sell')) ys.add(Number(t.date.slice(0, 4)));
    }
  }
  return [...ys].sort((a, b) => b - a);
}
