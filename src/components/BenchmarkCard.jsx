import { useEffect, useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { BENCHMARKS } from '../lib/prices.js';
import { benchmarkCompare } from '../lib/portfolio.js';
import { fmtDate } from '../lib/dates.js';
import { fmtEur, fmtPct, fmtSignedEur } from '../lib/format.js';

// "¿Y si cada euro lo hubieras metido el mismo día en un índice?" Se carga al
// pedirlo (el histórico del índice es una descarga aparte) y queda en caché.
export default function BenchmarkCard() {
  const { data, positions, privacy, loadBenchmark } = useBoveda();
  const [symbol, setSymbol] = useState(BENCHMARKS[0].symbol);
  const [state, setState] = useState('idle'); // idle | loading | error
  const [attempt, setAttempt] = useState(0);
  const [err, setErr] = useState('');
  const hasFinancial = positions.some(
    (p) => (p.asset.type === 'crypto' || p.asset.type === 'stock') && p.flows.length
  );
  const cached = data.benchCache?.[symbol];

  useEffect(() => {
    if (!hasFinancial || cached) return;
    let alive = true;
    setState('loading');
    setErr('');
    loadBenchmark(symbol)
      .then(() => alive && setState('idle'))
      .catch((e) => {
        if (!alive) return;
        setState('error');
        setErr(String(e.message || e));
      });
    return () => {
      alive = false;
    };
  }, [symbol, hasFinancial, cached, loadBenchmark, attempt]);

  const cmp = useMemo(
    () => (cached ? benchmarkCompare(positions, cached.daily, cached.currency, data.fxCache) : null),
    [cached, positions, data.fxCache]
  );

  if (!hasFinancial) return null;
  const label = BENCHMARKS.find((b) => b.symbol === symbol)?.label;
  const diff = cmp ? cmp.actual - cmp.benchValue : null;
  const pct = cmp && cmp.benchValue > 0 ? (diff / cmp.benchValue) * 100 : null;
  const beat = diff != null && diff >= 0;

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">¿Y si lo hubieras metido en un índice?</div>
      </div>
      <div className="seg-group" role="tablist" aria-label="Índice">
        {BENCHMARKS.map((b) => (
          <button
            key={b.symbol}
            role="tab"
            aria-selected={symbol === b.symbol}
            className={symbol === b.symbol ? 'seg seg-on' : 'seg'}
            onClick={() => setSymbol(b.symbol)}
          >
            {b.label}
          </button>
        ))}
      </div>
      {state === 'loading' && !cmp && <div className="muted bench-pad">Descargando el histórico de {label}…</div>}
      {state === 'error' && !cmp && (
        <div className="form-err bench-pad">
          No se pudo descargar {label} ({err}).{' '}
          <button className="btn-text" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      )}
      {cached && !cmp && state !== 'loading' && (
        <div className="muted bench-pad">
          Aún no puedo comparar con {label}: falta el cambio de divisa o algún precio. Prueba tras actualizar los precios.
        </div>
      )}
      {cmp && (
        <div className="bench">
          <div className="bench-cols">
            <div>
              <div className="stat-label">Tu cripto y bolsa</div>
              <div className="stat-mid">{privacy === 'normal' ? fmtEur(cmp.actual) : '•••'}</div>
            </div>
            <div>
              <div className="stat-label">Con {label}</div>
              <div className="stat-mid">{privacy === 'normal' ? fmtEur(cmp.benchValue) : '•••'}</div>
            </div>
          </div>
          {privacy !== 'hidden' && cmp.benchValue > 0 && (
            <p className={`bench-verdict ${beat ? 'up' : 'down'}`}>
              {beat ? 'Vas por delante' : 'Vas por detrás'} de {label}
              {privacy === 'normal' ? ` por ${fmtSignedEur(diff).replace(/^[+−]/, '')}` : ''} ({fmtPct(pct)}).
            </p>
          )}
          {privacy !== 'hidden' && cmp.benchValue <= 0 && (
            <p className="bench-verdict up">
              Has batido a {label} de largo: con el índice no habrías podido sacar todo el dinero que has sacado.
            </p>
          )}
          <p className="muted">
            Mismas aportaciones y retiradas, los mismos días, desde el {fmtDate(cmp.since)}. Inmuebles y cash
            no entran.{cmp.early ? ' Hay compras anteriores al histórico del índice: se aproximan con su primer precio.' : ''}
          </p>
        </div>
      )}
    </section>
  );
}
