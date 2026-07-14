import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers } from 'lightweight-charts';
import { axisFormatter } from '../lib/format.js';

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
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - r.days);
  return d.toISOString().slice(0, 10);
}

export function RangePicker({ value, onChange }) {
  return (
    <div className="range-picker" role="tablist" aria-label="Rango temporal">
      {RANGES.map((r) => (
        <button
          key={r.key}
          role="tab"
          aria-selected={value === r.key}
          className={value === r.key ? 'chip chip-on' : 'chip'}
          onClick={() => onChange(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export default function CandleChart({ candles, markers = [], privacy = 'normal', height = 280 }) {
  const boxRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: '#1a2332' },
        horzLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: '#1a2332' },
      },
      localization: { priceFormatter: axisFormatter },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#0ca30c',
      downColor: '#e66767',
      borderVisible: false,
      wickUpColor: '#0ca30c',
      wickDownColor: '#e66767',
    });
    const markersApi = createSeriesMarkers(series, []);
    apiRef.current = { chart, series, markersApi };
    return () => {
      chart.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.series.setData(candles);
    api.markersApi.setMarkers(candles.length ? markers : []);
    api.chart.priceScale('right').applyOptions({
      visible: privacy !== 'hidden',
      mode: privacy === 'percent' ? 2 : 0, // 2 = PriceScaleMode.Percentage
    });
    api.chart.timeScale().fitContent();
  }, [candles, markers, privacy]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
      {!candles.length && <div className="chart-empty">Aún no hay histórico que mostrar</div>}
    </div>
  );
}
