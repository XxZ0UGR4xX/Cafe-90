import { describe, expect, it } from 'vitest';
import { resolveRange, todayIn } from './range';

describe('resolveRange', () => {
  const today = '2026-10-06';
  it('hoy vs ayer', () => expect(resolveRange('today', today)).toMatchObject({ from: today, to: today, prevFrom: '2026-10-05', prevTo: '2026-10-05' }));
  it('últimos 7 días vs 7 previos', () => expect(resolveRange('last7', today)).toMatchObject({ from: '2026-09-30', to: today, prevFrom: '2026-09-23', prevTo: '2026-09-29', days: 7 }));
  it('este mes vs mismo tramo del mes anterior', () => expect(resolveRange('month', today)).toMatchObject({ from: '2026-10-01', to: today, prevFrom: '2026-09-01', prevTo: '2026-09-06' }));
  it('mes anterior completo', () => expect(resolveRange('prevMonth', today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-01', prevTo: '2026-08-30' }));
  it('personalizado compara con el periodo previo de igual duración', () => expect(resolveRange('custom', today, '2026-10-01', '2026-10-03')).toMatchObject({ prevFrom: '2026-09-28', prevTo: '2026-09-30', days: 3 }));
  it('todayIn respeta zona horaria', () => expect(todayIn('Asia/Tokyo', new Date('2026-10-06T20:00:00Z'))).toBe('2026-10-07'));
});
