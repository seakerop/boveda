// Operaciones de edición sobre la bóveda que tocan varias cosas a la vez y deben
// quedar coherentes: una venta (o un cobro) puede ingresar el dinero en una cuenta
// de cash, creando una operación enlazada (venta.cashTx ↔ ingreso.linkedTo).
// Todas validan antes de tocar nada: ninguna deja una posición en negativo.

import { validateSequence } from './ledger.js';
import { fmtDate } from './dates.js';
import { fmtPrice, fmtQty } from './format.js';

const round = (v, d = 8) => Math.round(v * 10 ** d) / 10 ** d;

// Una posición que YA era incoherente (sobreventa heredada de una versión
// antigua) no bloquea las ediciones: así se puede arreglar. La ficha lo avisa.
export const sequenceBroken = (data, assetId) =>
  !validateSequence(data.transactions.filter((t) => t.assetId === assetId)).ok;

function seqError(data, assetId, txs) {
  if (sequenceBroken(data, assetId)) return null;
  const v = validateSequence(txs.filter((t) => t.assetId === assetId));
  if (v.ok) return null;
  const a = data.assets.find((x) => x.id === assetId);
  if (a?.type === 'cash') {
    return `La retirada del ${fmtDate(v.tx.date)} dejaría "${a.name}" en negativo: en esa fecha habría ${fmtPrice(
      round(v.available, 2),
      a.currency || 'EUR'
    )}.`;
  }
  const what = a?.type === 'realestate' ? 'el inmueble' : `${fmtQty(v.tx.qty)}`;
  return `La venta del ${fmtDate(v.tx.date)} sería de ${what}, pero en esa fecha solo tendrías ${fmtQty(
    round(v.available)
  )}.`;
}

// Guarda (alta o edición) una operación y su ingreso enlazado.
// cash: null | {assetId, amount}  (importe ya en la divisa de la cuenta)
export function planSaveTx(data, tx, cash) {
  const old = data.transactions.find((t) => t.id === tx.id) || null;
  const oldLinked = old?.cashTx ? data.transactions.find((t) => t.id === old.cashTx) : null;
  const nt = { ...tx };
  delete nt.cashTx;
  delete nt.cashTo;
  let linked = null;
  if (cash && cash.amount > 0 && cash.assetId) {
    const lid = oldLinked?.id || crypto.randomUUID();
    nt.cashTx = lid;
    nt.cashTo = cash.assetId;
    linked = {
      id: lid,
      assetId: cash.assetId,
      kind: 'buy',
      date: tx.date,
      qty: round(cash.amount, 2),
      price: 1,
      fee: 0,
      linkedTo: tx.id,
    };
  }
  const next = [];
  for (const t of data.transactions) {
    if (t.id === tx.id) next.push(nt);
    else if (oldLinked && t.id === oldLinked.id) {
      if (linked) next.push(linked);
    } else next.push(t);
  }
  if (!old) next.push(nt);
  if (linked && !oldLinked) next.push(linked);

  const affected = new Set([tx.assetId, cash?.assetId, oldLinked?.assetId].filter(Boolean));
  for (const aid of affected) {
    const e = seqError(data, aid, next);
    if (e) return { error: e };
  }
  return { transactions: next };
}

// Borra una operación (y su ingreso enlazado). Devuelve lo borrado para deshacer.
export function planDeleteTx(data, txId) {
  const t = data.transactions.find((x) => x.id === txId);
  if (!t) return { error: 'Esa operación ya no existe.' };
  if (t.linkedTo) {
    return { error: 'Este ingreso viene de una venta o de un cobro: edítalo o bórralo desde esa operación.' };
  }
  const ids = new Set([t.id]);
  if (t.cashTx) ids.add(t.cashTx);
  const next = data.transactions.filter((x) => !ids.has(x.id));
  const affected = new Set(data.transactions.filter((x) => ids.has(x.id)).map((x) => x.assetId));
  for (const aid of affected) {
    const e = seqError(data, aid, next);
    if (e) return { error: `No se puede borrar: ${e.charAt(0).toLowerCase()}${e.slice(1)} Borra o ajusta antes esa operación.` };
  }
  return { transactions: next, removed: data.transactions.filter((x) => ids.has(x.id)) };
}

// Borra un activo con todo lo suyo. Los ingresos que sus ventas hicieron en
// cuentas de cash se quedan (es dinero real), solo pierden el enlace.
export function planDeleteAsset(data, assetId) {
  const asset = data.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const txs = data.transactions.filter((t) => t.assetId === assetId);
  const txIds = new Set(txs.map((t) => t.id));
  const vals = data.valuations.filter((v) => v.assetId === assetId);
  const unlinkDeposits = data.transactions
    .filter((t) => t.assetId !== assetId && t.linkedTo && txIds.has(t.linkedTo))
    .map((t) => ({ id: t.id, linkedTo: t.linkedTo }));
  const unlinkSources = data.transactions
    .filter((t) => t.assetId !== assetId && t.cashTx && txIds.has(t.cashTx))
    .map((t) => ({ id: t.id, cashTx: t.cashTx, cashTo: t.cashTo }));
  const debts = (data.debts || []).filter((d) => d.linkedAssetId === assetId).map((d) => d.id);

  return {
    apply(d) {
      d.assets = d.assets.filter((a) => a.id !== assetId);
      d.transactions = d.transactions.filter((t) => t.assetId !== assetId);
      d.valuations = d.valuations.filter((v) => v.assetId !== assetId);
      for (const t of d.transactions) {
        if (unlinkDeposits.some((u) => u.id === t.id)) delete t.linkedTo;
        if (unlinkSources.some((u) => u.id === t.id)) {
          delete t.cashTx;
          delete t.cashTo;
        }
      }
      for (const db of d.debts) if (debts.includes(db.id)) db.linkedAssetId = null;
      return d;
    },
    undo(d) {
      if (d.assets.some((a) => a.id === assetId)) return d;
      d.assets.push(asset);
      d.transactions.push(...txs);
      d.valuations.push(...vals);
      for (const t of d.transactions) {
        const dep = unlinkDeposits.find((u) => u.id === t.id);
        if (dep) t.linkedTo = dep.linkedTo;
        const src = unlinkSources.find((u) => u.id === t.id);
        if (src) {
          t.cashTx = src.cashTx;
          t.cashTo = src.cashTo;
        }
      }
      for (const db of d.debts) if (debts.includes(db.id)) db.linkedAssetId = assetId;
      return d;
    },
  };
}
