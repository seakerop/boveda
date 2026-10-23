import { useEffect, useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import {
  assetDailyEurPairs,
  portfolioSummary,
  SEGMENTS,
  seriesGaps,
  weeklyCandles,
  weeklyLine,
} from '../lib/portfolio.js';
import { euriborMap, loanState } from '../lib/loan.js';
import { fmtEur, fmtPct, money, moneySigned } from '../lib/format.js';
import { fmtAgo, fmtMonthYear } from '../lib/dates.js';
import CandleChart, { LINE, RangePicker, rangeCutoff } from './CandleChart.jsx';
import Donut from './Donut.jsx';
import Sparkline from './Sparkline.jsx';
import Notices, { useNotices } from './Notices.jsx';
import Icon, { AssetAvatar } from './Icon.jsx';
import { planSaveTx } from '../lib/ops.js';

const SEG_COLOR = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.color]));
const LINE_KEY = { total: 'line', crypto: 'c_crypto', stock: 'c_stock', realestate: 'c_realestate' };
const VALUE_KEY = { total: 'net', crypto: 'crypto', stock: 'stock', realestate: 'realestate', cash: 'cash' };

function DeltaChip({ label, pct, eur, privacy }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const cls = pct >= 0 ? 'delta delta-up' : 'delta delta-down';
  return (
    <span className={cls}>
      <span className="delta-label">{label}</span> {fmtPct(pct)}
      {privacy === 'normal' && eur != null && <span className="delta-eur"> · {moneySigned(eur, privacy)}</span>}
    </span>
  );
}

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function agoLabel(ts, now) {
  if (!ts) return null;
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)} h`;
}

function subtitle(p) {
  const a = p.asset;
  if (a.type === 'realestate') {
    return p.lastValuation ? `Valorado ${fmtAgo(p.lastValuation.date)}` : 'A precio de compra';
  }
  if (a.type === 'cash') return `Cuenta en ${a.currency || 'EUR'}`;
  return a.name;
}

function PositionRow({ p, total, privacy, spark, onOpen }) {
  const seg = SEG_COLOR[p.asset.type];
  const manual = p.asset.type === 'realestate' || p.asset.type === 'cash';
  return (
    <button className="pos-row" onClick={onOpen}>
      <AssetAvatar asset={p.asset} color={seg} />
      <div className="pos-name">
        <div className="pos-symbol">{manual ? p.asset.name : p.asset.symbol || p.asset.name}</div>
        <div className="pos-sub">{subtitle(p)}</div>
      </div>
      <Sparkline pairs={spark} />
      <div className="pos-right">
        <div className="pos-value">
          {privacy === 'percent' ? fmtPct(total > 0 ? ((p.valueEur ?? 0) / total) * 100 : 0, false) : money(p.valueEur, privacy)}
        </div>
        {privacy !== 'hidden' && p.pnlPct != null && (
          <div className={p.pnl >= 0 ? 'pos-pnl up' : 'pos-pnl down'}>{fmtPct(p.pnlPct)}</div>
        )}
      </div>
    </button>
  );
}

export default function Dashboard({ onOpenAsset, onOpenDebt, onOpenTax, onOpenSettings, onAdd }) {
  const { data, positions, series, privacy, refreshing, lastRefresh, marketErrors, doRefresh, exportBackup, notify, mutate } =
    useBoveda();
  const [tab, setTab] = useState('total');
  const [range, setRange] = useState('1y');
  const [showClosed, setShowClosed] = useState(false);
  const now = useNow();

  const open = positions.filter((p) => !p.closed);
  const closed = positions.filter((p) => p.closed);
  const total = open.reduce((s, p) => s + (p.valueEur ?? 0), 0);
  const summary = useMemo(() => portfolioSummary(positions), [positions]);

  const debtStates = useMemo(() => {
    const ctx = { euribor: euriborMap(data?.euriborCache) };
    return (data?.debts || []).map((debt) => ({ debt, st: loanState(debt, data.debtEvents, null, ctx) }));
  }, [data]);
  const debtTotal = debtStates.reduce((s, x) => s + x.st.balance, 0);
  const net = total - debtTotal;
  const notices = useNotices(positions, debtStates);

  const deltas = useMemo(() => {
    const n = series.length;
    const val = (back) => (n > back ? series[n - 1 - back].net : null);
    const cur = val(0);
    const mk = (prev) =>
      prev != null && Math.abs(prev) > 0.005 && cur != null ? { pct: ((cur - prev) / Math.abs(prev)) * 100, eur: cur - prev } : {};
    return { d1: mk(val(1)), d7: mk(val(7)) };
  }, [series]);

  const cut = rangeCutoff(range);
  const candles = useMemo(() => {
    const all = weeklyCandles(series, VALUE_KEY[tab]);
    return cut ? all.filter((c) => c.time >= cut) : all;
  }, [series, tab, cut]);
  const lineData = useMemo(() => {
    if (!LINE_KEY[tab]) return null;
    const all = weeklyLine(series, LINE_KEY[tab]);
    return cut ? all.filter((c) => c.time >= cut) : all;
  }, [series, tab, cut]);
  const lastRow = series[series.length - 1];
  const gapNow = lastRow && LINE_KEY[tab] ? lastRow[VALUE_KEY[tab]] - lastRow[LINE_KEY[tab]] : null;

  const gaps = useMemo(() => (data ? seriesGaps(data) : []), [data]);

  // Últimos 30 días de cada activo para las sparklines de las filas.
  const sparkData = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(open.map((p) => [p.asset.id, assetDailyEurPairs(data, p.asset.id).slice(-30)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, positions]);

  const segTotals = SEGMENTS.map((s) => ({
    ...s,
    value: open.filter((p) => p.asset.type === s.key).reduce((a, p) => a + Math.max(p.valueEur ?? 0, 0), 0),
  }));

  const grouped = SEGMENTS.map((s) => ({ seg: s, items: open.filter((p) => p.asset.type === s.key) })).filter(
    (g) => g.items.length
  );

  async function onNoticeAction(action) {
    if (action === 'backup') {
      try {
        const r = await exportBackup();
        if (r.ok) notify(r.shared ? 'Backup compartido' : 'Backup descargado', { kind: 'ok' });
      } catch (e) {
        notify(String(e.message || e), { kind: 'error' });
      }
    } else if (action.startsWith('debt:')) onOpenDebt(action.slice(5));
    else if (action.startsWith('asset:')) onOpenAsset(action.slice(6));
    else if (action.startsWith('split:')) {
      const [, assetId, date, from, to] = action.split(':');
      const t = { id: crypto.randomUUID(), assetId, kind: 'split', date, splitFrom: Number(from), splitTo: Number(to) };
      const plan = planSaveTx(data, t, null);
      if (plan.error) return notify(plan.error, { kind: 'error', ms: 7000 });
      mutate((d) => {
        d.transactions = plan.transactions;
        return d;
      });
      notify('Desdoblamiento apuntado', {
        kind: 'ok',
        undo: () =>
          mutate((d) => {
            d.transactions = d.transactions.filter((x) => x.id !== t.id);
            return d;
          }),
      });
    }
  }

  const stats = summary.stats;
  const hasInvest = positions.some((p) => p.asset.type !== 'cash' && p.flows.length);
  const ago = agoLabel(lastRefresh, now);

  return (
    <div className="dashboard">
      <section className="card total-card">
        <div className="total-top">
          <div className="total-label">Patrimonio neto</div>
          <button
            className="total-updated"
            onClick={doRefresh}
            disabled={refreshing}
            title={ago ? `Precios actualizados ${ago}. Pulsa para actualizar` : "Actualizar precios"}
          >
            <Icon name="refresh" size={13} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Actualizando…' : ago || 'Sin actualizar'}
          </button>
        </div>
        <div className="total-value">
          {privacy === 'hidden' ? '•••••' : privacy === 'percent' ? '100%' : money(net, privacy)}
        </div>
        {privacy === 'normal' && debtTotal > 0 && (
          <div className="net-breakdown">
            Activos {fmtEur(total)} <span className="sep">·</span> Deudas <span className="down">−{fmtEur(debtTotal)}</span>
          </div>
        )}
        {privacy !== 'hidden' && (
          <div className="deltas">
            <DeltaChip label="24h" pct={deltas.d1.pct} eur={deltas.d1.eur} privacy={privacy} />
            <DeltaChip label="7d" pct={deltas.d7.pct} eur={deltas.d7.eur} privacy={privacy} />
          </div>
        )}
        {privacy !== 'hidden' && hasInvest && (
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Ganancia de tus inversiones</div>
              <div className={`kpi-value ${!summary.complete ? '' : summary.gain < 0 ? 'down' : 'up'}`}>
                {!summary.complete
                  ? '—'
                  : privacy === 'normal'
                    ? moneySigned(summary.gain, privacy)
                    : fmtPct(stats?.simplePct)}
              </div>
              {privacy === 'normal' && stats && <div className="kpi-sub">{fmtPct(stats.simplePct)} sobre lo invertido</div>}
            </div>
            <div className="kpi">
              <div className="kpi-label">Rentabilidad anual</div>
              <div className={`kpi-value ${stats?.irrPct == null ? '' : stats.irrPct < 0 ? 'down' : 'up'}`}>
                {stats?.irrPct != null ? fmtPct(stats.irrPct) : '—'}
              </div>
              <div className="kpi-sub">
                {stats?.irrPct != null ? 'TIR anualizada' : stats?.irrFailed ? 'No calculable con estos movimientos' : stats ? 'Disponible al cumplir un año' : ''}
              </div>
            </div>
          </div>
        )}
        {marketErrors.length > 0 && (
          <details className="market-warn">
            <summary>
              <Icon name="alert" size={14} /> Algunos precios no se pudieron actualizar
            </summary>
            <ul className="market-warn-list">
              {marketErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <button className="btn-text" onClick={doRefresh}>
              Reintentar
            </button>
          </details>
        )}
      </section>

      <Notices notices={notices} onAction={onNoticeAction} />

      <section className="card">
        <div className="card-head">
          <div className="seg-group seg-scroll" role="tablist" aria-label="Segmento">
            {[{ key: 'total', label: 'Total' }, ...SEGMENTS].map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={tab === s.key}
                className={tab === s.key ? 'seg seg-on' : 'seg'}
                onClick={() => setTab(s.key)}
              >
                {s.color && <span className="dot dot-sm" style={{ background: s.color }} />}
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <CandleChart candles={candles} lineData={lineData} privacy={privacy} height={260} fitKey={`${tab}-${range}`} />
        <div className="chart-foot">
          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-candle" aria-hidden="true" />
              {tab === 'total' ? 'Patrimonio neto' : SEGMENTS.find((s) => s.key === tab)?.label}
            </span>
            {lineData && privacy === 'normal' && (
              <span className="legend-item">
                <span className="legend-line" style={{ borderColor: LINE }} aria-hidden="true" />
                Dinero aportado
              </span>
            )}
          </div>
          <RangePicker value={range} onChange={setRange} />
        </div>
        {lineData && privacy === 'normal' && gapNow != null && candles.length > 0 && (
          <div className={`chart-gain ${gapNow >= 0 ? 'up' : 'down'}`}>
            La distancia entre las velas y la línea es lo que has {gapNow >= 0 ? 'ganado' : 'perdido'}:{' '}
            <strong>{moneySigned(gapNow, privacy)}</strong>
          </div>
        )}
        {gaps.length > 0 && (
          <div className="chart-gap-warn">
            <Icon name="alert" size={14} /> La gráfica aún no incluye: {gaps.map((g) => `${g.symbol} (${g.motivo})`).join(', ')}.{' '}
            <button className="btn-text" onClick={doRefresh}>
              Reintentar
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">Distribución</div>
          {!data.settings.targets && open.length > 0 && (
            <button className="btn-text" onClick={onOpenSettings}>
              <Icon name="target" size={14} /> Fijar objetivo
            </button>
          )}
        </div>
        <Donut
          segments={segTotals}
          privacy={privacy}
          targets={data.settings.targets}
          active={tab === 'total' ? null : tab}
          onPick={(k) => setTab(k)}
        />
      </section>

      <section className="positions">
        {grouped.map(({ seg, items }) => (
          <div key={seg.key} className="pos-group">
            <div className="pos-head">
              <span className="dot" style={{ background: seg.color }} />
              <span>{seg.label}</span>
              <span className="pos-head-total">
                {privacy === 'percent'
                  ? fmtPct(total > 0 ? (items.reduce((a, p) => a + (p.valueEur ?? 0), 0) / total) * 100 : 0, false)
                  : money(items.reduce((a, p) => a + (p.valueEur ?? 0), 0), privacy)}
              </span>
            </div>
            {items.map((p) => (
              <PositionRow
                key={p.asset.id}
                p={p}
                total={total}
                privacy={privacy}
                spark={sparkData[p.asset.id]}
                onOpen={() => onOpenAsset(p.asset.id)}
              />
            ))}
          </div>
        ))}

        {debtStates.length > 0 && (
          <div className="pos-group">
            <div className="pos-head">
              <span className="dot" style={{ background: 'var(--bad)' }} />
              <span>Deudas</span>
              <span className="pos-head-total down">
                {privacy === 'percent' ? '' : `−${money(debtTotal, privacy)}`}
              </span>
            </div>
            {debtStates.map(({ debt, st }) => (
              <button key={debt.id} className="pos-row" onClick={() => onOpenDebt(debt.id)}>
                <span className="avatar avatar-debt" aria-hidden="true">
                  <Icon name="bank" size={17} />
                </span>
                <div className="pos-name">
                  <div className="pos-symbol">{debt.name}</div>
                  <div className="pos-sub">
                    {st.currentPayment != null && privacy === 'normal'
                      ? `${fmtEur(st.currentPayment)}/mes · fin ${fmtMonthYear(st.endDate)}`
                      : `fin ${fmtMonthYear(st.endDate)}`}
                  </div>
                </div>
                <div
                  className="debt-progress"
                  title={privacy === 'hidden' ? undefined : `${Math.round(st.progress * 100)}% amortizado desde el alta`}
                >
                  <div style={{ width: privacy === 'hidden' ? 0 : `${Math.min(100, Math.round(st.progress * 100))}%` }} />
                </div>
                <div className="pos-right">
                  <div className="pos-value down">
                    {privacy === 'percent'
                      ? fmtPct(total > 0 ? (st.balance / total) * 100 : 0, false)
                      : `−${money(st.balance, privacy)}`}
                  </div>
                  {privacy !== 'hidden' && <div className="pos-pnl muted-num">{Math.round(st.progress * 100)}% pagado</div>}
                </div>
              </button>
            ))}
          </div>
        )}

        {closed.length > 0 && (
          <div className="pos-group">
            <button className="pos-head pos-head-btn" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
              <span className="dot" style={{ background: 'var(--muted)' }} />
              <span>Posiciones cerradas ({closed.length})</span>
              <Icon name="chevron" size={14} className={`chev ${showClosed ? 'chev-open' : ''}`} />
            </button>
            {showClosed &&
              closed.map((p) => (
                <button key={p.asset.id} className="pos-row pos-row-closed" onClick={() => onOpenAsset(p.asset.id)}>
                  <AssetAvatar asset={p.asset} color={SEG_COLOR[p.asset.type]} />
                  <div className="pos-name">
                    <div className="pos-symbol">{p.asset.symbol || p.asset.name}</div>
                    <div className="pos-sub">Vendida · resultado realizado</div>
                  </div>
                  <div className="pos-right">
                    <div className={`pos-value ${(p.totalGainEur ?? 0) >= 0 ? 'up' : 'down'}`}>
                      {privacy === 'normal'
                        ? moneySigned(p.totalGainEur, privacy)
                        : privacy === 'percent' && p.stats
                          ? fmtPct(p.stats.simplePct)
                          : '•••'}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        )}

        {!positions.length && !debtStates.length && (
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="lock" size={28} />
            </div>
            <p>Tu bóveda está vacía</p>
            <p className="empty-sub">Añade tu primera inversión, cuenta o hipoteca con el botón +</p>
          </div>
        )}
      </section>

      <div className="dash-links">
        <button className="link-tile" onClick={onOpenTax}>
          <Icon name="report" size={18} />
          <span>
            <strong>Informe para la renta</strong>
            <small>Ganancias por FIFO y dividendos, por año</small>
          </span>
          <Icon name="chevron" size={16} className="link-chev" />
        </button>
      </div>

      <p className="dash-foot">
        Datos cifrados solo en este dispositivo · Precios de Yahoo Finance, CoinGecko y el BCE · Gráficas de{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™
        </a>
      </p>

      <button className="fab" aria-label="Añadir activo" onClick={onAdd}>
        <Icon name="plus" size={26} strokeWidth={2.2} />
      </button>
    </div>
  );
}
