import { useMemo, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { taxReport, taxYears } from '../lib/ledger.js';
import { fmtEurCents, fmtQty } from '../lib/format.js';
import { fmtDate, todayStr } from '../lib/dates.js';
import Icon from './Icon.jsx';

const csvNum = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '');
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

function buildCsv(r) {
  const rows = [
    ['Tipo', 'Fecha', 'Activo', 'Cantidad', 'Valor de transmisión (€)', 'Valor de adquisición (€)', 'Resultado (€)', 'Aviso'],
  ];
  for (const s of r.sales) {
    rows.push([
      s.asset.type === 'crypto' ? 'Venta cripto' : 'Venta acciones/ETF',
      s.date,
      s.asset.symbol || s.asset.name,
      String(s.qty).replace('.', ','),
      csvNum(s.transmision),
      csvNum(s.adquisicion),
      csvNum(s.resultado),
      [
        s.deferred > 0.005 ? `Regla 2 meses: ${csvNum(s.deferred)} € aplazados` : '',
        s.integrated > 0.005 ? `Incluye ${csvNum(s.integrated)} € de pérdida aplazada` : '',
        s.unmatched ? 'Faltan compras registradas' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ]);
  }
  rows.push([]);
  rows.push(['Tipo', 'Fecha', 'Activo', '', 'Bruto (€)', 'Retención (€)', 'Neto (€)', '']);
  for (const x of r.income) {
    rows.push([
      x.rent ? 'Alquiler' : 'Dividendo',
      x.date,
      x.asset.symbol || x.asset.name,
      '',
      csvNum(x.gross),
      csvNum(x.withholding),
      csvNum(x.gross - x.withholding),
      '',
    ]);
  }
  // BOM para que Excel en español abra bien los acentos; ; como separador.
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

async function shareOrDownload(text, name) {
  const mobile = window.matchMedia?.('(pointer: coarse)').matches;
  if (mobile && typeof File !== 'undefined') {
    const file = new File([text], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const tone = (v) => (v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');

function Block({ title, b }) {
  return (
    <div className="tax-block">
      <div className="tax-block-title">{title}</div>
      <div className="tax-line">
        <span>Ganancias</span>
        <strong className={tone(b.gains)}>{fmtEurCents(b.gains)}</strong>
      </div>
      <div className="tax-line">
        <span>Pérdidas</span>
        <strong className={tone(b.losses)}>{fmtEurCents(b.losses)}</strong>
      </div>
      <div className="tax-line tax-total">
        <span>Resultado neto</span>
        <strong className={tone(b.net)}>{fmtEurCents(b.net, true)}</strong>
      </div>
    </div>
  );
}

export default function TaxReport({ onBack }) {
  const { data, privacy, setPrivacy } = useBoveda();
  const years = useMemo(() => taxYears(data), [data]);
  const thisYear = Number(todayStr().slice(0, 4));
  const [year, setYear] = useState(years.includes(thisYear - 1) ? thisYear - 1 : years[0] ?? thisYear - 1);
  const r = useMemo(() => taxReport(data, year), [data, year]);
  const hidden = privacy !== 'normal';

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn-icon" aria-label="Volver" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="detail-titles">
          <div className="detail-title">Informe para la renta</div>
          <div className="detail-sub">Ganancias y pérdidas por FIFO, dividendos y alquileres</div>
        </div>
      </div>

      {!years.length ? (
        <section className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="report" size={28} />
            </div>
            <p>Nada que declarar todavía</p>
            <p className="empty-sub">Aquí aparecerán tus ventas, dividendos y alquileres de cada año.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <div className="seg-group" role="tablist" aria-label="Año">
                {[...new Set([...years, thisYear])]
                  .sort((a, b) => b - a)
                  .map((y) => (
                    <button key={y} role="tab" aria-selected={year === y} className={year === y ? 'seg seg-on' : 'seg'} onClick={() => setYear(y)}>
                      {y}
                    </button>
                  ))}
              </div>
              {!hidden && (
                <button className="btn-text" onClick={() => shareOrDownload(buildCsv(r), `boveda-renta-${year}.csv`)}>
                  <Icon name="share" size={15} /> Exportar CSV
                </button>
              )}
            </div>
            {year === thisYear && <p className="muted">Ejercicio en curso: las cifras cambiarán hasta el 31 de diciembre.</p>}
            {hidden ? (
              <div className="tax-hidden">
                <p>El informe solo se enseña con las cifras visibles.</p>
                <button className="btn" onClick={() => setPrivacy('normal')}>
                  <Icon name="eye" size={18} /> Mostrar cifras
                </button>
              </div>
            ) : (
              <div className="tax-blocks">
                {!r.sales.length && !r.income.length && (
                  <p className="muted">Ninguna venta ni cobro en {year}.</p>
                )}
                {r.sales.some((s) => s.asset.type === 'stock') && <Block title="Acciones y ETF" b={r.stock} />}
                {r.sales.some((s) => s.asset.type === 'crypto') && <Block title="Criptomonedas" b={r.crypto} />}
                {r.dividends.gross > 0 && (
                  <div className="tax-block">
                    <div className="tax-block-title">Dividendos</div>
                    <div className="tax-line">
                      <span>Bruto</span>
                      <strong>{fmtEurCents(r.dividends.gross)}</strong>
                    </div>
                    <div className="tax-line">
                      <span>Retenciones</span>
                      <strong>{fmtEurCents(r.dividends.withholding)}</strong>
                    </div>
                  </div>
                )}
                {r.rents.gross > 0 && (
                  <div className="tax-block">
                    <div className="tax-block-title">Alquileres cobrados</div>
                    <div className="tax-line">
                      <span>Bruto</span>
                      <strong>{fmtEurCents(r.rents.gross)}</strong>
                    </div>
                    <div className="tax-line">
                      <span>Retenciones</span>
                      <strong>{fmtEurCents(r.rents.withholding)}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {!hidden && r.sales.length > 0 && (
            <section className="card">
              <div className="card-title">Ventas de {year}</div>
              <div className="sales">
                {r.sales.map((s, i) => (
                  <div key={i} className="sale">
                    <div className="sale-head">
                      <strong>{s.asset.symbol || s.asset.name}</strong>
                      <span className="sale-meta">
                        {fmtQty(s.qty)} · {fmtDate(s.date)}
                      </span>
                      {s.twoMonths && (
                        <span className="tax-flag" title="Recompraste el mismo valor en los dos meses de alrededor">
                          2M
                        </span>
                      )}
                      {s.unmatched && (
                        <span className="tax-flag" title="Vendiste más de lo que hay registrado como comprado">
                          Faltan compras
                        </span>
                      )}
                    </div>
                    <div className="sale-grid">
                      <div>
                        <span>Transmisión</span>
                        <strong>{fmtEurCents(s.transmision)}</strong>
                      </div>
                      <div>
                        <span>Adquisición</span>
                        <strong>{fmtEurCents(s.adquisicion)}</strong>
                      </div>
                      <div>
                        <span>Resultado</span>
                        <strong className={tone(s.resultado)}>{fmtEurCents(s.resultado, true)}</strong>
                      </div>
                    </div>
                    {s.deferred > 0.005 && (
                      <p className="sale-note">
                        {fmtEurCents(s.deferred)} de pérdida aplazados por la regla de los dos meses: se imputarán cuando
                        vendas los títulos recomprados.
                      </p>
                    )}
                    {s.integrated > 0.005 && (
                      <p className="sale-note">
                        Incluye {fmtEurCents(s.integrated)} de una pérdida aplazada anteriormente (regla de los dos meses).
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!hidden && r.income.length > 0 && (
            <section className="card">
              <div className="card-title">Cobros de {year}</div>
              {r.income.map((x, i) => (
                <div key={i} className="tx-row">
                  <span className="tx-date">{fmtDate(x.date)}</span>
                  <span className="tx-main">
                    <span className="tx-desc">
                      {x.rent ? 'Alquiler' : 'Dividendo'} · {x.asset.symbol || x.asset.name}
                    </span>
                    {x.withholding > 0 && <span className="tx-link">Retención {fmtEurCents(x.withholding)}</span>}
                  </span>
                  <span className="tx-amount">{fmtEurCents(x.gross)}</span>
                </div>
              ))}
            </section>
          )}

          <section className="card">
            <div className="card-title">Cómo leer esto</div>
            <ul className="tax-notes">
              <li>
                Hacienda calcula las ganancias por <strong>FIFO</strong>: lo primero que compraste es lo primero que vendes.
                Por eso aquí el coste puede no coincidir con el precio medio que ves en la ficha de cada activo.
              </li>
              <li>
                Transmisión = lo cobrado menos comisiones; adquisición = lo pagado más comisiones, cada uno al cambio en
                euros de su día.
              </li>
              <li>
                <strong>2M</strong>: vendiste con pérdidas y recompraste el mismo valor en los dos meses de alrededor. La
                parte de la pérdida que corresponde a lo recomprado no se computa ese año: se aplaza a cuando vendas esos
                títulos, y el resultado ya lo tiene en cuenta. Solo se reconoce el mismo valor si es el mismo activo en la
                app (el mismo ETF comprado en dos bolsas distintas cuenta por separado).
              </li>
              <li>
                Las retenciones incluyen las extranjeras. En la renta, la de un dividendo de fuera va a la deducción por
                doble imposición internacional, no al apartado de retenciones.
              </li>
              <li>
                Los traspasos entre fondos de inversión no tributan y no se calculan aquí. Las ventas de inmuebles tampoco:
                tienen reglas propias (mejoras, amortizaciones, coeficientes).
              </li>
              {r.missingFx.length > 0 && (
                <li className="down">Falta el tipo de cambio de algunas operaciones de {r.missingFx.join(', ')}: actualiza precios.</li>
              )}
              <li>Es una ayuda para preparar la declaración, no asesoramiento fiscal. Ante la duda, consúltalo con un gestor.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
