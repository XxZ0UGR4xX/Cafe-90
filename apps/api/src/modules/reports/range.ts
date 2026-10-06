/** Resolución de rangos de fechas del dashboard (fechas YYYY-MM-DD, calendario del negocio). */
export type RangeKey = 'today' | 'yesterday' | 'last7' | 'month' | 'prevMonth' | 'custom';
export interface DateRange { from: string; to: string; prevFrom: string; prevTo: string; days: number }

const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, d!)); };
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const diffDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

export const todayIn = (tz: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export function resolveRange(key: RangeKey, today: string, from?: string, to?: string): DateRange {
  let f: string; let t: string; let pf: string; let pt: string;
  switch (key) {
    case 'today': f = t = today; pf = pt = addDays(today, -1); break;
    case 'yesterday': f = t = addDays(today, -1); pf = pt = addDays(today, -2); break;
    case 'last7': f = addDays(today, -6); t = today; pf = addDays(today, -13); pt = addDays(today, -7); break;
    case 'month': {
      f = `${today.slice(0, 8)}01`; t = today;
      const prev = parse(f); prev.setUTCMonth(prev.getUTCMonth() - 1);
      pf = fmt(prev); pt = addDays(pf, diffDays(f, t)); break;
    }
    case 'prevMonth': {
      const first = parse(`${today.slice(0, 8)}01`); const last = new Date(first); last.setUTCDate(0);
      t = fmt(last); const pm = new Date(last); pm.setUTCDate(1); f = fmt(pm);
      const pp = new Date(pm); pp.setUTCMonth(pp.getUTCMonth() - 1); pf = fmt(pp); pt = addDays(pf, diffDays(f, t)); break;
    }
    default: {
      if (!from || !to) throw new Error('custom requiere from y to');
      f = from; t = to; const n = diffDays(f, t) + 1; pt = addDays(f, -1); pf = addDays(pt, -(n - 1));
    }
  }
  return { from: f, to: t, prevFrom: pf, prevTo: pt, days: diffDays(f, t) + 1 };
}
