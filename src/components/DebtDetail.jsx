import { useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { loanState, simulateExtra, todayStr } from '../lib/loan.js';
import { fmtEur, fmtPct, money } from '../lib/format.js';

const fmtMonths = (m) => {
  if (m <= 0) return '0 meses';
  const y = Math.floor(m / 12);
  const r = m % 12;
  if (!y) return `${r} ${r === 1 ? 'mes' : 'meses'}`;
  return r ? `${y} a ${r} m` : `${y} ${y === 1 ? 'año' : 'años'}`;
};

function RegisterModal({ debt, onClose }) {
  const { mutate } = useBoveda();
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('plazo');
  const [err, setErr] = useState('');
  function save() {
    const n = parseFloat(amount);
    if (!(n > 0)) return setErr('Importe no válido.');
    if (!date) return setErr('Falta la fecha.');
    mutate((d) => {
      d.debtEvents.push({ id: crypto.randomUUID(), debtId: debt.id, date, amount: n, mode });
      return d;
    });
    onClose();
  }
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Registrar amortización</h2>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className="form-block">
          <label>
            Fecha
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Importe (EUR)
            <input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="5000" />
          </label>
          <label>
            Qué elegiste en el banco
            <div className="seg-tabs">
              <button className={mode === 'plazo' ? 'chip chip-on' : 'chip'} onClick={() => setMode('plazo')}>Reducir plazo</button>
              <button className={mode === 'cuota' ? 'chip chip-on' : 'chip'} onClick={() => setMode('cuota')}>Reducir cuota</button>
            </div>
          </label>
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
        <span>Ahorras en intereses</span>
        <strong className="up">{money(sc.interestSaved, privacy)}</strong>
      </div>
      <div className="sim-line">
        <span>Terminas en</span>
        <strong>{sc.endDate?.slice(0, 7) ?? '—'}</strong>
      </div>
    </div>
  );
}

