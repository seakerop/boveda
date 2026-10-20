import { useEffect, useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { assetDailyEurPairs, SEGMENTS, txMarkers, weeklyFromPairs } from '../lib/portfolio.js';
import { euriborMap, loanState } from '../lib/loan.js';
import { fxAt, fxBase, incomeGross, qtyAvailableOn, sortTxs, txCurrency } from '../lib/ledger.js';
import { planDeleteAsset, planDeleteTx, planSaveTx, sequenceBroken } from '../lib/ops.js';
import {
  fmtEur,
  fmtPct,
  fmtPrice,
  fmtQty,
  money,
  moneySigned,
  numToInput,
  parseNum,
  roundSig,
} from '../lib/format.js';
import { daysBetween, fmtAgo, fmtDate, todayStr } from '../lib/dates.js';
import CandleChart, { RangePicker, rangeCutoff } from './CandleChart.jsx';
import useModal from './useModal.js';
import Icon, { AssetAvatar } from './Icon.jsx';
import NumberInput from './NumberInput.jsx';

const KIND_LABEL = {
  crypto: { buy: 'Compra', sell: 'Venta' },
  stock: { buy: 'Compra', sell: 'Venta', income: 'Dividendo' },
  realestate: { buy: 'Compra', cost: 'Gasto / reforma', income: 'Alquiler', sell: 'Venta' },
  cash: { buy: 'Ingreso', sell: 'Retirada' },
};

function kindsFor(asset, tx) {
  const labels = KIND_LABEL[asset.type];
  let keys;
  if (asset.type === 'realestate') keys = ['cost', 'income', 'sell'];
  else keys = Object.keys(labels);
  // La compra inicial de un inmueble solo se edita, no se repite.
  if (tx && !keys.includes(tx.kind)) keys = [tx.kind, ...keys];
  return keys.map((k) => ({ key: k, label: labels[k] }));
}

function TxModal({ asset, tx, marketPrice, onClose }) {
  const { data, mutate, notify, privacy } = useBoveda();
  useModal(onClose);
  const showNums = privacy === 'normal';
  const cur = txCurrency(asset, data.priceCache);
  const editing = !!tx;
  const kinds = kindsFor(asset, tx);
  const isCash = asset.type === 'cash';
  const isRe = asset.type === 'realestate';
  const isMarket = asset.type === 'crypto' || asset.type === 'stock';

  const [kind, setKind] = useState(tx?.kind || kinds[0].key);
  const [date, setDate] = useState(tx?.date || todayStr());
  const [qty, setQty] = useState(tx && isMarket ? numToInput(tx.qty) : '');
  // Operación nueva en cripto/bolsa: precio de hoy pre-rellenado (editable).
  const [price, setPrice] = useState(() => {
    if (tx && (isMarket || (isRe && (tx.kind === 'buy' || tx.kind === 'sell')))) return numToInput(tx.price);
    if (!tx && isMarket && marketPrice > 0) return numToInput(roundSig(marketPrice));
    return '';
  });
  const [fee, setFee] = useState(tx?.fee ? numToInput(tx.fee) : '');
  const [amount, setAmount] = useState(() => {
    if (!tx) return '';
    if (tx.kind === 'income') return numToInput(incomeGross(tx));
    if (tx.kind === 'cost') return numToInput(tx.qty * tx.price);
    if (isCash) return numToInput(tx.qty);
    return '';
  });
  const [withholding, setWithholding] = useState(tx?.withholding ? numToInput(tx.withholding) : '');
  const accounts = data.assets.filter(
    (a) => a.type === 'cash' && a.id !== asset.id && ((a.currency || 'EUR') === 'EUR' || a.currency === cur)
  );
  const [cashTo, setCashTo] = useState(editing ? tx.cashTo || '' : accounts[0]?.id || '');
  const [err, setErr] = useState('');
  // Un error se refiere a lo que había escrito: al cambiar los datos, se retira.
  useEffect(() => setErr(''), [kind, date, qty, price, fee, amount, withholding, cashTo]);

  const assetTxs = data.transactions.filter((t) => t.assetId === asset.id);
  const available = qtyAvailableOn(assetTxs, date, tx?.id);
  const usesCash = !isCash && (kind === 'sell' || kind === 'income');
  const fxDay =
    cur === 'EUR' ? 1 : data.fxCache?.[fxBase(cur).code]?.daily?.length ? fxAt(data.fxCache, cur, date) : null;

  const nQty = parseNum(qty);
  const nPrice = parseNum(price, { money: true });
  const nFee = fee ? parseNum(fee, { money: true }) : 0;
  const nAmount = parseNum(amount, { money: true });
  const nWh = withholding ? parseNum(withholding, { money: true }) : 0;

  // Importe neto de la operación en su divisa (lo que pagas o cobras).
  let net = null;
  if (isMarket && (kind === 'buy' || kind === 'sell') && nQty > 0 && nPrice > 0) {
    net = kind === 'buy' ? nQty * nPrice + (nFee || 0) : nQty * nPrice - (nFee || 0);
  } else if (isRe && (kind === 'sell' || kind === 'buy') && nPrice > 0) {
    net = kind === 'buy' ? nPrice + (nFee || 0) : nPrice - (nFee || 0);
  } else if (kind === 'income' && nAmount > 0) net = nAmount - (nWh || 0);
  else if (kind === 'cost' && nAmount > 0) net = nAmount;
  else if (isCash && nAmount > 0) net = nAmount;

  function save() {
    setErr('');
    if (!date) return setErr('Falta la fecha.');
    if (date > todayStr()) return setErr('La fecha no puede ser futura.');
    let t;
    const base = { ...(tx || {}), id: tx?.id || crypto.randomUUID(), assetId: asset.id, kind, date };
    delete base.withholding;
    delete base.fxRate;
    if (isMarket && (kind === 'buy' || kind === 'sell')) {
      if (!(nQty > 0)) return setErr('Cantidad no válida.');
      if (!(nPrice > 0)) return setErr('Precio no válido.');
      if (!(nFee >= 0)) return setErr('Comisión no válida.');
      if (kind === 'sell' && nQty > available + 1e-9) {
        return setErr(`En esa fecha solo tienes ${fmtQty(available)}: no puedes vender más.`);
      }
      if (kind === 'sell' && nQty * nPrice - nFee < 0) return setErr('La comisión no puede ser mayor que lo que cobras.');
      t = { ...base, qty: nQty, price: nPrice, fee: nFee };
    } else if (isRe && (kind === 'sell' || kind === 'buy')) {
      if (!(nPrice > 0)) return setErr('Precio no válido.');
      if (!(nFee >= 0)) return setErr('Gastos no válidos.');
      if (kind === 'sell' && available < 1 - 1e-9) return setErr('En esa fecha el inmueble no era tuyo.');
      t = { ...base, qty: 1, price: nPrice, fee: nFee };
    } else if (kind === 'income') {
      if (!(nAmount > 0)) return setErr('Importe no válido.');
      if (!(nWh >= 0) || nWh > nAmount) return setErr('La retención no puede ser mayor que el importe.');
      t = { ...base, qty: nAmount, price: 1, fee: 0, ...(nWh > 0 ? { withholding: nWh } : {}) };
    } else if (kind === 'cost') {
      if (!(nAmount > 0)) return setErr('Importe no válido.');
      t = { ...base, qty: 1, price: nAmount, fee: 0 };
    } else {
      if (!(nAmount > 0)) return setErr('Importe no válido.');
      t = { ...base, qty: nAmount, price: 1, fee: 0 };
    }
    if (cur !== 'EUR' && fxDay > 0) t.fxRate = fxDay;

    let cash = null;
    if (usesCash && cashTo) {
      const acct = data.assets.find((a) => a.id === cashTo);
      const acctCur = acct?.currency || 'EUR';
      let amt = net;
      if (acctCur !== cur) {
        if (!(fxDay > 0)) {
          return setErr(`Aún no tengo el cambio ${cur}→EUR de ese día: actualiza precios o elige "No ingresar".`);
        }
        amt = net * fxDay;
      }
      if (amt > 0) cash = { assetId: cashTo, amount: amt };
    }
    const plan = planSaveTx(data, t, cash);
    if (plan.error) return setErr(plan.error);
    mutate((d) => {
      d.transactions = plan.transactions;
      return d;
    });
    notify(editing ? 'Operación actualizada' : 'Operación guardada', { kind: 'ok' });
    onClose();
  }

  const curLabel = cur === 'EUR' ? '€' : cur === 'GBp' || cur === 'GBX' ? 'peniques, GBp' : cur;
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? 'Editar operación' : 'Nueva operación'}>
        <div className="modal-head">
          <h2>{editing ? 'Editar operación' : 'Nueva operación'}</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="form-block">
          {editing && !showNums && (
            <div className="inline-note">
              <Icon name="eye" size={14} /> Para editar, los campos muestran las cifras aunque tengas la privacidad activa.
            </div>
          )}
          {kinds.length > 1 && (
            <div className="seg-group seg-full">
              {kinds.map((k) => (
                <button key={k.key} className={kind === k.key ? 'seg seg-on' : 'seg'} aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
          <label>
            Fecha
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </label>

          {isMarket && (kind === 'buy' || kind === 'sell') && (
            <>
              <label>
                Cantidad
                <NumberInput value={qty} onChange={setQty} autoFocus={!editing} placeholder="0,05" />
                {kind === 'sell' && showNums && (
                  <span className="field-hint">
                    Tienes {fmtQty(available)} en esa fecha.{' '}
                    {available > 0 && (
                      <button type="button" className="btn-text" onClick={() => setQty(numToInput(available))}>
                        Vender todo
                      </button>
                    )}
                  </span>
                )}
              </label>
              <label>
                Precio por unidad ({curLabel})
                <NumberInput value={price} onChange={setPrice} />
                {!editing && marketPrice > 0 && (
                  <span className="field-hint">Prerrellenado con el precio de hoy: cámbialo si fue otro día.</span>
                )}
              </label>
              <label>
                Comisión ({curLabel}, opcional)
                <NumberInput value={fee} onChange={setFee} placeholder="0" />
              </label>
            </>
          )}

          {isRe && (kind === 'sell' || kind === 'buy') && (
            <>
              <label>
                {kind === 'sell' ? 'Precio de venta (€)' : 'Precio de compra (€)'}
                <NumberInput value={price} onChange={setPrice} autoFocus={!editing} placeholder="250.000" />
              </label>
              <label>
                {kind === 'sell' ? 'Gastos de la venta (€, opcional)' : 'Gastos de compra (€, opcional)'}
                <NumberInput value={fee} onChange={setFee} placeholder="0" />
              </label>
            </>
          )}

          {(kind === 'income' || kind === 'cost' || isCash) && (
            <label>
              {kind === 'income'
                ? isRe
                  ? 'Renta cobrada, bruta (€)'
                  : `Dividendo bruto (${curLabel})`
                : kind === 'cost'
                  ? 'Importe del gasto (€)'
                  : `Importe (${curLabel})`}
              <NumberInput value={amount} onChange={setAmount} autoFocus={!editing} />
              {kind === 'cost' && (
                <span className="field-hint">Reformas o mejoras: suben el coste del inmueble (y lo que se descuenta al venderlo).</span>
              )}
            </label>
          )}
          {kind === 'income' && (
            <label>
              Retención (opcional)
              <NumberInput value={withholding} onChange={setWithholding} placeholder="0" />
              <span className="field-hint">Lo que te quitaron en origen; cuenta para el informe de la renta.</span>
            </label>
          )}

          {usesCash && (
            <label>
              Ingresar el dinero en
              <select value={cashTo} onChange={(e) => setCashTo(e.target.value)}>
                <option value="">No ingresar (ya lo apunto yo)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency || 'EUR'})
                  </option>
                ))}
              </select>
              {!accounts.length && (
                <span className="field-hint">
                  Crea una cuenta de cash para que el dinero que cobras siga contando en tu patrimonio.
                </span>
              )}
            </label>
          )}

          {net != null && showNums && (
            <div className="op-total">
              {!isCash && kind === 'buy' && <>Pagas </>}
              {!isCash && kind === 'sell' && <>Cobras </>}
              {kind === 'income' && <>Cobras neto </>}
              {kind === 'cost' && <>Sumas al coste </>}
              {isCash && kind === 'buy' && <>Ingresas </>}
              {isCash && kind === 'sell' && <>Retiras </>}
              <strong>{fmtPrice(net, cur)}</strong>
              {cur !== 'EUR' && fxDay > 0 && <> (≈ {fmtEur(net * fxDay)} al cambio de ese día)</>}
              {isMarket && kind !== 'income' && nQty > 0 && <> · {fmtQty(nQty)} unidades</>}. Si no cuadra con la operación
              real, revisa los datos.
            </div>
          )}
          {err && <div className="form-err">{err}</div>}
          <button className="btn btn-primary" onClick={save}>
            {editing ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ValuationModal({ asset, onClose }) {
  const { mutate, notify } = useBoveda();
  useModal(onClose);
  const [date, setDate] = useState(todayStr());
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  function save() {
    const v = parseNum(value, { money: true });
    if (!(v > 0)) return setErr('Valor no válido.');
    if (!date || date > todayStr()) return setErr('Fecha no válida.');
    mutate((d) => {
      d.valuations.push({ id: crypto.randomUUID(), assetId: asset.id, date, value: v });
      d.valuations.sort((a, b) => (a.date < b.date ? -1 : 1));
      return d;
    });
    notify('Valoración guardada', { kind: 'ok' });
    onClose();
  }
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Nueva valoración">
        <div className="modal-head">
          <h2>Nueva valoración</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="form-block">
          <label>
            Fecha
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Valor estimado (€)
            <NumberInput value={value} onChange={setValue} autoFocus placeholder="250.000" />
            <span className="field-hint">Una tasación o lo que piden por pisos parecidos en tu zona.</span>
          </label>
          {err && <div className="form-err">{err}</div>}
          <button className="btn btn-primary" onClick={save}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children, cls = '', sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${cls}`}>{children}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function AssetDetail({ assetId, onBack }) {
  const { data, positions, privacy, mutate, notify, forgetPrices } = useBoveda();
  const [range, setRange] = useState('1y');
  const [modal, setModal] = useState(null); // {type:'tx', tx?} | {type:'val'}

  const pos = positions.find((p) => p.asset.id === assetId);
  const asset = pos?.asset;

  const candles = useMemo(() => {
    if (!data || !asset) return [];
    const all = weeklyFromPairs(assetDailyEurPairs(data, assetId));
    const cut = rangeCutoff(range);
    return cut ? all.filter((c) => c.time >= cut) : all;
  }, [data, asset, assetId, range]);

  const markers = useMemo(() => (data ? txMarkers(data, assetId) : []), [data, assetId]);

  // Deudas ligadas a este inmueble → equity = valor − capital pendiente.
  const linkedDebt = useMemo(() => {
    const linked = (data?.debts || []).filter((dd) => dd.linkedAssetId === assetId);
    if (!linked.length) return null;
    const ctx = { euribor: euriborMap(data.euriborCache) };
    return linked.reduce((s, dd) => s + loanState(dd, data.debtEvents, null, ctx).balance, 0);
  }, [data, assetId]);

  if (!asset) return null;
  const seg = SEGMENTS.find((s) => s.key === asset.type);
  const txs = sortTxs(data.transactions.filter((t) => t.assetId === assetId)).reverse();
  const vals = data.valuations.filter((v) => v.assetId === assetId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const isRe = asset.type === 'realestate';
  const isCash = asset.type === 'cash';
  const isMarket = !isRe && !isCash;
  const show = privacy === 'normal';
  const labels = KIND_LABEL[asset.type];

  function delTx(t) {
    const plan = planDeleteTx(data, t.id);
    if (plan.error) return notify(plan.error, { kind: 'error', ms: 7000 });
    const removed = plan.removed;
    mutate((d) => {
      d.transactions = d.transactions.filter((x) => !removed.some((r) => r.id === x.id));
      return d;
    });
    notify('Operación borrada', {
      undo: () =>
        mutate((d) => {
          for (const r of removed) if (!d.transactions.some((x) => x.id === r.id)) d.transactions.push(r);
          return d;
        }),
    });
  }
  function delValuation(v) {
    mutate((d) => {
      d.valuations = d.valuations.filter((x) => x.id !== v.id);
      return d;
    });
    notify('Valoración borrada', {
      undo: () =>
        mutate((d) => {
          if (!d.valuations.some((x) => x.id === v.id)) d.valuations.push(v);
          d.valuations.sort((a, b) => (a.date < b.date ? -1 : 1));
          return d;
        }),
    });
  }
  function delAsset() {
    if (!window.confirm(`¿Eliminar ${asset.name} con todas sus operaciones?`)) return;
    const plan = planDeleteAsset(data, assetId);
    if (!plan) return;
    mutate((d) => plan.apply(d));
    forgetPrices(assetId);
    notify(`${asset.name} eliminado`, { undo: () => mutate((d) => plan.undo(d)) });
    onBack();
  }

  function txDetail(t) {
    if (!show) return '•••';
    const cur = pos.cur;
    if (t.kind === 'income') {
      const g = incomeGross(t);
      return `${fmtPrice(g, cur)}${t.withholding ? ` · ret. ${fmtPrice(t.withholding, cur)}` : ''}`;
    }
    if (t.kind === 'cost') return fmtPrice(t.qty * t.price, cur);
    if (isCash) return fmtPrice(t.qty, cur);
    if (isRe) return `${fmtPrice(t.price, cur)}${t.fee ? ` · gastos ${fmtPrice(t.fee, cur)}` : ''}`;
    return `${fmtQty(t.qty)} × ${fmtPrice(t.price, cur)}${t.fee ? ` · com. ${fmtPrice(t.fee, cur)}` : ''}`;
  }
  function txLink(t) {
    if (t.linkedTo) {
      const src = data.transactions.find((x) => x.id === t.linkedTo);
      const sa = src && data.assets.find((a) => a.id === src.assetId);
      if (sa) return `De ${src.kind === 'income' ? 'un cobro de' : 'la venta de'} ${sa.symbol || sa.name}`;
    }
    if (t.cashTo) {
      const ca = data.assets.find((a) => a.id === t.cashTo);
      if (ca) return `Ingresado en ${ca.name}`;
    }
    return null;
  }

  const stats = pos.stats;
  const stale = isRe && pos.lastValuation && daysBetween(pos.lastValuation.date, todayStr()) >= 180;

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn-icon" aria-label="Volver" onClick={onBack}>
          <Icon name="back" />
        </button>
        <AssetAvatar asset={asset} color={seg?.color} size={40} />
        <div className="detail-titles">
          <div className="detail-title">{asset.symbol || asset.name}</div>
          <div className="detail-sub">
            {asset.name} · {seg?.label}
            {pos.cur !== 'EUR' && ` · opera en ${pos.cur}`}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="stat-hero">
          <div className="stat-label">{pos.closed ? 'Posición cerrada' : linkedDebt != null ? 'Valor de mercado' : 'Valor actual'}</div>
          <div className="stat-hero-value">{pos.closed ? (show ? moneySigned(pos.totalGainEur, privacy) : '•••') : money(pos.valueEur, privacy)}</div>
          {!isCash && !pos.closed && pos.pnl != null && privacy !== 'hidden' && (
            <div className={`stat-hero-sub ${pos.pnl >= 0 ? 'up' : 'down'}`}>
              {fmtPct(pos.pnlPct)}
              {show && <> · {moneySigned(pos.pnl, privacy)}</>} sin vender
            </div>
          )}
          {pos.closed && <div className="stat-hero-sub muted">Resultado total de la posición, ya vendida</div>}
        </div>
        <div className="stats-grid">
          {linkedDebt != null && !pos.closed && (
            <>
              <Stat label="Deuda pendiente" cls="down">
                −{money(linkedDebt, privacy)}
              </Stat>
              <Stat label="Lo que es tuyo" cls="up" sub="Valor menos deuda">
                {money((pos.valueEur ?? 0) - linkedDebt, privacy)}
              </Stat>
            </>
          )}
          {isMarket && !pos.closed && (
            <>
              <Stat label="Cantidad">{show ? fmtQty(pos.qty) : '•••'}</Stat>
              <Stat label="Precio medio">{show ? fmtPrice(pos.avgPrice, pos.cur) : '•••'}</Stat>
              <Stat
                label="Precio actual"
                sub={
                  pos.change24h != null ? (
                    <span className={pos.change24h >= 0 ? 'up' : 'down'}>{fmtPct(pos.change24h)} hoy</span>
                  ) : null
                }
              >
                {fmtPrice(pos.price, pos.priceCur)}
              </Stat>
            </>
          )}
          {isRe && !pos.closed && (
            <Stat label="Coste total" sub="Compra, gastos y reformas">
              {money(pos.costEur, privacy)}
            </Stat>
          )}
          {!isCash && Math.abs(pos.realizedEur ?? 0) > 0.005 && (
            <Stat label="Ganancia realizada" cls={pos.realizedEur >= 0 ? 'up' : 'down'} sub="De lo ya vendido">
              {show ? moneySigned(pos.realizedEur, privacy) : '•••'}
            </Stat>
          )}
          {!isCash && (pos.incomeEur ?? 0) > 0.005 && (
            <Stat label={isRe ? 'Rentas cobradas' : 'Dividendos cobrados'} cls="up" sub="Netos de retención">
              {show ? moneySigned(pos.incomeEur, privacy) : '•••'}
            </Stat>
          )}
          {!isCash && stats && privacy !== 'hidden' && (
            <Stat
              label={stats.irrPct != null ? 'Rentabilidad anual' : 'Rentabilidad'}
              cls={(stats.irrPct ?? stats.simplePct) >= 0 ? 'up' : 'down'}
              sub={stats.irrPct != null ? `TIR · ${fmtPct(stats.simplePct)} en total` : stats.irrFailed ? 'TIR no calculable: total sin anualizar' : 'Menos de un año: sin anualizar'}
            >
              {fmtPct(stats.irrPct ?? stats.simplePct)}
            </Stat>
          )}
        </div>
        {!isCash && sequenceBroken(data, assetId) && (
          <div className="chart-gap-warn">
            <Icon name="alert" size={14} /> Hay una venta de más cantidad de la que tenías en esa fecha: revisa las operaciones
            de abajo (las cifras de esta posición no serán exactas hasta corregirla).
          </div>
        )}
        {pos.missingFx && (
          <div className="chart-gap-warn">
            <Icon name="alert" size={14} /> Falta el tipo de cambio de alguna operación: los euros son aproximados hasta
            que se actualicen los precios.
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">{isRe || isCash ? 'Evolución del valor' : 'Precio en € · velas semanales'}</div>
        </div>
        <CandleChart candles={candles} markers={show ? markers : undefined} privacy={privacy} height={240} fitKey={range} />
        <div className="chart-foot">
          <div className="chart-legend">{isMarket && show && 'C = compra · V = venta'}</div>
          <RangePicker value={range} onChange={setRange} />
        </div>
      </section>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={() => setModal({ type: 'tx' })}>
          <Icon name="plus" size={18} /> {isCash ? 'Ingreso o retirada' : 'Añadir operación'}
        </button>
        {isRe && !pos.closed && (
          <button className="btn" onClick={() => setModal({ type: 'val' })}>
            <Icon name="home" size={18} /> Nueva valoración
          </button>
        )}
      </div>

      {isRe && (
        <section className="card">
          <div className="card-title">Valoraciones</div>
          {stale && (
            <div className="inline-note">
              <Icon name="info" size={14} /> La última es de {fmtAgo(pos.lastValuation.date)}: conviene actualizarla.
            </div>
          )}
          {vals.map((v) => (
            <div key={v.id} className="tx-row">
              <span className="tx-date">{fmtDate(v.date)}</span>
              <span className="tx-desc">Valoración</span>
              <span className="tx-amount">{money(v.value, privacy)}</span>
              <span className="tx-actions">
                <button className="btn-icon sm danger" aria-label="Borrar valoración" onClick={() => delValuation(v)}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
          ))}
          {!vals.length && <div className="muted">Sin valoraciones: se usa el precio de compra.</div>}
        </section>
      )}

      <section className="card">
        <div className="card-title">Operaciones</div>
        {txs.map((t) => {
          const link = txLink(t);
          const tone = t.kind === 'sell' ? 'down' : t.kind === 'cost' ? '' : 'up';
          return (
            <div key={t.id} className="tx-row">
              <span className="tx-date">{fmtDate(t.date)}</span>
              <span className="tx-main">
                <span className={`tx-desc ${tone}`}>{labels[t.kind] || t.kind}</span>
                {link && <span className="tx-link">{link}</span>}
              </span>
              <span className="tx-amount">{txDetail(t)}</span>
              <span className="tx-actions">
                {t.linkedTo ? (
                  <span className="tx-locked" title="Se gestiona desde la operación de origen">
                    <Icon name="lock" size={14} />
                  </span>
                ) : (
                  <>
                    <button className="btn-icon sm" aria-label="Editar operación" onClick={() => setModal({ type: 'tx', tx: t })}>
                      <Icon name="edit" size={16} />
                    </button>
                    <button className="btn-icon sm danger" aria-label="Borrar operación" onClick={() => delTx(t)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {!txs.length && <div className="muted">Sin operaciones.</div>}
      </section>

      <button className="btn btn-danger btn-block" onClick={delAsset}>
        <Icon name="trash" size={18} /> Eliminar activo
      </button>

      {modal?.type === 'tx' && (
        <TxModal
          asset={asset}
          tx={modal.tx}
          marketPrice={pos.priceCur === pos.cur ? pos.price : null}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'val' && <ValuationModal asset={asset} onClose={() => setModal(null)} />}
    </div>
  );
}
