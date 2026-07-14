import { useEffect, useRef, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { currentPrice, searchCrypto, searchStock, todayStr } from '../lib/prices.js';
import { fmtEur } from '../lib/format.js';
import { frenchPayment } from '../lib/loan.js';

const TYPES = [
  { key: 'crypto', label: 'Cripto', emoji: '🪙', hint: 'BTC, ETH… precios de CoinGecko' },
  { key: 'stock', label: 'Bolsa', emoji: '📈', hint: 'Acciones y ETFs, precios de Yahoo' },
  { key: 'realestate', label: 'Inmueble', emoji: '🏠', hint: 'Valoración manual en EUR' },
  { key: 'cash', label: 'Cash', emoji: '💶', hint: 'Cuentas y efectivo' },
  { key: 'debt', label: 'Préstamo', emoji: '🏦', hint: 'Hipoteca, coche, personal…' },
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

export default function AddAsset({ onClose }) {
  const { mutate, data } = useBoveda();
  const [type, setType] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null); // resultado de búsqueda o {manual}
  const [err, setErr] = useState('');
  const timer = useRef(null);

  // Campos del formulario final
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [date, setDate] = useState(todayStr());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
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
      setSearching(true);
      setErr('');
      try {
        const r = type === 'crypto' ? await searchCrypto(query.trim()) : await searchStock(query.trim());
        setResults(r);
      } catch (e) {
        setErr('Error buscando: ' + String(e.message || e));
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [query, type]);

  function reset() {
    setPicked(null);
    setQuery('');
    setResults([]);
    setErr('');
    setPrice('');
    setPriceCur('');
  }

  const [priceCur, setPriceCur] = useState('');

  // Al elegir un activo, pre-rellenar el precio con la cotización actual
  // (editable: si la compra fue en otra fecha, pon el precio de aquel día).
  function pick(r) {
    setPicked(r);
    currentPrice(r)
      .then((q) => {
        if (q.price != null) {
          setPrice(String(q.price));
          setPriceCur(q.currency);
        }
      })
      .catch(() => {});
  }

  function save() {
    setErr('');
    const nQty = parseFloat(qty);
    const nPrice = parseFloat(price);
    const nFee = fee ? parseFloat(fee) : 0;
    const isMarket = type === 'crypto' || type === 'stock';

    if (type === 'cash') {
      if (!name.trim()) return setErr('Ponle un nombre a la cuenta.');
      if (!(nQty > 0)) return setErr('Importe inicial no válido.');
    } else if (type === 'realestate') {
      if (!name.trim()) return setErr('Ponle un nombre al inmueble.');
      if (!(nPrice > 0)) return setErr('Precio de compra no válido.');
    } else {
      if (!picked) return setErr('Busca y elige un activo.');
      if (!(nQty > 0)) return setErr('Cantidad no válida.');
      if (!(nPrice > 0)) return setErr('Precio no válido.');
    }
    if (!date) return setErr('Falta la fecha.');

    const assetId = crypto.randomUUID();
    const asset = {
      id: assetId,
      type,
      name: isMarket ? picked.name : name.trim(),
      symbol: isMarket ? picked.symbol : name.trim().slice(0, 14),
      cgId: picked?.cgId,
      ySymbol: picked?.ySymbol,
      currency: type === 'cash' ? currency : type === 'realestate' ? 'EUR' : undefined,
    };
    const tx = {
      id: crypto.randomUUID(),
      assetId,
      kind: 'buy',
      date,
      qty: type === 'realestate' ? 1 : nQty,
      price: type === 'cash' ? 1 : type === 'realestate' ? nPrice : nPrice,
      fee: nFee,
    };
    const nVal = valuation ? parseFloat(valuation) : null;
    mutate((d) => {
      d.assets.push(asset);
      d.transactions.push(tx);
      if (type === 'realestate' && nVal > 0) {
        d.valuations.push({ id: crypto.randomUUID(), assetId, date: todayStr(), value: nVal });
      }
      return d;
    });
    onClose();
  }

  function saveDebt() {
    setErr('');
    const nPrincipal = parseFloat(qty);
    const nTin = parseFloat(tin);
    const nSpread = parseFloat(spread);
    const termMonths = (parseInt(years || '0', 10) || 0) * 12 + (parseInt(months || '0', 10) || 0);
    const nDay = parseInt(payDay, 10);
    const isVar = rateType === 'variable';
    if (!name.trim()) return setErr('Ponle un nombre al préstamo.');
    if (!(nPrincipal > 0)) return setErr('Capital pendiente no válido.');
    if (!(nTin >= 0)) return setErr(isVar ? 'Tipo aplicado actual no válido (mira tu última revisión).' : 'TIN no válido.');
    if (isVar && !(nSpread >= 0)) return setErr('Diferencial no válido.');
    if (isVar && !/^\d{4}-\d{2}$/.test(nextReview)) return setErr('Falta el mes de la próxima revisión.');
    if (!(termMonths > 0)) return setErr('Plazo restante no válido.');
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
    onClose();
  }

  const isMarket = type === 'crypto' || type === 'stock';
  const isDebt = type === 'debt';
  const showForm = type && !isDebt && (!isMarket || picked);
  const homes = (data?.assets || []).filter((a) => a.type === 'realestate');
  const debtTerm = (parseInt(years || '0', 10) || 0) * 12 + (parseInt(months || '0', 10) || 0);
  const debtPreview =
    parseFloat(qty) > 0 && parseFloat(tin) >= 0 && debtTerm > 0
      ? frenchPayment(parseFloat(qty), parseFloat(tin), debtTerm)
      : null;

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Añadir activo</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>

        {!type && (
          <div className="type-grid">
            {TYPES.map((t) => (
              <button key={t.key} className="type-card" onClick={() => setType(t.key)}>
                <span className="type-emoji">{t.emoji}</span>
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
            <button className="btn-link" onClick={() => setType(null)}>← Cambiar tipo</button>
          </div>
        )}

        {showForm && (
          <div className="form-block">
            {isMarket ? (
              <div className="picked-row">
                <strong>{picked.symbol}</strong> {picked.name}
                <button className="btn-link" onClick={reset}>cambiar</button>
              </div>
            ) : (
              <label>
                {type === 'cash' ? 'Nombre de la cuenta' : 'Nombre del inmueble'}
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'cash' ? 'Cuenta ING' : 'Piso Calle Mayor'} />
              </label>
            )}

            <label>
              Fecha de {type === 'cash' ? 'ingreso' : 'compra'}
              <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </label>

            {type === 'cash' && (
              <>
                <label>
                  Divisa
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Importe inicial
                  <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1000" />
                </label>
              </>
            )}

            {type === 'realestate' && (
              <>
                <label>
                  Precio de compra (EUR)
                  <input type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="200000" />
                </label>
                <label>
                  Gastos de compra (EUR, opcional)
                  <input type="number" step="any" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="20000" />
                </label>
                <label>
                  Valoración actual (EUR, opcional)
                  <input type="number" step="any" min="0" value={valuation} onChange={(e) => setValuation(e.target.value)} placeholder="230000" />
                </label>
              </>
            )}

            {isMarket && (
              <>
                <label>
                  Cantidad
                  <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.05" />
                </label>
                <label>
                  Precio por unidad ({priceCur || (type === 'crypto' ? 'EUR' : 'divisa del activo')})
                  <input type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="60000" />
                  <span className="field-hint">
                    Pre-rellenado con el precio de hoy — si compraste otro día, cámbialo por el precio de aquel día.
                  </span>
                </label>
                <label>
                  Comisión (opcional)
                  <input type="number" step="any" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="1.50" />
                </label>
              </>
            )}

            {isMarket && parseFloat(qty) > 0 && parseFloat(price) > 0 && (
              <div className="op-total">
                Vas a registrar una compra de{' '}
                <strong>
                  {fmtEur(parseFloat(qty) * parseFloat(price) + (parseFloat(fee) || 0))}
                  {priceCur && priceCur !== 'EUR' ? ` (${priceCur})` : ''}
                </strong>{' '}
                — {parseFloat(qty)} unidades. Si esa cifra no cuadra con lo que invertiste, revisa cantidad y precio.
              </div>
            )}
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary" onClick={save}>Guardar</button>
          </div>
        )}
        {isDebt && (
          <div className="form-block">
            <label>
              Nombre del préstamo
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Hipoteca casa" />
            </label>
            <label>
              Capital pendiente hoy (EUR)
              <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="142000" />
              <span className="field-hint">Lo que te queda por pagar ahora, no lo que pediste al principio.</span>
            </label>
            <label>
              Tipo de interés
              <div className="seg-tabs">
                <button type="button" className={rateType === 'fixed' ? 'chip chip-on' : 'chip'} onClick={() => setRateType('fixed')}>
                  Fijo
                </button>
                <button type="button" className={rateType === 'variable' ? 'chip chip-on' : 'chip'} onClick={() => setRateType('variable')}>
                  Variable (Euríbor + dif.)
                </button>
              </div>
            </label>
            <label>
              {rateType === 'variable' ? 'Tipo aplicado actual (% — está en tu última carta de revisión)' : 'TIN (% anual)'}
              <input type="number" step="any" min="0" value={tin} onChange={(e) => setTin(e.target.value)} placeholder={rateType === 'variable' ? '3.35' : '2.10'} />
            </label>
            {rateType === 'variable' && (
              <>
                <label>
                  Diferencial sobre el Euríbor 12M (%)
                  <input type="number" step="any" min="0" value={spread} onChange={(e) => setSpread(e.target.value)} placeholder="0.55" />
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
                <input type="number" min="0" max="40" value={years} onChange={(e) => setYears(e.target.value)} placeholder="22" />
              </label>
              <label>
                y meses
                <input type="number" min="0" max="11" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="6" />
              </label>
            </div>
            <label>
              Día del mes en que se cobra la cuota (1–28)
              <input type="number" min="1" max="28" value={payDay} onChange={(e) => setPayDay(e.target.value)} />
            </label>
            <label>
              Ligado a un inmueble
              <select value={linkedId} onChange={(e) => setLinkedId(e.target.value)}>
                <option value="">Ninguno</option>
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </label>
            {debtPreview != null && (
              <div className="op-total">
                Cuota resultante: <strong>{fmtEur(debtPreview)}/mes</strong> durante {debtTerm} meses.
                Si no coincide con tu cuota real, revisa capital, TIN o plazo.
              </div>
            )}
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary" onClick={saveDebt}>Guardar</button>
          </div>
        )}
        {type && !showForm && !isDebt && err && <div className="form-err">{err}</div>}
      </div>
    </div>
  );
}
