import { useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { assetDailyEurPairs, txMarkers, weeklyFromPairs, SEGMENTS } from '../lib/portfolio.js';
import { euriborMap, loanState } from '../lib/loan.js';
import { fmtEur, fmtPct, fmtPrice, fmtQty, money } from '../lib/format.js';
import { todayStr } from '../lib/prices.js';
import CandleChart, { RangePicker, rangeCutoff } from './CandleChart.jsx';

function TxModal({ asset, onClose }) {
  const { mutate } = useBoveda();
  const isCash = asset.type === 'cash';
  const isRe = asset.type === 'realestate';
  const [kind, setKind] = useState('buy');
  const [date, setDate] = useState(todayStr());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [err, setErr] = useState('');

  function save() {
    const nQty = parseFloat(qty);
    const nPrice = isCash ? 1 : parseFloat(price);
    if (!(nQty > 0)) return setErr(isCash ? 'Importe no válido.' : 'Cantidad no válida.');
    if (!isCash && !(nPrice > 0)) return setErr('Precio no válido.');
    if (!date) return setErr('Falta la fecha.');
    mutate((d) => {
      d.transactions.push({
        id: crypto.randomUUID(),
        assetId: asset.id,
        kind,
        date,
        qty: nQty,
        price: nPrice,
        fee: fee ? parseFloat(fee) : 0,
      });
      return d;
    });
    onClose();
  }

  const buyLabel = isCash ? 'Ingreso' : 'Compra';
  const sellLabel = isCash ? 'Retirada' : 'Venta';
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Nueva operación</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className="form-block">
          <div className="seg-tabs">
            <button className={kind === 'buy' ? 'chip chip-on' : 'chip'} onClick={() => setKind('buy')}>{buyLabel}</button>
            <button className={kind === 'sell' ? 'chip chip-on' : 'chip'} onClick={() => setKind('sell')}>{sellLabel}</button>
          </div>
          <label>
            Fecha
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {isCash ? `Importe (${asset.currency || 'EUR'})` : isRe ? 'Importe (EUR)' : 'Cantidad'}
            <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </label>
          {!isCash && !isRe && (
            <label>
              Precio por unidad
              <input type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          )}
          {isRe && (
            <label>
              Precio
              <input type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          )}
          <label>
            Comisión (opcional)
            <input type="number" step="any" min="0" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          {!isCash && !isRe && parseFloat(qty) > 0 && parseFloat(price) > 0 && (
            <div className="op-total">
              Vas a registrar una {kind === 'buy' ? 'compra' : 'venta'} de{' '}
              <strong>{fmtEur(parseFloat(qty) * parseFloat(price) + (parseFloat(fee) || 0))}</strong> —{' '}
              {parseFloat(qty)} unidades. Si no cuadra con la operación real, revisa cantidad y precio.
            </div>
          )}
          {err && <div className="form-err">{err}</div>}
          <button className="btn btn-primary" onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function ValuationModal({ asset, onClose }) {
  const { mutate } = useBoveda();
  const [date, setDate] = useState(todayStr());
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  function save() {
    const v = parseFloat(value);
    if (!(v > 0)) return setErr('Valor no válido.');
    mutate((d) => {
      d.valuations.push({ id: crypto.randomUUID(), assetId: asset.id, date, value: v });
      d.valuations.sort((a, b) => (a.date < b.date ? -1 : 1));
      return d;
    });
    onClose();
  }
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Nueva valoración</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className="form-block">
          <label>
            Fecha
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Valor estimado (EUR)
            <input type="number" step="any" min="0" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
          {err && <div className="form-err">{err}</div>}
          <button className="btn btn-primary" onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

export default function AssetDetail({ assetId, onBack }) {
  const { data, positions, privacy, mutate } = useBoveda();
  const [range, setRange] = useState('1y');
  const [modal, setModal] = useState(null); // 'tx' | 'val'

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
  const txs = data.transactions.filter((t) => t.assetId === assetId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const vals = data.valuations.filter((v) => v.assetId === assetId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const isManual = asset.type === 'realestate';
  const isCash = asset.type === 'cash';

  function delTx(id) {
    mutate((d) => {
      d.transactions = d.transactions.filter((t) => t.id !== id);
      return d;
    });
  }
  function delValuation(id) {
    mutate((d) => {
      d.valuations = d.valuations.filter((v) => v.id !== id);
      return d;
    });
  }
  function delAsset() {
    if (!window.confirm(`¿Eliminar ${asset.name} y todas sus operaciones?`)) return;
    mutate((d) => {
      d.assets = d.assets.filter((a) => a.id !== assetId);
      d.transactions = d.transactions.filter((t) => t.assetId !== assetId);
      d.valuations = d.valuations.filter((v) => v.assetId !== assetId);
      delete d.priceCache[assetId];
      return d;
    });
    onBack();
  }

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn-icon" aria-label="Volver" onClick={onBack}>←</button>
        <div>
          <div className="detail-title">
            <span className="dot" style={{ background: seg?.color }} /> {asset.symbol || asset.name}
          </div>
          <div className="detail-sub">{asset.name} · {seg?.label}</div>
        </div>
      </div>

      <section className="card">
        <div className="detail-stats">
          <div>
            <div className="stat-label">{linkedDebt != null ? 'Valor de mercado' : 'Valor'}</div>
            <div className="stat-big">{money(pos.valueEur, privacy)}</div>
          </div>
          {linkedDebt != null && (
            <>
              <div>
                <div className="stat-label">Deuda pendiente</div>
                <div className="stat-big down">−{money(linkedDebt, privacy)}</div>
              </div>
              <div>
                <div className="stat-label">Equity (tuyo de verdad)</div>
                <div className="stat-big up">{money((pos.valueEur ?? 0) - linkedDebt, privacy)}</div>
              </div>
            </>
          )}
          {!isCash && (
            <div>
              <div className="stat-label">P&L</div>
              <div className={`stat-big ${pos.pnl >= 0 ? 'up' : 'down'}`}>
                {privacy === 'hidden' ? '•••' : fmtPct(pos.pnlPct)}
                {privacy === 'normal' && pos.pnl != null && <span className="stat-sub"> {money(pos.pnl, privacy)}</span>}
              </div>
            </div>
          )}
          {!isManual && !isCash && (
            <>
              <div>
                <div className="stat-label">Cantidad</div>
                <div className="stat-mid">{privacy === 'normal' ? fmtQty(pos.qty) : '•••'}</div>
              </div>
              <div>
                <div className="stat-label">Precio actual</div>
                <div className="stat-mid">
                  {fmtPrice(pos.price, pos.priceCur)}
                  {pos.change24h != null && (
                    <span className={pos.change24h >= 0 ? 'up' : 'down'}> {fmtPct(pos.change24h)}</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">{isManual || isCash ? 'Evolución del valor' : 'Precio (EUR) · velas semanales'}</div>
          <RangePicker value={range} onChange={setRange} />
        </div>
        <CandleChart candles={candles} markers={privacy === 'normal' ? markers : []} privacy={privacy} height={240} />
      </section>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={() => setModal('tx')}>
          {isCash ? 'Ingreso / retirada' : 'Añadir operación'}
        </button>
        {isManual && (
          <button className="btn" onClick={() => setModal('val')}>Añadir valoración</button>
        )}
      </div>

      {isManual && vals.length > 0 && (
        <section className="card">
          <div className="card-title">Valoraciones</div>
          {vals.map((v) => (
            <div key={v.id} className="tx-row">
              <span className="tx-date">{v.date}</span>
              <span className="tx-desc">Valoración</span>
              <span className="tx-amount">{money(v.value, privacy)}</span>
              <button className="btn-icon danger" aria-label="Borrar valoración" onClick={() => delValuation(v.id)}>🗑</button>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-title">Operaciones</div>
        {txs.map((t) => (
          <div key={t.id} className="tx-row">
            <span className="tx-date">{t.date}</span>
            <span className={`tx-desc ${t.kind === 'buy' ? 'up' : 'down'}`}>
              {t.kind === 'buy' ? (isCash ? 'Ingreso' : 'Compra') : isCash ? 'Retirada' : 'Venta'}
            </span>
            <span className="tx-amount">
              {privacy === 'normal'
                ? isCash || isManual
                  ? money(t.qty * t.price + (t.fee || 0), privacy)
                  : `${fmtQty(t.qty)} × ${fmtPrice(t.price, pos.priceCur)}`
                : '•••'}
            </span>
            <button className="btn-icon danger" aria-label="Borrar operación" onClick={() => delTx(t.id)}>🗑</button>
          </div>
        ))}
        {!txs.length && <div className="muted">Sin operaciones.</div>}
      </section>

      <button className="btn btn-danger" onClick={delAsset}>Eliminar activo</button>

      {modal === 'tx' && <TxModal asset={asset} onClose={() => setModal(null)} />}
      {modal === 'val' && <ValuationModal asset={asset} onClose={() => setModal(null)} />}
    </div>
  );
}
