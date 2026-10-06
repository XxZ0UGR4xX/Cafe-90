import { useMemo, useState } from 'react';
import { formatMoney } from './domain';

export const CHART_COLORS = ['#D62828', '#F6B800', '#1E6BFF', '#17B800', '#F77F00', '#7A3FF2', '#111111'];
interface Datum { label: string; value: number }

/** RetroChart.Bar — barras con borde grueso, tooltips accesibles y escala "linda" (SVG puro, sin dependencias). */
export function RetroBarChart({ data, height = 220, color = CHART_COLORS[0]!, money = true, ariaLabel }: { data: Datum[]; height?: number; color?: string; money?: boolean; ariaLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { max, ticks } = useMemo(() => niceScale(Math.max(...data.map((d) => d.value), 0)), [data]);
  const W = 640; const pad = { l: 46, r: 10, t: 14, b: 28 }; const iw = W - pad.l - pad.r; const ih = height - pad.t - pad.b;
  const bw = data.length ? Math.min(46, (iw / data.length) * 0.66) : 0;
  const fmt = (v: number) => (money ? formatMoney(v) : String(Math.round(v * 100) / 100));
  if (!data.length) return <div className="rb-empty">Sin datos para graficar</div>;
  return (
    <svg className="rb-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel ?? 'Gráfica de barras'}>
      {ticks.map((t) => { const y = pad.t + ih - (t / max) * ih; return <g key={t}><line className="grid" x1={pad.l} x2={W - pad.r} y1={y} y2={y} /><text x={pad.l - 6} y={y + 3} textAnchor="end">{compact(t)}</text></g>; })}
      {data.map((d, i) => {
        const x = pad.l + (iw / data.length) * i + (iw / data.length - bw) / 2; const h = (d.value / max) * ih;
        return (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect className="bar" x={x} y={pad.t + ih - h} width={bw} height={Math.max(h, d.value > 0 ? 2 : 0)} fill={color} rx={3}><title>{`${d.label}: ${fmt(d.value)}`}</title></rect>
            <text x={x + bw / 2} y={height - 10} textAnchor="middle">{d.label.length > 8 ? d.label.slice(-5) : d.label}</text>
            {hover === i && <text x={x + bw / 2} y={pad.t + ih - h - 6} textAnchor="middle" style={{ fontWeight: 800, fill: 'var(--ink)' }}>{compact(d.value)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function RetroLineChart({ data, height = 220, color = CHART_COLORS[2]!, money = true, ariaLabel }: { data: Datum[]; height?: number; color?: string; money?: boolean; ariaLabel?: string }) {
  const { max, ticks } = useMemo(() => niceScale(Math.max(...data.map((d) => d.value), 0)), [data]);
  const W = 640; const pad = { l: 46, r: 14, t: 14, b: 28 }; const iw = W - pad.l - pad.r; const ih = height - pad.t - pad.b;
  if (!data.length) return <div className="rb-empty">Sin datos para graficar</div>;
  const pts = data.map((d, i) => [pad.l + (data.length === 1 ? iw / 2 : (iw / (data.length - 1)) * i), pad.t + ih - (d.value / max) * ih] as const);
  return (
    <svg className="rb-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel ?? 'Gráfica de línea'}>
      {ticks.map((t) => { const y = pad.t + ih - (t / max) * ih; return <g key={t}><line className="grid" x1={pad.l} x2={W - pad.r} y1={y} y2={y} /><text x={pad.l - 6} y={y + 3} textAnchor="end">{compact(t)}</text></g>; })}
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" />
      {pts.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r={5} fill="#fff" stroke="#111" strokeWidth={2.5}><title>{`${data[i]!.label}: ${money ? formatMoney(data[i]!.value) : data[i]!.value}`}</title></circle>
        {(i % Math.ceil(data.length / 8) === 0) && <text x={x} y={height - 10} textAnchor="middle">{data[i]!.label.slice(-5)}</text>}</g>)}
    </svg>
  );
}

export function RetroDonutChart({ data, size = 200, money = true, ariaLabel }: { data: Datum[]; size?: number; money?: boolean; ariaLabel?: string }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <div className="rb-empty">Sin datos para graficar</div>;
  const r = 70; const c = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="rb-row rb-wrap" style={{ justifyContent: 'center' }}>
      <svg className="rb-chart" style={{ width: size, flex: 'none' }} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? 'Gráfica circular'}>
        <g transform="rotate(-90 100 100)">
          {data.map((d, i) => { const len = (d.value / total) * c; const el = <circle key={d.label} cx={100} cy={100} r={r} fill="none" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={34} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc}><title>{`${d.label}: ${money ? formatMoney(d.value) : d.value}`}</title></circle>; acc += len; return el; })}
        </g>
        <circle cx={100} cy={100} r={r + 17} fill="none" stroke="#111" strokeWidth={2} /><circle cx={100} cy={100} r={r - 17} fill="none" stroke="#111" strokeWidth={2} />
        <text x={100} y={104} textAnchor="middle" style={{ fontFamily: 'var(--font-display)', fontSize: 14, fill: 'var(--ink)' }}>{money ? compact(total) : total}</text>
      </svg>
      <div className="rb-legend rb-col" style={{ gap: 6 }}>{data.map((d, i) => <span key={d.label}><i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />{d.label} · {Math.round((d.value / total) * 100)}%</span>)}</div>
    </div>
  );
}

export function compact(n: number) { return new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
/** Escala con marcas redondeadas (1-2-5). Pública para pruebas. */
export function niceScale(maxValue: number): { max: number; ticks: number[] } {
  if (maxValue <= 0) return { max: 1, ticks: [0, 1] };
  const exp = Math.pow(10, Math.floor(Math.log10(maxValue))); const f = maxValue / exp;
  const nice = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  return { max: nice, ticks: [0, nice / 4, nice / 2, (nice * 3) / 4, nice] };
}
