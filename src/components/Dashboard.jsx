import { useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { assetDailyEurPairs, SEGMENTS, seriesGaps, weeklyCandles } from '../lib/portfolio.js';
import { fmtPct, money } from '../lib/format.js';
import CandleChart, { RangePicker, rangeCutoff } from './CandleChart.jsx';
import Donut from './Donut.jsx';
import Sparkline from './Sparkline.jsx';

function DeltaChip({ label, pct, eur, privacy }) {
  if (pct == null) return null;
  const cls = pct >= 0 ? 'delta delta-up' : 'delta delta-down';
  return (
    <span className={cls}>
      <span className="delta-label">{label}</span> {fmtPct(pct)}
      {privacy === 'normal' && eur != null && <span className="delta-eur"> · {money(eur, privacy)}</span>}
    </span>
  );
}

export default function Dashboard({ onOpenAsset, onAdd }) {
  const { data, positions, series, privacy, refreshing, marketErrors, doRefresh } = useBoveda();
  const [tab, setTab] = useState('total');
  const [range, setRange] = useState('1y');

  const total = positions.reduce((s, p) => s + (p.valueEur ?? 0), 0);
  const costTotal = positions.reduce((s, p) => s + (p.costEur ?? 0), 0);
  const pnlTotal = total - costTotal;

  const deltas = useMemo(() => {
    const n = series.length;
    const val = (back) => (n > back ? series[n - 1 - back].total : null);
    const now = val(0);
    const mk = (prev) => (prev != null && prev > 0 && now != null ? { pct: ((now - prev) / prev) * 100, eur: now - prev } : {});
    return { d1: mk(val(1)), d7: mk(val(7)) };
  }, [series]);

  const candles = useMemo(() => {
    const all = weeklyCandles(series, tab);
    const cut = rangeCutoff(range);
    return cut ? all.filter((c) => c.time >= cut) : all;
  }, [series, tab, range]);

  const gaps = useMemo(() => (data ? seriesGaps(data) : []), [data]);

  // Últimos 30 días de cada activo para las sparklines de las filas.
  const sparkData = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(
      positions.map((p) => [p.asset.id, assetDailyEurPairs(data, p.asset.id).slice(-30)])
    );
  }, [data, positions]);

  const segTotals = SEGMENTS.map((s) => ({
    ...s,
    value: positions.filter((p) => p.asset.type === s.key).reduce((a, p) => a + (p.valueEur ?? 0), 0),
  }));

  const grouped = SEGMENTS.map((s) => ({
    seg: s,
    items: positions.filter((p) => p.asset.type === s.key),
  })).filter((g) => g.items.length);

  return (
    <div className="dashboard">
      <section className="card total-card">
        <div className="total-label">Patrimonio total</div>
        <div className="total-value">{privacy === 'hidden' ? '•••••' : privacy === 'percent' ? '100%' : money(total, privacy)}</div>
        {privacy !== 'hidden' && (
          <div className="deltas">
            <DeltaChip label="24h" pct={deltas.d1.pct} eur={deltas.d1.eur} privacy={privacy} />
            <DeltaChip label="7d" pct={deltas.d7.pct} eur={deltas.d7.eur} privacy={privacy} />
            <DeltaChip
              label="Total"
              pct={costTotal > 0 ? (pnlTotal / costTotal) * 100 : null}
              eur={pnlTotal}
              privacy={privacy}
            />
          </div>
        )}
        {marketErrors.length > 0 && (
          <details className="market-warn">
            <summary>
              ⚠ Algunos precios no se pudieron actualizar{' '}
              <button className="btn-link" onClick={(e) => { e.preventDefault(); doRefresh(); }}>
                reintentar
              </button>
            </summary>
            <ul className="market-warn-list">
              {marketErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="seg-tabs" role="tablist" aria-label="Segmento">
            {[{ key: 'total', label: 'Total' }, ...SEGMENTS].map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={tab === s.key}
                className={tab === s.key ? 'chip chip-on' : 'chip'}
                style={tab === s.key && s.color ? { borderColor: s.color, color: s.color } : undefined}
                onClick={() => setTab(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <RangePicker value={range} onChange={setRange} />
        </div>
        <CandleChart candles={candles} privacy={privacy} height={260} />
        <div className="chart-note">Velas semanales · {refreshing ? 'actualizando precios…' : 'EUR'}</div>
        {gaps.length > 0 && (
          <div className="chart-gap-warn">
            ⚠ La gráfica aún no incluye: {gaps.map((g) => `${g.symbol} (${g.motivo})`).join(', ')}.{' '}
            <button className="btn-link" onClick={doRefresh}>reintentar</button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">Distribución</div>
        <Donut segments={segTotals} privacy={privacy} active={tab === 'total' ? null : tab} onPick={(k) => setTab(k)} />
      </section>

      <section className="positions">
        {grouped.map(({ seg, items }) => (
          <div key={seg.key} className="pos-group">
            <div className="pos-head">
              <span className="dot" style={{ background: seg.color }} />
              <span>{seg.label}</span>
              <span className="pos-head-total">{money(items.reduce((a, p) => a + (p.valueEur ?? 0), 0), privacy)}</span>
            </div>
            {items.map((p) => (
              <button key={p.asset.id} className="pos-row" onClick={() => onOpenAsset(p.asset.id)}>
                <div className="pos-name">
                  <div className="pos-symbol">{p.asset.symbol || p.asset.name}</div>
                  <div className="pos-sub">{p.asset.name}</div>
                </div>
                <Sparkline pairs={sparkData[p.asset.id]} />
                <div className="pos-right">
                  <div className="pos-value">
                    {privacy === 'percent'
                      ? fmtPct(total > 0 ? ((p.valueEur ?? 0) / total) * 100 : 0, false)
                      : money(p.valueEur, privacy)}
                  </div>
                  {privacy !== 'hidden' && p.pnl != null && (
                    <div className={p.pnl >= 0 ? 'pos-pnl up' : 'pos-pnl down'}>{fmtPct(p.pnlPct)}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
        {!positions.length && (
          <div className="empty-state">
            <p>Tu bóveda está vacía.</p>
            <p className="empty-sub">Añade tu primera inversión con el botón +</p>
          </div>
        )}
      </section>

      <button className="fab" aria-label="Añadir activo" onClick={onAdd}>
        +
      </button>
    </div>
  );
}
