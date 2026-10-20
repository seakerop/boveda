import { fmtCompactEur, fmtPct, money } from '../lib/format.js';

// Donut SVG de distribución por segmento, con hueco entre arcos y leyenda con
// etiquetas directas — la identidad nunca depende solo del color. Si hay reparto
// objetivo, cada fila enseña cuánto te desvías de él.
export default function Donut({ segments, privacy, onPick, active, targets }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = 3;
  let acc = 0;
  const visible = segments.filter((s) => s.value > 0);
  const hasTargets = targets && Object.values(targets).some((v) => v > 0);
  // En modo oculto, ni el reparto: el anillo queda neutro y la leyenda sin números.
  const hide = privacy === 'hidden';
  return (
    <div className="donut-row">
      <svg viewBox="0 0 140 140" className="donut" aria-hidden="true">
        <circle r={R} cx={70} cy={70} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={14} />
        <g transform="rotate(-90 70 70)">
          {total > 0 &&
            !hide &&
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
                  strokeLinecap="butt"
                  style={{ cursor: 'pointer', transition: 'stroke-width .15s' }}
                  onClick={() => onPick?.(s.key)}
                />
              );
            })}
        </g>
        <text x="70" y="68" textAnchor="middle" className="donut-center">
          {privacy === 'normal' ? fmtCompactEur(total) : privacy === 'percent' ? '100%' : '•••'}
        </text>
        <text x="70" y="84" textAnchor="middle" className="donut-center-sub">
          activos
        </text>
      </svg>
      <div className="donut-legend">
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          const target = hasTargets ? targets[s.key] || 0 : null;
          const dev = target != null ? pct - target : null;
          const off = dev != null && Math.abs(dev) >= 5;
          return (
            <button
              key={s.key}
              className={`legend-row ${active === s.key ? 'legend-on' : ''}`}
              onClick={() => onPick?.(s.key)}
            >
              <span className="dot" style={{ background: s.color }} />
              <span className="legend-label">
                {s.label}
                {target != null && !hide && <span className="legend-target">objetivo {fmtPct(target, false)}</span>}
              </span>
              <span className="legend-nums">
                <span className="legend-pct">{hide ? '•••' : fmtPct(pct, false)}</span>
                {dev != null && privacy !== 'hidden' && (
                  <span className={`legend-dev ${off ? 'legend-dev-off' : ''}`}>
                    {Math.abs(dev) < 0.5 ? 'en objetivo' : `${dev > 0 ? '+' : '−'}${Math.abs(dev).toFixed(1).replace('.', ',')} pp`}
                  </span>
                )}
                {privacy === 'normal' && dev == null && <span className="legend-val">{money(s.value, privacy)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
