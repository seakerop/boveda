import { useEffect, useRef, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { currentPrice, searchCrypto, searchStock } from '../lib/prices.js';
import { fmtEur, fmtPrice, fmtQty, numToInput, parseNum, roundSig } from '../lib/format.js';
import { frenchPayment } from '../lib/loan.js';
import { fxAt, fxBase } from '../lib/ledger.js';
import { SEGMENTS } from '../lib/portfolio.js';
import { todayStr } from '../lib/dates.js';
import useModal from './useModal.js';
import Icon from './Icon.jsx';
import NumberInput from './NumberInput.jsx';

const SEG_COLOR = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.color]));

const TYPES = [
  { key: 'crypto', label: 'Cripto', icon: 'coins', hint: 'Bitcoin, Ethereum… precio automático' },
  { key: 'stock', label: 'Bolsa', icon: 'chart', hint: 'Acciones, ETF y fondos' },
  { key: 'realestate', label: 'Inmueble', icon: 'home', hint: 'Valoración manual' },
  { key: 'cash', label: 'Cash', icon: 'wallet', hint: 'Cuentas y efectivo' },
  { key: 'debt', label: 'Préstamo', icon: 'bank', hint: 'Hipoteca, coche, personal…' },
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

export default function AddAsset({ onClose }) {
  const { mutate, data, notify } = useBoveda();
  useModal(onClose);
  const [type, setType] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  // Respuestas lentas de una búsqueda o cotización anterior no deben pisar la actual.
  const searchSeq = useRef(0);
  const pickSeq = useRef(0);
  const [quoteState, setQuoteState] = useState('idle'); // idle | loading | ok | error

  // Campos del formulario final
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [date, setDate] = useState(todayStr());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [priceCur, setPriceCur] = useState('');
  const [fee, setFee] = useState('');
  const [valuation, setValuation] = useState('');

  // Campos de préstamo
  const [rateType, setRateType] = useState('fixed');
  const [tin, setTin] = useState('');
  const [spread, setSpread] = useState('');
  const [reviewMonths, setReviewMonths] = useState('12');
  const [nextReview, setNextReview] = useState('');
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [payDay, setPayDay] = useState('1');
  const [linkedId, setLinkedId] = useState('');

  useEffect(() => {
    if (!type || (type !== 'crypto' && type !== 'stock')) return;
    clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const seq = ++searchSeq.current;
      setSearching(true);
      setErr('');
      try {
        const r = type === 'crypto' ? await searchCrypto(query.trim()) : await searchStock(query.trim());
        if (seq === searchSeq.current) setResults(r);
      } catch (e) {
        if (seq === searchSeq.current) setErr('No se pudo buscar: ' + String(e.message || e));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [query, type]);

  function reset() {
    pickSeq.current++;
    setQuoteState('idle');
    setPicked(null);
    setQuery('');
    setResults([]);
    setErr('');
    setPrice('');
    setPriceCur('');
  }

  // Al elegir un activo, pre-rellenar el precio con la cotización actual
  // (editable: si la compra fue en otra fecha, pon el precio de aquel día).
  function pick(r) {
    const seq = ++pickSeq.current;
    setPicked(r);
    setQuoteState('loading');
    if (r.type === 'crypto') setPriceCur('EUR');
    currentPrice(r)
      .then((q) => {
        if (seq !== pickSeq.current) return;
        if (q.price != null) {
          setPrice(numToInput(roundSig(q.price)));
          setPriceCur(q.currency);
          setQuoteState('ok');
        } else setQuoteState('error');
      })
      .catch(() => seq === pickSeq.current && setQuoteState('error'));
  }

  const isMarket = type === 'crypto' || type === 'stock';
  const txCur = type === 'crypto' ? 'EUR' : type === 'stock' ? priceCur || '' : type === 'cash' ? currency : 'EUR';
  const fxDay =
    !txCur || txCur === 'EUR'
      ? 1
      : data.fxCache?.[fxBase(txCur).code]?.daily?.length
        ? fxAt(data.fxCache, txCur, date)
        : null;

  const nQty = parseNum(qty);
  const nPrice = parseNum(price, { money: true });
  const nFee = fee ? parseNum(fee, { money: true }) : 0;
  const nCash = parseNum(qty, { money: true });

  function save() {
    setErr('');
    const nVal = valuation ? parseNum(valuation, { money: true }) : null;

    if (type === 'cash') {
      if (!name.trim()) return setErr('Ponle un nombre a la cuenta.');
      if (!(nCash > 0)) return setErr('Importe inicial no válido.');
    } else if (type === 'realestate') {
      if (!name.trim()) return setErr('Ponle un nombre al inmueble.');
      if (!(nPrice > 0)) return setErr('Precio de compra no válido.');
      if (valuation && !(nVal > 0)) return setErr('Valoración no válida.');
    } else {
      if (!picked) return setErr('Busca y elige un activo.');
      if (type === 'stock' && !priceCur) return setErr('Elige la divisa en la que cotiza.');
      if (!(nQty > 0)) return setErr('Cantidad no válida.');
      if (!(nPrice > 0)) return setErr('Precio no válido.');
    }
    if (!(nFee >= 0)) return setErr('Comisión no válida.');
    if (!date || date > todayStr()) return setErr('Fecha no válida.');
    if (type === 'stock' && data.assets.some((a) => a.type === 'stock' && a.ySymbol === picked.ySymbol)) {
      return setErr(`Ya tienes ${picked.symbol}: añade la compra desde su ficha.`);
    }
    if (type === 'crypto' && data.assets.some((a) => a.type === 'crypto' && a.cgId === picked.cgId)) {
      return setErr(`Ya tienes ${picked.symbol}: añade la compra desde su ficha.`);
    }

    const assetId = crypto.randomUUID();
    const asset = {
      id: assetId,
      type,
      name: isMarket ? picked.name : name.trim(),
      symbol: isMarket ? picked.symbol : name.trim().slice(0, 14),
      ...(picked?.cgId ? { cgId: picked.cgId } : {}),
      ...(picked?.ySymbol ? { ySymbol: picked.ySymbol } : {}),
      ...(type === 'cash' ? { currency } : {}),
      ...(type === 'stock' && priceCur ? { currency: priceCur } : {}),
    };
    const tx = {
      id: crypto.randomUUID(),
      assetId,
      kind: 'buy',
      date,
      qty: type === 'realestate' ? 1 : type === 'cash' ? nCash : nQty,
      price: type === 'cash' ? 1 : nPrice,
      fee: type === 'cash' ? 0 : nFee,
      ...(txCur && txCur !== 'EUR' && fxDay > 0 && type !== 'cash' ? { fxRate: fxDay } : {}),
    };
    mutate((d) => {
      d.assets.push(asset);
      d.transactions.push(tx);
      if (type === 'realestate' && nVal > 0) {
        d.valuations.push({ id: crypto.randomUUID(), assetId, date: todayStr(), value: nVal });
      }
      return d;
    });
    notify(`${asset.name} añadido`, { kind: 'ok' });
    onClose();
  }

  function saveDebt() {
    setErr('');
    const nPrincipal = parseNum(qty, { money: true });
    const nTin = parseNum(tin);
    const nSpread = parseNum(spread);
    const termMonths = (parseInt(years || '0', 10) || 0) * 12 + (parseInt(months || '0', 10) || 0);
    const nDay = parseInt(payDay, 10);
    const isVar = rateType === 'variable';
    if (!name.trim()) return setErr('Ponle un nombre al préstamo.');
    if (!(nPrincipal > 0)) return setErr('Capital pendiente no válido.');
    if (!(nTin >= 0) || nTin > 30) return setErr(isVar ? 'Tipo aplicado actual no válido (mira tu última revisión).' : 'TIN no válido.');
    if (isVar && !(nSpread >= 0)) return setErr('Diferencial no válido.');
    if (isVar && !/^\d{4}-\d{2}$/.test(nextReview)) return setErr('Falta el mes de la próxima revisión.');
    if (isVar && nextReview < todayStr().slice(0, 7)) return setErr('La próxima revisión no puede estar en el pasado.');
    if (!(termMonths > 0) || termMonths > 600) return setErr('Plazo restante no válido.');
    if (!(nDay >= 1 && nDay <= 28)) return setErr('Día de cobro entre 1 y 28.');
    const rate = isVar
      ? {
          type: 'variable',
          index: 'euribor12m',
          spread: nSpread,
          reviewMonths: parseInt(reviewMonths, 10),
          nextReview: `${nextReview}-${String(nDay).padStart(2, '0')}`,
          currentRate: nTin,
        }
      : { type: 'fixed', tin: nTin };
    mutate((d) => {
      d.debts.push({
        id: crypto.randomUUID(),
        name: name.trim(),
        linkedAssetId: linkedId || null,
        principal: nPrincipal,
        startDate: todayStr(),
        termMonths,
        paymentDay: nDay,
        rate,
      });
      return d;
    });
    notify(`${name.trim()} añadido`, { kind: 'ok' });
    onClose();
  }

  const isDebt = type === 'debt';
  const showForm = type && !isDebt && (!isMarket || picked);
  const homes = (data?.assets || []).filter((a) => a.type === 'realestate');
  const debtTerm = (parseInt(years || '0', 10) || 0) * 12 + (parseInt(months || '0', 10) || 0);
  const pPrincipal = parseNum(qty, { money: true });
  const pTin = parseNum(tin);
  const debtPreview = pPrincipal > 0 && pTin >= 0 && debtTerm > 0 ? frenchPayment(pPrincipal, pTin, debtTerm) : null;
  const typeInfo = TYPES.find((t) => t.key === type);
  const curLabel = !txCur ? 'divisa del activo' : txCur === 'EUR' ? '€' : txCur === 'GBp' || txCur === 'GBX' ? 'peniques, GBp' : txCur;

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Añadir">
        <div className="modal-head">
          {type ? (
            <button className="btn-icon" aria-label="Cambiar tipo" onClick={() => { setType(null); reset(); }}>
              <Icon name="back" />
            </button>
          ) : null}
          <h2>{typeInfo ? `Añadir ${typeInfo.label.toLowerCase()}` : 'Añadir'}</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        {!type && (
          <div className="type-grid">
            {TYPES.map((t) => (
              <button
                key={t.key}
                className="type-card"
                style={{ '--seg': t.key === 'debt' ? 'var(--bad)' : SEG_COLOR[t.key] }}
                onClick={() => setType(t.key)}
              >
                <span className="type-icon">
                  <Icon name={t.icon} size={20} />
                </span>
                <span className="type-label">{t.label}</span>
                <span className="type-hint">{t.hint}</span>
              </button>
            ))}
          </div>
        )}

        {isMarket && !picked && (
          <div className="search-block">
            <input
              autoFocus
              placeholder={type === 'crypto' ? 'Busca: bitcoin, ethereum…' : 'Busca: Apple, MSCI World, TEF.MC…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar activo"
            />
            {searching && <div className="muted">Buscando…</div>}
            <div className="search-results">
              {results.map((r) => (
                <button key={(r.cgId || r.ySymbol) + r.symbol} className="search-row" onClick={() => pick(r)}>
                  <span className="search-sym">{r.symbol}</span>
                  <span className="search-name">{r.name}</span>
                  <span className="search-detail">{r.detail}</span>
                </button>
              ))}
            </div>
            {err && <div className="form-err">{err}</div>}
          </div>
        )}

        {showForm && (
          <div className="form-block">
            {isMarket ? (
              <div className="picked-row">
                <strong>{picked.symbol}</strong> <span className="search-name">{picked.name}</span>
                <button className="btn-text" onClick={reset}>
                  Cambiar
                </button>
              </div>
            ) : (
              <label>
                {type === 'cash' ? 'Nombre de la cuenta' : 'Nombre del inmueble'}
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={type === 'cash' ? 'Cuenta ING' : 'Piso Calle Mayor'}
                />
              </label>
            )}

            <label>
              Fecha de {type === 'cash' ? 'apertura' : 'compra'}
              <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </label>

            {type === 'cash' && (
              <div className="field-pair">
                <label>
                  Divisa
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Saldo inicial
                  <NumberInput value={qty} onChange={setQty} placeholder="1.000" />
                </label>
              </div>
            )}

            {type === 'realestate' && (
              <>
                <label>
                  Precio de compra (€)
                  <NumberInput value={price} onChange={setPrice} placeholder="200.000" />
                </label>
                <label>
                  Gastos de compra (€, opcional)
                  <NumberInput value={fee} onChange={setFee} placeholder="20.000" />
                  <span className="field-hint">Impuestos, notaría, registro, gestoría: suman al coste.</span>
                </label>
                <label>
                  Valoración actual (€, opcional)
                  <NumberInput value={valuation} onChange={setValuation} placeholder="230.000" />
                </label>
              </>
            )}

            {isMarket && (
              <>
                {type === 'stock' && quoteState === 'error' && (
                  <label>
                    Divisa en la que cotiza
                    <select value={priceCur} onChange={(e) => setPriceCur(e.target.value)}>
                      <option value="">Elige…</option>
                      {['EUR', 'USD', 'GBP', 'GBp', 'CHF', 'CAD', 'JPY'].map((c) => (
                        <option key={c} value={c}>
                          {c === 'GBp' ? 'GBp (peniques, Londres)' : c}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">No he podido consultar la cotización: dime en qué moneda está el precio.</span>
                  </label>
                )}
                <label>
                  Cantidad
                  <NumberInput value={qty} onChange={setQty} placeholder="0,05" />
                </label>
                <label>
                  Precio por unidad ({curLabel})
                  <NumberInput value={price} onChange={setPrice} placeholder="60.000" />
                  {quoteState === 'ok' && (
                    <span className="field-hint">Prerrellenado con el precio de hoy. Si compraste otro día, pon el de aquel día.</span>
                  )}
                  {quoteState === 'loading' && <span className="field-hint">Consultando el precio de hoy…</span>}
                </label>
                <label>
                  Comisión ({curLabel}, opcional)
                  <NumberInput value={fee} onChange={setFee} placeholder="1,50" />
                </label>
              </>
            )}

            {isMarket && nQty > 0 && nPrice > 0 && (
              <div className="op-total">
                Vas a registrar una compra de{' '}
                <strong>{fmtPrice(nQty * nPrice + (nFee || 0), txCur || 'EUR')}</strong>
                {txCur && txCur !== 'EUR' && fxDay > 0 && <> (≈ {fmtEur((nQty * nPrice + (nFee || 0)) * fxDay)})</>} por{' '}
                {fmtQty(nQty)} unidades. Si esa cifra no cuadra con lo que invertiste, revisa cantidad y precio.
              </div>
            )}
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary" onClick={save}>
              Guardar
            </button>
          </div>
        )}
        {isDebt && (
          <div className="form-block">
            <label>
              Nombre del préstamo
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Hipoteca casa" />
            </label>
            <label>
              Capital pendiente hoy (€)
              <NumberInput value={qty} onChange={setQty} placeholder="142.000" />
              <span className="field-hint">Lo que te queda por pagar ahora, no lo que pediste al principio.</span>
            </label>
            <div className="field-group">
              <span className="field-label">Tipo de interés</span>
              <div className="seg-group seg-full">
                <button
                  type="button"
                  className={rateType === 'fixed' ? 'seg seg-on' : 'seg'}
                  aria-pressed={rateType === 'fixed'}
                  onClick={() => setRateType('fixed')}
                >
                  Fijo
                </button>
                <button
                  type="button"
                  className={rateType === 'variable' ? 'seg seg-on' : 'seg'}
                  aria-pressed={rateType === 'variable'}
                  onClick={() => setRateType('variable')}
                >
                  Variable (euríbor)
                </button>
              </div>
            </div>
            <label>
              {rateType === 'variable' ? 'Tipo aplicado actual (%, está en tu última carta de revisión)' : 'TIN (% anual)'}
              <NumberInput value={tin} onChange={setTin} placeholder={rateType === 'variable' ? '3,35' : '2,10'} suffix="%" />
            </label>
            {rateType === 'variable' && (
              <>
                <label>
                  Diferencial sobre el euríbor 12M
                  <NumberInput value={spread} onChange={setSpread} placeholder="0,55" suffix="%" />
                </label>
                <div className="field-pair">
                  <label>
                    Revisión cada
                    <select value={reviewMonths} onChange={(e) => setReviewMonths(e.target.value)}>
                      <option value="6">6 meses</option>
                      <option value="12">12 meses</option>
                    </select>
                  </label>
                  <label>
                    Próxima revisión
                    <input type="month" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />
                  </label>
                </div>
              </>
            )}
            <div className="field-pair">
              <label>
                Plazo restante: años
                <input type="number" min="0" max="40" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} placeholder="22" />
              </label>
              <label>
                y meses
                <input type="number" min="0" max="11" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="6" />
              </label>
            </div>
            <label>
              Día del mes en que se cobra la cuota (1–28)
              <input type="number" min="1" max="28" inputMode="numeric" value={payDay} onChange={(e) => setPayDay(e.target.value)} />
            </label>
            <label>
              Ligado a un inmueble
              <select value={linkedId} onChange={(e) => setLinkedId(e.target.value)}>
                <option value="">Ninguno</option>
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            {debtPreview != null && (
              <div className="op-total">
                Cuota resultante: <strong>{fmtEur(debtPreview)}/mes</strong> durante {debtTerm} meses. Si no coincide con
                tu cuota real, revisa capital, TIN o plazo.
              </div>
            )}
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary" onClick={saveDebt}>
              Guardar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
