import { useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { addDays, daysBetween, fmtAgo, fmtDate, todayStr } from '../lib/dates.js';
import { fmtRate, money, moneySigned } from '../lib/format.js';
import { paymentBeforeReview } from '../lib/loan.js';
import Icon from './Icon.jsx';

const BACKUP_EVERY_DAYS = 30;
const VALUATION_EVERY_DAYS = 180;
const REVIEW_WARN_DAYS = 45;

// Avisos con fecha: cada uno se puede posponer ("Más tarde") y vuelve solo.
export function useNotices(positions, debtStates) {
  const { data } = useBoveda();
  return useMemo(() => {
    if (!data) return [];
    const today = todayStr();
    const snoozed = data.settings.snoozed || {};
    const out = [];
    const live = (key) => !snoozed[key] || snoozed[key] <= today;

    const hasData = data.assets.length > 0 || data.debts.length > 0;
    const last = data.settings.lastBackupAt;
    if (hasData && live('backup') && (!last || daysBetween(last, today) >= BACKUP_EVERY_DAYS)) {
      out.push({
        key: 'backup',
        kind: 'warn',
        icon: 'shield',
        title: last ? `Último backup ${fmtAgo(last, today)}` : 'Aún no has hecho ningún backup',
        text: 'Tus datos solo existen en este dispositivo. Si lo pierdes sin backup, no hay forma de recuperarlos.',
        action: 'backup',
        actionLabel: 'Hacer backup',
        snoozeDays: 7,
      });
    }

    for (const { debt, st } of debtStates) {
      const r = st.nextReview;
      if (debt.rate.type !== 'variable' || !r) continue;
      const days = daysBetween(today, r.date);
      const key = `review:${debt.id}:${r.date}`;
      if (days < 0 || days > REVIEW_WARN_DAYS || !live(key)) continue;
      const before = paymentBeforeReview(st);
      const diff = before != null ? r.payment - before : null;
      out.push({
        key,
        kind: diff != null && diff > 0 ? 'warn' : 'info',
        icon: 'calendar',
        title: `${debt.name}: revisión el ${fmtDate(r.date)}`,
        text:
          `Con el euríbor de hoy, el tipo pasaría al ${fmtRate(r.tin)} y la cuota a ` +
          `${money(r.payment, 'normal')}/mes` +
          (diff != null && Math.abs(diff) >= 0.5 ? ` (${moneySigned(diff, 'normal')} al mes).` : '.'),
        privateText: true,
        action: `debt:${debt.id}`,
        actionLabel: 'Ver simulador',
        snoozeUntil: r.date,
      });
    }

    for (const p of positions) {
      if (p.asset.type !== 'realestate' || p.qty <= 0) continue;
      const key = `valuation:${p.asset.id}`;
      if (!live(key)) continue;
      const firstBuy = data.transactions
        .filter((t) => t.assetId === p.asset.id && t.kind === 'buy')
        .reduce((m, t) => (!m || t.date < m ? t.date : m), null);
      const ref = p.lastValuation?.date || firstBuy;
      if (!ref || daysBetween(ref, today) < VALUATION_EVERY_DAYS) continue;
      out.push({
        key,
        kind: 'info',
        icon: 'home',
        title: `${p.asset.name}: valoración ${p.lastValuation ? fmtAgo(p.lastValuation.date, today) : 'sin actualizar'}`,
        text: 'El precio de la vivienda cambia: actualízalo para que tu patrimonio no se quede viejo.',
        action: `asset:${p.asset.id}`,
        actionLabel: 'Actualizar',
        snoozeDays: 30,
      });
    }
    return out;
  }, [data, positions, debtStates]);
}

const VISIBLE = 2;

export default function Notices({ notices, onAction }) {
  const { mutate, privacy } = useBoveda();
  const [all, setAll] = useState(false);
  if (!notices.length) return null;
  const shown = all ? notices : notices.slice(0, VISIBLE);
  const hidden = notices.length - shown.length;

  function snooze(n) {
    const until = n.snoozeUntil ? addDays(n.snoozeUntil, 1) : addDays(todayStr(), n.snoozeDays || 7);
    mutate((d) => {
      d.settings.snoozed = { ...(d.settings.snoozed || {}), [n.key]: until };
      // limpieza: fuera aplazamientos ya vencidos
      for (const [k, v] of Object.entries(d.settings.snoozed)) if (v <= todayStr()) delete d.settings.snoozed[k];
      return d;
    });
  }

  return (
    <div className="notices">
      {shown.map((n) => (
        <div key={n.key} className={`notice notice-${n.kind}`}>
          <span className="notice-icon">
            <Icon name={n.icon} size={18} />
          </span>
          <div className="notice-body">
            <div className="notice-title">{n.title}</div>
            <div className="notice-text">
              {n.privateText && privacy !== 'normal' ? 'Toca "Ver simulador" para ver los detalles.' : n.text}
            </div>
            <div className="notice-actions">
              <button className="btn-text" onClick={() => onAction(n.action)}>
                {n.actionLabel}
              </button>
              <button className="btn-text muted-btn" onClick={() => snooze(n)}>
                Más tarde
              </button>
            </div>
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <button className="notices-more" onClick={() => setAll(true)}>
          {hidden === 1 ? 'Ver 1 aviso más' : `Ver ${hidden} avisos más`}
        </button>
      )}
    </div>
  );
}