export default function DebtDetail({ debtId, onBack }) {
  const { data, privacy, mutate } = useBoveda();
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [modal, setModal] = useState(false);

  const debt = data.debts.find((d) => d.id === debtId);
  const events = useMemo(
    () => (data.debtEvents || []).filter((e) => e.debtId === debtId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [data, debtId]
  );
  const st = useMemo(() => (debt ? loanState(debt, data.debtEvents) : null), [data, debt]);

  // Ahorro real acumulado: cuadro actual vs cuadro sin amortizaciones.
  const realSavings = useMemo(() => {
    if (!debt || !events.length) return null;
    const sin = loanState(debt, []);
    return {
      interest: sin.totalInterest - st.totalInterest,
      months: sin.rows.filter((r) => r.kind === 'cuota').length - st.rows.filter((r) => r.kind === 'cuota').length,
    };
  }, [debt, events, st]);

  const nAmount = parseFloat(amount);
  const sim = useMemo(
    () => (debt && nAmount > 0 ? simulateExtra(debt, data.debtEvents, { amount: nAmount, recurring }) : null),
    [debt, data, nAmount, recurring]
  );
  const bestKey = sim ? (sim.plazo.interestSaved >= sim.cuota.interestSaved ? 'plazo' : 'cuota') : null;

  if (!debt || !st) return null;
  const linked = debt.linkedAssetId ? data.assets.find((a) => a.id === debt.linkedAssetId) : null;
  const futureRows = st.rows.filter((r) => r.date > todayStr());

  function delEvent(id) {
    mutate((d) => {
      d.debtEvents = d.debtEvents.filter((e) => e.id !== id);
      return d;
    });
  }
  function delDebt() {
    if (!window.confirm(`¿Eliminar ${debt.name} y su historial?`)) return;
    mutate((d) => {
      d.debts = d.debts.filter((x) => x.id !== debtId);
      d.debtEvents = d.debtEvents.filter((e) => e.debtId !== debtId);
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
            <span className="dot" style={{ background: '#e66767' }} /> {debt.name}
          </div>
          <div className="detail-sub">
            TIN {debt.rate.tin}% fijo · cuota el día {debt.paymentDay}
            {linked ? ` · ligado a ${linked.name}` : ''}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="detail-stats">
          <div>
            <div className="stat-label">Capital pendiente</div>
            <div className="stat-big down">−{money(st.balance, privacy)}</div>
          </div>
          <div>
            <div className="stat-label">Cuota</div>
            <div className="stat-mid">{st.currentPayment != null ? `${money(st.currentPayment, privacy)}/mes` : '—'}</div>
          </div>
          <div>
            <div className="stat-label">Te queda</div>
            <div className="stat-mid">{fmtMonths(st.remainingMonths)} · fin {st.endDate?.slice(0, 7)}</div>
          </div>
          <div>
            <div className="stat-label">Intereses restantes</div>
            <div className="stat-mid">{money(st.interestRemaining, privacy)}</div>
          </div>
        </div>
        <div className="debt-progress big" title={`${Math.round(st.progress * 100)}% amortizado desde el alta`}>
          <div style={{ width: `${Math.min(100, Math.round(st.progress * 100))}%` }} />
        </div>
        <div className="chart-note">
          {Math.round(st.progress * 100)}% amortizado desde el alta · próxima cuota el {st.nextPaymentDate}
        </div>
      </section>

      <section className="card sim-section">
        <div className="card-title">Simulador de amortización anticipada</div>
        <div className="sim-inputs">
          <input
            type="number"
            step="any"
            min="0"
            placeholder="¿Cuánto quieres amortizar? (EUR)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="seg-tabs">
            <button className={!recurring ? 'chip chip-on' : 'chip'} onClick={() => setRecurring(false)}>Aportación única</button>
            <button className={recurring ? 'chip chip-on' : 'chip'} onClick={() => setRecurring(true)}>Todos los meses</button>
          </div>
        </div>
        {sim ? (
          <>
            <div className="sim-grid">
              <ScenarioCard title="Reducir cuota" sc={sim.cuota} best={bestKey === 'cuota'} privacy={privacy} />
              <ScenarioCard title="Reducir plazo" sc={sim.plazo} best={bestKey === 'plazo'} privacy={privacy} />
            </div>
            <div className="chart-note">
              {recurring
                ? `Aportando ${fmtEur(nAmount)} extra cada mes desde ahora.`
                : `Aportación única de ${fmtEur(nAmount)} hoy.`}{' '}
              Sin tocar nada pagarías {money(st.interestRemaining, privacy)} de intereses hasta {st.endDate?.slice(0, 7)}.
            </div>
          </>
        ) : (
          <div className="muted">Escribe un importe y compara qué te conviene más.</div>
        )}
      </section>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={() => setModal(true)}>Registrar amortización real</button>
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
              <span className="tx-date">{e.date}</span>
              <span className="tx-desc">{e.mode === 'plazo' ? 'Reducir plazo' : 'Reducir cuota'}</span>
              <span className="tx-amount">{money(e.amount, privacy)}</span>
              <button className="btn-icon danger" aria-label="Borrar amortización" onClick={() => delEvent(e.id)}>🗑</button>
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
                      <td>{r.date}</td>
                      <td colSpan={3}>Amortización anticipada de {privacy === 'normal' ? fmtEur(r.extra) : '•••'}</td>
                      <td>{privacy === 'normal' ? fmtEur(r.balance) : '•••'}</td>
                    </tr>
                  ) : (
                    <tr key={i} className={r.date > todayStr() ? '' : 'schedule-past'}>
                      <td>{r.n}</td>
                      <td>{r.date}</td>
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

      <button className="btn btn-danger" onClick={delDebt}>Eliminar préstamo</button>

      {modal && <RegisterModal debt={debt} onClose={() => setModal(false)} />}
    </div>
  );
}
