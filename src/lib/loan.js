// Motor de préstamos (sistema francés). El cuadro de amortización nunca se
// persiste: se reconstruye desde el alta aplicando las cuotas vencidas y las
// amortizaciones anticipadas en orden cronológico, así el capital pendiente
// avanza solo con el paso del tiempo. Interés mensual = TIN/12/100; se ignora
// el día exacto dentro del mes (simplificación estándar de los cuadros).

const dstr = (d) => d.toISOString().slice(0, 10);
export const todayStr = () => dstr(new Date());
const clampDay = (day) => Math.min(Math.max(1, day || 1), 28);

function addMonths(dateStr, k, day) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return dstr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, clampDay(day))));
}

export function firstPaymentDate(startDate, paymentDay) {
  const d = new Date(startDate + 'T00:00:00Z');
  const same = dstr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), clampDay(paymentDay))));
  return same > startDate ? same : addMonths(startDate, 1, paymentDay);
}

export function frenchPayment(balance, tin, months) {
  if (months <= 0) return balance;
  const i = tin / 100 / 12;
  if (i <= 0) return balance / months;
  return (balance * i) / (1 - Math.pow(1 + i, -months));
}

function monthsToRepay(balance, tin, payment) {
  const i = tin / 100 / 12;
  if (i <= 0) return Math.ceil(balance / payment);
  const x = 1 - (balance * i) / payment;
  if (x <= 0) return Infinity;
  return Math.ceil(-Math.log(x) / Math.log(1 + i));
}

// Cuadro completo. events = amortizaciones reales; sim (opcional) = hipótesis
// del simulador {amount, recurring, mode: 'cuota'|'plazo', from: 'YYYY-MM-DD'}.
// Filas: {kind:'cuota', n, date, payment, interest, principal, extra, balance}
//        {kind:'extra', date, extra, balance}
export function buildSchedule(debt, events = [], sim = null) {
  const tin = debt.rate.tin;
  const i = tin / 100 / 12;
  const evs = events
    .filter((e) => e.debtId === debt.id)
    .map((e) => ({ date: e.date, amount: e.amount, mode: e.mode }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sim && !sim.recurring && sim.amount > 0) {
    evs.push({ date: sim.from, amount: sim.amount, mode: sim.mode, sim: true });
    evs.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  let balance = debt.principal;
  let monthsLeft = Math.max(1, Math.round(debt.termMonths));
  let payment = frenchPayment(balance, tin, monthsLeft);
  const rows = [];
  let date = firstPaymentDate(debt.startDate, debt.paymentDay);
  let ei = 0;
  let n = 0;
  let guard = 0;

  const applyExtra = (ev) => {
    const applied = Math.min(ev.amount, balance);
    balance = Math.max(0, balance - applied);
    if (balance > 0.005) {
      if (ev.mode === 'cuota') payment = frenchPayment(balance, tin, monthsLeft);
      else monthsLeft = Math.min(monthsLeft, monthsToRepay(balance, tin, payment));
    }
    rows.push({ kind: 'extra', date: ev.date, extra: applied, balance, sim: !!ev.sim });
  };

  while (balance > 0.005 && guard++ < 1500) {
    while (ei < evs.length && evs[ei].date < date && balance > 0.005) {
      applyExtra(evs[ei]);
      ei++;
    }
    if (balance <= 0.005) break;

    const interest = balance * i;
    const due = Math.min(payment, balance + interest);
    const principalPart = Math.max(0, due - interest);
    let extra = 0;
    if (sim?.recurring && sim.amount > 0 && date >= sim.from) {
      extra = Math.min(sim.amount, balance - principalPart);
      extra = Math.max(0, extra);
    }
    balance = Math.max(0, balance - principalPart - extra);
    n++;
    rows.push({ kind: 'cuota', n, date, payment: due, interest, principal: principalPart, extra, balance });
    monthsLeft--;
    if (extra > 0 && balance > 0.005) {
      if (sim.mode === 'cuota') payment = frenchPayment(balance, tin, monthsLeft);
      else monthsLeft = Math.min(monthsLeft, monthsToRepay(balance, tin, payment));
    }
    if (monthsLeft <= 0 && balance > 0.005) {
      // liquidación de seguridad si el redondeo deja cola
      const lastInt = balance * i;
      date = addMonths(date, 1, debt.paymentDay);
      n++;
      rows.push({ kind: 'cuota', n, date, payment: balance + lastInt, interest: lastInt, principal: balance, extra: 0, balance: 0 });
      balance = 0;
      break;
    }
    date = addMonths(date, 1, debt.paymentDay);
  }
  return rows;
}

// Estado del préstamo a una fecha: pendiente hoy, cuota vigente, fin, intereses…
export function loanState(debt, events = [], sim = null, today = todayStr()) {
  const rows = buildSchedule(debt, events, sim);
  let balance = debt.principal;
  let interestPaid = 0;
  let paidCuotas = 0;
  for (const r of rows) {
    if (r.date > today) break;
    balance = r.balance;
    if (r.kind === 'cuota') {
      interestPaid += r.interest;
      paidCuotas++;
    }
  }
  const futureCuotas = rows.filter((r) => r.kind === 'cuota' && r.date > today);
  const interestRemaining = futureCuotas.reduce((s, r) => s + r.interest, 0);
  const totalInterest = rows.filter((r) => r.kind === 'cuota').reduce((s, r) => s + r.interest, 0);
  return {
    rows,
    balance,
    currentPayment: futureCuotas[0]?.payment ?? null,
    nextPaymentDate: futureCuotas[0]?.date ?? null,
    remainingMonths: futureCuotas.length,
    endDate: rows.length ? rows[rows.length - 1].date : null,
    interestPaid,
    interestRemaining,
    totalInterest,
    paidCuotas,
    progress: debt.principal > 0 ? 1 - balance / debt.principal : 1,
  };
}

// Comparador de amortización anticipada: mismo importe, dos modos.
export function simulateExtra(debt, events, { amount, recurring }, today = todayStr()) {
  const base = loanState(debt, events, null, today);
  const scenario = (mode) => {
    const s = loanState(debt, events, { amount, recurring, mode, from: today }, today);
    return {
      mode,
      payment: s.currentPayment,
      endDate: s.endDate,
      remainingMonths: s.remainingMonths,
      monthsSaved: base.remainingMonths - s.remainingMonths,
      interestSaved: base.interestRemaining - s.interestRemaining,
    };
  };
  return { base, cuota: scenario('cuota'), plazo: scenario('plazo') };
}

// Capital pendiente en una fecha dada (para la serie de patrimonio neto).
// Antes del alta se asume el capital del alta: la deuda ya existía, solo que
// no la teníamos registrada — mejor eso que un escalón falso en la gráfica.
export function balanceOn(rows, principal, date) {
  let b = principal;
  for (const r of rows) {
    if (r.date > date) break;
    b = r.balance;
  }
  return b;
}
