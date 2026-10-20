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

// Siempre con céntimos (informes fiscales): 14.766,60 €
export function fmtEurCents(v, signed = false) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = eur2.format(Math.abs(v));
  if (Math.abs(v) < 0.005) return s;
  if (v < 0) return `−${s}`;
  return signed ? `+${s}` : s;
}

// Con signo explícito: +1.234 € / −56,20 € (menos tipográfico, no guion).
export function fmtSignedEur(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = fmtEur(Math.abs(v));
  if (Math.abs(v) < 0.005) return s;
  return v > 0 ? `+${s}` : `−${s}`;
}

export function moneySigned(v, mode) {
  if (mode === 'hidden' || mode === 'percent') return HIDDEN;
  return fmtSignedEur(v);
}

export function fmtPct(v, signed = true) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.abs(v) < 0.005 ? 0 : v;
  const s = Math.abs(r).toLocaleString('es-ES', { maximumFractionDigits: Math.abs(r) >= 100 ? 0 : 2 });
  if (!signed) return `${r < 0 ? '−' : ''}${s}%`;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${s}%`;
}

// Tipo de interés: 3,85 %
export function fmtRate(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

export function fmtCompactEur(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} €`;
}

export function fmtQty(v) {
  if (v == null) return '—';
  return num.format(v);
}

// Yahoo da algunos mercados en centésimas (GBp = peniques).
const SUB_UNIT_LABEL = { GBp: 'p', GBX: 'p', ZAc: 'c ZAR', ILA: 'ag ILS' };

export function fmtPrice(v, cur = 'EUR') {
  if (v == null) return '—';
  if (SUB_UNIT_LABEL[cur]) return `${num.format(Math.round(v * 100) / 100)} ${SUB_UNIT_LABEL[cur]}`;
  try {
    const abs = Math.abs(v);
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: cur,
      // Criptos de céntimos de céntimo: cifras significativas, no decimales fijos.
      ...(abs > 0 && abs < 0.01 ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: abs >= 1 ? 2 : 6 }),
    }).format(v);
  } catch {
    return `${num.format(v)} ${cur}`;
  }
}

// Número escrito por el usuario: acepta coma o punto decimal ("0,05", "1.234,56").
// Con un solo separador se toma como decimal (1.5 BTC no es 15 BTC), salvo en
// importes (money): ahí "200.000" son doscientos mil, como se escribe en España.
export function parseNum(s, { money = false } = {}) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/[\s€$£]/g, '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.')) {
    // Con los dos separadores, el último es el decimal: "1.234,56" (español) o
    // "1,234.56" (inglés, pegado de un extracto).
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (money && /^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return parseFloat(t);
}

// Para precargar un número en un campo de texto, en formato español sin miles y
// sin notación científica (0,00000012 y no 1,2e-7, que luego no se podría leer).
export function numToInput(v) {
  if (v == null || !Number.isFinite(+v)) return '';
  const x = +v;
  if (x === 0) return '0';
  const decimals = Math.min(20, Math.max(0, 12 - Math.ceil(Math.log10(Math.abs(x)))));
  return x.toFixed(decimals).replace(/\.?0+$/, '').replace('.', ',');
}

// Redondeo a cifras significativas (para precios de criptos de céntimos de céntimo).
export const roundSig = (v, sig = 10) => (v ? Number(v.toPrecision(sig)) : v);

// Formateador del eje de precios de las gráficas.
export function axisFormatter(v) {
  if (Math.abs(v) >= 1000) return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(v);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}
