// Fechas como cadenas 'YYYY-MM-DD'. "Hoy" es el día LOCAL del usuario (en España,
// toISOString() daría todavía el día anterior entre medianoche y la 1-2 h).
// La aritmética de días se hace en UTC sobre la cadena, que no tiene huso.

const pad = (n) => String(n).padStart(2, '0');

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr, k) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

export function addMonthsStr(dateStr, k) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + k);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// '2026-03-15' → '15 mar 2026'
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// '2049-12-05' o '2049-12' → 'dic 2049'
export function fmtMonthYear(dateStr) {
  if (!dateStr) return '—';
  const [y, m] = dateStr.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// 'hace 3 días', 'hace 2 meses'… para avisos.
export function fmtAgo(dateStr, today = todayStr()) {
  const n = daysBetween(dateStr, today);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n < 45) return `hace ${n} días`;
  const m = Math.round(n / 30.44);
  if (m < 18) return `hace ${m} meses`;
  return `hace ${Math.round(n / 365.25)} años`;
}
