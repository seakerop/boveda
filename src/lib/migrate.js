// Migraciones de la bóveda y relleno de datos que faltan en versiones antiguas.

import { fxAt, fxBase, sortTxs, txCurrency } from './ledger.js';

export const VAULT_VERSION = 4;

// Hasta v3, un inmueble se apuntaba con "Importe" como cantidad y "Precio": una
// reforma quedaba como otra compra y una venta podía ser 320.000 × 1. El modelo
// actual es: una compra de cantidad 1 (el piso), gastos 'cost' y ventas de
// cantidad 1. Se conserva el importe (cantidad × precio) y la comisión.
function normalizeRealEstate(d) {
  const homes = new Set(d.assets.filter((a) => a.type === 'realestate').map((a) => a.id));
  if (!homes.size) return 0;
  let changed = 0;
  const firstBuy = {};
  for (const t of sortTxs(d.transactions)) {
    if (!homes.has(t.assetId)) continue;
    if (t.kind !== 'buy' && t.kind !== 'sell') continue;
    const amount = (Number(t.qty) || 0) * (Number(t.price) || 0);
    if (t.kind === 'buy' && !firstBuy[t.assetId]) {
      firstBuy[t.assetId] = t.id;
      if (t.qty !== 1) {
        t.qty = 1;
        t.price = amount;
        changed++;
      }
    } else if (t.kind === 'buy') {
      t.kind = 'cost';
      t.qty = 1;
      t.price = amount;
      changed++;
    } else if (t.qty !== 1) {
      t.qty = 1;
      t.price = amount;
      changed++;
    }
  }
  return changed;
}

export const DEFAULT_SETTINGS = { baseCurrency: 'EUR', autoLockMin: 5, lockOnHide: true };
const MARKET_KEYS = ['priceCache', 'fxCache', 'euriborCache'];

// v1 no tenía deudas; v2 guardaba las cachés de precios dentro de la bóveda
// (ahora van en su propio registro) y unas "fotos diarias" que nada leía.
export function normalizeVault(raw) {
  const d = { ...raw };
  const legacy = {};
  for (const k of MARKET_KEYS) {
    if (k in d) {
      if (d[k]) legacy[k] = d[k];
      delete d[k];
    }
  }
  const hadSnapshots = 'snapshots' in d;
  delete d.snapshots;
  if (!Array.isArray(d.assets)) d.assets = [];
  if (!Array.isArray(d.transactions)) d.transactions = [];
  if (!Array.isArray(d.valuations)) d.valuations = [];
  if (!Array.isArray(d.debts)) d.debts = [];
  if (!Array.isArray(d.debtEvents)) d.debtEvents = [];
  d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  const old = raw.version || 1;
  if (old < 4) {
    // Copia profunda de las operaciones: no se toca el objeto original.
    d.transactions = d.transactions.map((t) => ({ ...t }));
    normalizeRealEstate(d);
  }
  const migrated = old < VAULT_VERSION || Object.keys(legacy).length > 0 || hadSnapshots;
  d.version = VAULT_VERSION;
  return { vault: d, legacy, migrated };
}

// Datos que faltan en bóvedas antiguas y que se pueden completar con la caché:
// la divisa de cada acción y el tipo de cambio del día de cada operación en divisa.
export function backfillPatch(vault, market) {
  const assetCur = {};
  const txFx = {};
  for (const a of vault.assets) {
    if (a.type === 'stock' && !a.currency && market.priceCache?.[a.id]?.currency) {
      assetCur[a.id] = market.priceCache[a.id].currency;
    }
  }
  for (const t of vault.transactions) {
    if (t.fxRate > 0) continue;
    const a = vault.assets.find((x) => x.id === t.assetId);
    if (!a || a.type === 'cash') continue;
    const cur = assetCur[a.id] || txCurrency(a, market.priceCache);
    if (cur === 'EUR') continue;
    const daily = market.fxCache?.[fxBase(cur).code]?.daily;
    if (!daily?.length) continue;
    // Antes del primer dato del histórico no se graba nada: se usaría un cambio
    // de otra época y quedaría congelado para siempre.
    if (t.date < daily[0][0]) continue;
    const fx = fxAt(market.fxCache, cur, t.date);
    if (fx > 0) txFx[t.id] = fx;
  }
  return Object.keys(assetCur).length || Object.keys(txFx).length ? { assetCur, txFx } : null;
}

export function applyBackfill(d, patch) {
  for (const a of d.assets) if (patch.assetCur[a.id] && !a.currency) a.currency = patch.assetCur[a.id];
  for (const t of d.transactions) if (patch.txFx[t.id] && !(t.fxRate > 0)) t.fxRate = patch.txFx[t.id];
  return d;
}
