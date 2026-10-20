import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';
import { axisFormatter } from '../lib/format.js';
import { addDays, todayStr } from '../lib/dates.js';

export const UP = '#34c77b';
export const DOWN = '#f06b6b';
export const LINE = '#aab6cc';

const RANGES = [
  { key: '1m', label: '1M', days: 31 },
  { key: '3m', label: '3M', days: 92 },
  { key: '6m', label: '6M', days: 183 },
  { key: '1y', label: '1A', days: 366 },
  { key: '2y', label: '2A', days: 731 },
  { key: '5y', label: '5A', days: 1827 },
  { key: 'all', label: 'Todo', days: null },
];

export function rangeCutoff(rangeKey) {
  const r = RANGES.find((x) => x.key === rangeKey);
  if (!r || !r.days) return null;
  return addDays(todayStr(), -r.days);
}

export function RangePicker({ value, onChange }) {
  return (
    <div className="range-picker" role="tablist" aria-label="Rango temporal">
      {RANGES.map((r) => (
        <button
          key={r.key}
          role="tab"
          aria-selected={value === r.key}
          className={value === r.key ? 'seg seg-on' : 'seg'}
          onClick={() => onChange(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// lineData (opcional): [{time, value}] pintada como línea discontinua sobre las
// velas (el "dinero aportado"). En los modos de privacidad no se pinta: en modo
// porcentaje cada serie se normaliza por separado y la comparación engañaría.
const NO_MARKERS = [];

// fitKey: cuándo re-encuadrar (p. ej. pestaña+rango). Sin él, al cambiar los datos.
export default function CandleChart({
  candles,
  markers = NO_MARKERS,
  lineData = null,
  privacy = 'normal',
  height = 280,
  fitKey,
}) {
  const boxRef = useRef(null);
  const apiRef = useRef(null);
  const fittedFor = useRef(null);

  useEffect(() => {
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7f8aa3',
        fontFamily: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 11,
        // La atribución que pide la licencia va como enlace al pie del panel:
        // el logo flotante tapaba la esquina de la gráfica en el móvil.
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(255,255,255,0.045)' },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.22)', labelBackgroundColor: '#1c2638' },
        horzLine: { color: 'rgba(255,255,255,0.22)', labelBackgroundColor: '#1c2638' },
      },
      localization: { priceFormatter: axisFormatter, locale: 'es-ES' },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: false,
    });
    const line = chart.addSeries(LineSeries, {
      color: LINE,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const markersApi = createSeriesMarkers(series, []);
    apiRef.current = { chart, series, line, markersApi };
    return () => {
      chart.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.series.setData(candles);
    api.line.setData(privacy === 'normal' && lineData && candles.length ? lineData : []);
    // Marcas fuera del rango visible: la librería las pegaría al borde izquierdo.
    const first = candles[0]?.time;
    api.markersApi.setMarkers(candles.length ? markers.filter((m) => m.time >= first) : []);
    api.chart.priceScale('right').applyOptions({
      visible: privacy !== 'hidden',
      mode: privacy === 'percent' ? 2 : 0, // 2 = PriceScaleMode.Percentage
    });
    // Re-encuadrar solo cuando cambian los datos (otro rango, otra pestaña…), no
    // en cada repintado: si no, el zoom del usuario se perdería cada pocos segundos.
    const key = fitKey != null ? `${fitKey}|${candles.length > 0}` : candles;
    if (fittedFor.current !== key) {
      fittedFor.current = key;
      api.chart.timeScale().fitContent();
    }
  }, [candles, markers, lineData, privacy, fitKey]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
      {!candles.length && <div className="chart-empty">Aún no hay histórico que mostrar</div>}
    </div>
  );
}
