// Mini-gráfica de tendencia (últimos 30 días) para las filas de posiciones.
// Solo enseña la forma — ningún valor absoluto — así que es compatible con
// todos los modos de privacidad.
export default function Sparkline({ pairs, width = 68, height = 28 }) {
  const vals = (pairs || []).map((p) => p[1]).filter((v) => v != null);
  if (vals.length < 2) return <div className="spark spark-empty" style={{ width, height }} />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i / (vals.length - 1)) * (width - 2) + 1;
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? 'var(--good)' : 'var(--bad)';
  const area = `1,${height - 1} ${pts} ${width - 1},${height - 1}`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
