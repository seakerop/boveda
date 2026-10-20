import { useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { euriborMap, loanState, paymentBeforeReview, simulateExtra, todayStr } from '../lib/loan.js';
import { fmtEur, fmtRate, money, moneySigned, parseNum } from '../lib/format.js';
import { fmtDate, fmtMonthYear } from '../lib/dates.js';
import useModal from './useModal.js';
import Icon from './Icon.jsx';
import NumberInput from './NumberInput.jsx';

const fmtMonths = (m) => {
  if (m <= 0) return '0 meses';
  const y = Math.floor(m / 12);
  const r = m % 12;
  if (!y) return `${r} ${r === 1 ? 'mes' : 'meses'}`;
  const years = `${y} ${y === 1 ? 'año' : 'años'}`;
  return r ? `${years} y ${r} ${r === 1 ? 'mes' : 'meses'}` : years;
};

function RegisterModal({ debt, onClose }) {
  const { data, mutate, notify } = useBoveda();
  useModal(onClose);
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('plazo');
  const [err, setErr] = useState('');
  function save() {
    const n = parseNum(amount, { money: true });
    if (!(n > 0)) return setErr('Importe no válido.');
    if (!date || date > todayStr()) return setErr('Fecha no válida.');
    if (date < debt.startDate) return setErr(`La fecha es anterior al alta del préstamo (${fmtDate(debt.startDate)}).`);
    const pending = loanState(debt, data.debtEvents, null, { euribor: euriborMap(data.euriborCache) }, date).balance;
    if (n > pending + 0.01) return setErr(`En esa fecha solo quedaban ${fmtEur(pending)} por pagar.`);
    mutate((d) => {
      d.debtEvents.push({ id: crypto.randomUUID(), debtId: debt.id, date, amount: n, mode });
      return d;
    });
    notify('Amortización registrada', { kind: 'ok' });
    onClose();
  }
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Registrar amortización">
        <div className="modal-head">
          <h2>Registrar amortización</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="form-block">
          <label>
            Fecha
            <input type="date" value={date} min={debt.startDate} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Importe (€)
            <NumberInput value={amount} onChange={setAmount} autoFocus placeholder="5.000" />
          </label>
          <div className="field-group">
            <span className="field-label">Qué elegiste en el banco</span>
            <div className="seg-group seg-full">
              <button className={mode === 'plazo' ? 'seg seg-on' : 'seg'} aria-pressed={mode === 'plazo'} onClick={() => setMode('plazo')}>
                Reducir plazo
              </button>
              <button className={mode === 'cuota' ? 'seg seg-on' : 'seg'} aria-pressed={mode === 'cuota'} onClick={() => setMode('cuota')}>
                Reducir cuota
              </button>
            </div>
          </div>
          {err && <div className="form-err">{err}</div>}
          <button className="btn btn-primary" onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({ title, sc, best, privacy }) {
  return (
    <div className={`sim-card ${best ? 'sim-best' : ''}`}>
      <div className="sim-title">
        {title} {best && <span className="sim-badge">mayor ahorro</span>}
      </div>
      <div className="sim-line">
        <span>Cuota</span>
        <strong>{sc.payment != null ? `${money(sc.payment, privacy)}/mes` : '—'}</strong>
      </div>
      <div className="sim-line">
        <span>Te quitas</span>
        <strong>{fmtMonths(sc.monthsSaved)}</strong>
      </div>
      <div className="sim-line">
        <span>Pagarás en intereses</span>
        <strong>{money(sc.interestToPay, privacy)}</strong>
      </div>
      <div className="sim-line">
        <span>Ahorras</span>
        <strong className="up">{money(sc.interestSaved, privacy)}</strong>
      </div>
      <div className="sim-line">
        <span>Terminas en</span>
        <strong>{fmtMonthYear(sc.endDate)}</strong>
      </div>
    </div>
  );
}

export default function DebtDetail({ debtId, onBack }) {
  const { data, privacy, mutate, notify } = useBoveda();
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [modal, setModal] = useState(false);

  const debt = data.debts.find((d) => d.id === debtId);
  const ctx = useMemo(() => ({ euribor: euriborMap(data.euriborCache) }), [data]);
  const events = useMemo(
    () => (data.debtEvents || []).filter((e) => e.debtId === debtId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [data, debtId]
  );
  const st = useMemo(() => (debt ? loanState(debt, data.debtEvents, null, ctx) : null), [data, debt, ctx]);

  // Ahorro real acumulado: cuadro actual vs cuadro sin amortizaciones.
  const realSavings = useMemo(() => {
    if (!debt || !events.length) return null;
    const sin = loanState(debt, [], null, ctx);
    return {
      interest: sin.totalInterest - st.totalInterest,
      months: sin.rows.filter((r) => r.kind === 'cuota').length - st.rows.filter((r) => r.kind === 'cuota').length,
    };
  }, [debt, events, st, ctx]);

  const nAmount = parseNum(amount, { money: true });
  const sim = useMemo(
    () => (debt && nAmount > 0 ? simulateExtra(debt, data.debtEvents, { amount: nAmount, recurring }, ctx) : null),
    [debt, data, nAmount, recurring, ctx]
  );
  const bestKey = sim ? (sim.plazo.interestSaved >= sim.cuota.interestSaved ? 'plazo' : 'cuota') : null;

  if (!debt || !st) return null;
  const linked = debt.linkedAssetId ? data.assets.find((a) => a.id === debt.linkedAssetId) : null;
  const hidePct = privacy === 'hidden';
  const before = st.nextReview ? paymentBeforeReview(st) : null;
  const reviewDiff = before != null ? st.nextReview.payment - before : null;
  const futureRows = st.rows.filter((r) => r.date > todayStr());

  function delEvent(ev) {
    mutate((d) => {
      d.debtEvents = d.debtEvents.filter((e) => e.id !== ev.id);
      return d;
    });
    notify('Amortización borrada', {
      undo: () =>
        mutate((d) => {
          if (!d.debtEvents.some((e) => e.id === ev.id)) d.debtEvents.push(ev);
          return d;
        }),
    });
  }
  function delDebt() {
    if (!window.confirm(`¿Eliminar ${debt.name} y su historial?`)) return;
    const removedEvents = data.debtEvents.filter((e) => e.debtId === debtId);
    mutate((d) => {
      d.debts = d.debts.filter((x) => x.id !== debtId);
      d.debtEvents = d.debtEvents.filter((e) => e.debtId !== debtId);
      return d;
    });
    notify(`${debt.name} eliminado`, {
      undo: () =>
        mutate((d) => {
          if (d.debts.some((x) => x.id === debtId)) return d;
          d.debts.push(debt);
          d.debtEvents.push(...removedEvents);
          return d;
        }),
    });
    onBack();
  }

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn-icon" aria-label="Volver" onClick={onBack}>
          <Icon name="back" />
        </button>
        <span className="avatar avatar-debt avatar-lg" aria-hidden="true">
          <Icon name="bank" size={19} />
        </span>
        <div className="detail-titles">
          <div className="detail-title">{debt.name}</div>
          <div className="detail-sub">
            {debt.rate.type === 'variable'
              ? `Euríbor 12M + ${fmtRate(debt.rate.spread)} · revisión cada ${debt.rate.reviewMonths} meses · tipo actual ${fmtRate(st.currentTin)}`
              : `TIN ${fmtRate(debt.rate.tin)} fijo`}
            {' · '}cuota el día {debt.paymentDay}
            {linked ? ` · ligado a ${linked.name}` : ''}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="stat-hero">
          <div className="stat-label">Capital pendiente</div>
          <div className="stat-hero-value down">−{money(st.balance, privacy)}</div>
        </div>
        <div className="stats-grid">
          <div className="stat">
            <div className="stat-label">Cuota</div>
            <div className="stat-value">{st.currentPayment != null ? `${money(st.currentPayment, privacy)}/mes` : '—'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Te queda</div>
            <div className="stat-value">{fmtMonths(st.remainingMonths)}</div>
            <div className="stat-sub">Fin en {fmtMonthYear(st.endDate)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Intereses por pagar</div>
            <div className="stat-value">{money(st.interestRemaining, privacy)}</div>
          </div>
        </div>
        <div className="debt-progress big" title={hidePct ? undefined : `${Math.round(st.progress * 100)}% amortizado desde el alta`}>
          <div style={{ width: hidePct ? 0 : `${Math.min(100, Math.round(st.progress * 100))}%` }} />
        </div>
        <div className="chart-note">
          {!hidePct && `${Math.round(st.progress * 100)}% amortizado desde el alta · `}próxima cuota el {fmtDate(st.nextPaymentDate)}
        </div>
        {debt.rate.type === 'variable' && st.nextReview && (
          <div className="op-total" style={{ marginTop: 12 }}>
            Próxima revisión el <strong>{fmtDate(st.nextReview.date)}</strong>: con el euríbor de hoy el tipo pasaría
            al <strong>{fmtRate(st.nextReview.tin)}</strong> y la cuota a{' '}
            <strong>{money(st.nextReview.payment, privacy)}/mes</strong>
            {reviewDiff != null && Math.abs(reviewDiff) >= 0.5 && privacy === 'normal' && (
              <span className={reviewDiff > 0 ? 'down' : 'up'}> ({moneySigned(reviewDiff, privacy)} al mes)</span>
            )}
            .
          </div>
        )}
      </section>

      <section className="card sim-section">
        <div className="card-title">Simulador de amortización anticipada</div>
        <div className="sim-inputs">
          <NumberInput
            placeholder="¿Cuánto quieres amortizar?"
            value={amount}
            onChange={setAmount}
            suffix="€"
            aria-label="Importe a amortizar"
          />
          <div className="seg-group seg-full">
            <button className={!recurring ? 'seg seg-on' : 'seg'} aria-pressed={!recurring} onClick={() => setRecurring(false)}>Aportación única</button>
            <button className={recurring ? 'seg seg-on' : 'seg'} aria-pressed={recurring} onClick={() => setRecurring(true)}>Todos los meses</button>
          </div>
        </div>
        {sim ? (
          <>
            <div className="sim-grid">
              <ScenarioCard title="Reducir cuota" sc={sim.cuota} best={bestKey === 'cuota'} privacy={privacy} />
              <ScenarioCard title="Reducir plazo" sc={sim.plazo} best={bestKey === 'plazo'} privacy={privacy} />
            </div>
            <div className="sim-note">
              {recurring ? (
                <>Aportando <strong>{money(nAmount, privacy)}</strong> extra cada mes desde ahora.</>
              ) : (
                <>Aportación única de <strong>{money(nAmount, privacy)}</strong> hoy.</>
              )}{' '}
              Para comparar: sin tocar nada pagarías{' '}
              <strong className="down">{money(st.interestRemaining, privacy)}</strong> de intereses y acabarías en{' '}
              <strong>{fmtMonthYear(st.endDate)}</strong>.
            </div>
          </>
        ) : (
          <div className="muted">Escribe un importe y compara qué te conviene más.</div>
        )}
      </section>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={() => setModal(true)}>
          <Icon name="plus" size={18} /> Registrar amortización real
        </button>
      </div>

      {events.length > 0 && (
        <section className="card">
          <div className="card-title">Amortizaciones hechas</div>
          {realSavings && (
            <div className="op-total" style={{ marginBottom: 10 }}>
              Con estas aportaciones ya has ahorrado{' '}
              <strong className="up">{money(realSavings.interest, privacy)}</strong> en intereses
              {realSavings.months > 0 && <> y te has quitado <strong>{fmtMonths(realSavings.months)}</strong></>}.
            </div>
          )}
          {events.map((e) => (
            <div key={e.id} className="tx-row">
              <span className="tx-date">{fmtDate(e.date)}</span>
              <span className="tx-main">
                <span className="tx-desc">{e.mode === 'plazo' ? 'Reducir plazo' : 'Reducir cuota'}</span>
              </span>
              <span className="tx-amount">{money(e.amount, privacy)}</span>
              <span className="tx-actions">
                <button className="btn-icon sm danger" aria-label="Borrar amortización" onClick={() => delEvent(e)}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <details>
          <summary className="card-title" style={{ cursor: 'pointer' }}>
            Cuadro de amortización ({futureRows.filter((r) => r.kind === 'cuota').length} cuotas restantes)
          </summary>
          <div className="table-scroll">
            <table className="schedule">
              <thead>
                <tr><th>#</th><th>Fecha</th><th>Cuota</th><th>Intereses</th><th>Capital</th><th>Pendiente</th></tr>
              </thead>
              <tbody>
                {st.rows.map((r, i) =>
                  r.kind === 'extra' ? (
                    <tr key={i} className="schedule-extra">
                      <td>★</td>
                      <td>{fmtDate(r.date)}</td>
                      <td colSpan={3}>Amortización anticipada de {privacy === 'normal' ? fmtEur(r.extra) : '•••'}</td>
                      <td>{privacy === 'normal' ? fmtEur(r.balance) : '•••'}</td>
                    </tr>
                  ) : r.kind === 'review' ? (
                    <tr key={i} className="schedule-review">
                      <td>↻</td>
                      <td>{fmtDate(r.date)}</td>
                      <td colSpan={3}>
                        Revisión: tipo {fmtRate(r.tin)} → cuota {privacy === 'normal' ? `${fmtEur(r.payment)}/mes` : '•••'}
                      </td>
                      <td>{privacy === 'normal' ? fmtEur(r.balance) : '•••'}</td>
                    </tr>
                  ) : (
                    <tr key={i} className={r.date > todayStr() ? '' : 'schedule-past'}>
                      <td>{r.n}</td>
                      <td>{fmtDate(r.date)}</td>
                      <td>{privacy === 'normal' ? fmtEur(r.payment) : '•••'}</td>
                      <td>{privacy === 'normal' ? fmtEur(r.interest) : '•••'}</td>
                      <td>{privacy === 'normal' ? fmtEur(r.principal + r.extra) : '•••'}</td>
                      <td>{privacy === 'normal' ? fmtEur(r.balance) : '•••'}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <button className="btn btn-danger btn-block" onClick={delDebt}>
        <Icon name="trash" size={18} /> Eliminar préstamo
      </button>

      {modal && <RegisterModal debt={debt} onClose={() => setModal(false)} />}
    </div>
  );
}
