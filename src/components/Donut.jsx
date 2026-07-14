import { fmtPct, money } from '../lib/format.js';

const compactEur = (v) =>
  `${new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} €`;

// Donut SVG de distribución por segmento, con hueco de 2px entre arcos
// (regla de spacers) y leyenda con etiquetas directas — la identidad nunca
// depende solo del color.
export default function Donut({ segments, privacy, onPick, active }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = 3;
  let acc = 0;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className="donut-row">
      <svg viewBox="0 0 140 140" className="donut" aria-hidden="true">
        <g transform="rotate(-90 70 70)">
          {total > 0 ? (
            visible.map((s) => {
              const frac = s.value / total;
              const len = Math.max(frac * C - (visible.length > 1 ? GAP : 0), 0.6);
              const off = -acc * C;
              acc += frac;
              return (
                <circle
                  key={s.key}
                  r={R}
                  cx={70}
                  cy={70}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={active === s.key ? 18 : 14}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={off}
                  style={{ cursor: 'pointer', transition: 'stroke-width .15s' }}
                  onClick={() => onPick?.(s.key)}
                />
              );
            })
          ) : (
            <circle r={R} cx={70} cy={70} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={14} />
          )}
        </g>
        <text x="70" y="66" textAnchor="middle" className="donut-center">
          {privacy === 'normal' ? compactEur(total) : privacy === 'percent' ? '100%' : '•••'}
        </text>
        <text x="70" y="82" textAnchor="middle" className="donut-center-sub">
          patrimonio
        </text>
      </svg>
      <div className="donut-legend">
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <button key={s.key} className={`legend-row ${active === s.key ? 'legend-on' : ''}`} onClick={() => onPick?.(s.key)}>
              <span className="dot" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <span className="legend-pct">{fmtPct(pct, false)}</span>
              {privacy === 'normal' && <span className="legend-val">{money(s.value, privacy)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
