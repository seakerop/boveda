// Formateo consciente del modo de privacidad:
//  normal   → cifras reales
//  hidden   → ••••• (nada absoluto ni relativo salvo estructura)
//  percent  → oculta absolutos, muestra porcentajes

const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 8 });

export const HIDDEN = '•••••';

export function fmtEur(v) {
  if (v == null) return '—';
  return Math.abs(v) >= 1000 ? eur0.format(v) : eur2.format(v);
}

export function money(v, mode) {
  if (mode === 'hidden' || mode === 'percent') return HIDDEN;
  return fmtEur(v);
}

export function fmtPct(v, signed = true) {
  if (v == null) return '—';
  return `${signed && v > 0 ? '+' : ''}${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })}%`;
}

export function fmtQty(v) {
  if (v == null) return '—';
  return num.format(v);
}

export function fmtPrice(v, cur = 'EUR') {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: v >= 1 ? 2 : 6,
    }).format(v);
  } catch {
    return `${num.format(v)} ${cur}`;
  }
}

// Formateador del eje de precios de las gráficas.
export function axisFormatter(v) {
  if (Math.abs(v) >= 1000) return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(v);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}
