import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCheck, RetroInput, RetroSelect, RetroTable, RetroTabs } from '@retroburger/ui';
import { PROMOTION_TYPES } from '@retroburger/shared';
import { del, post, put } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { Async, FormModal, Row, num } from './common';

const TYPE_LABEL: Record<string, string> = { BOGO: '2×1', PERCENT: 'Descuento %', FIXED: 'Descuento fijo', HAPPY_HOUR: 'Happy Hour', FREE_PRODUCT: 'Producto gratis', COUPON: 'Cupón', BIRTHDAY: 'Cumpleaños', DOUBLE_POINTS: 'Puntos dobles' };
const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export default function Promotions() {
  const { can } = useSession(); const q = useGet<any[]>(['promotions'], '/promotions'); const products = useGet<any[]>(['catalog', 'products'], '/products', { limit: 500 }); const cats = useGet<any[]>(['catalog', 'cats'], '/categories');
  const [f, setF] = useState<any | null>(null);
  const body = (x: any) => ({ name: x.name, type: x.type, code: x.type === 'COUPON' ? (x.code || null) : null, stackable: x.stackable ?? false, priority: num(String(x.priority ?? 0)), isActive: x.isActive ?? true,
    config: { percent: x.percent ? num(String(x.percent)) : undefined, amount: x.amount ? num(String(x.amount)) : undefined, minSubtotal: x.minSubtotal ? num(String(x.minSubtotal)) : undefined, productIds: x.productIds?.length ? x.productIds : undefined, categoryIds: x.categoryIds?.length ? x.categoryIds : undefined, freeProductId: x.freeProductId || undefined, multiplier: x.type === 'DOUBLE_POINTS' ? num(String(x.multiplier ?? 2)) : undefined, discountKind: x.type === 'COUPON' ? (x.discountKind ?? 'PERCENT') : undefined },
    schedule: x.useSchedule ? { days: x.days?.length ? x.days : undefined, from: x.from || undefined, to: x.to || undefined } : null, startsAt: x.startsAt ? new Date(x.startsAt).toISOString() : null, endsAt: x.endsAt ? new Date(x.endsAt).toISOString() : null, branchIds: null, maxRedemptions: x.maxRedemptions ? num(String(x.maxRedemptions)) : null });
  const save = useAct(() => (f.id ? put(`/promotions/${f.id}`, body(f)) : post('/promotions', body(f))), { invalidate: [['promotions']], ok: 'Promoción guardada 🎟️', onSuccess: () => setF(null) });
  const remove = useAct((id: string) => del(`/promotions/${id}`), { invalidate: [['promotions']], ok: 'Promoción eliminada', onSuccess: () => setF(null) });
  const edit = (r: any) => setF({ ...r, ...r.config, useSchedule: !!r.schedule, days: r.schedule?.days ?? [], from: r.schedule?.from, to: r.schedule?.to, startsAt: r.startsAt?.slice(0, 16), endsAt: r.endsAt?.slice(0, 16) });
  const toggleIn = (key: string, id: string) => setF({ ...f, [key]: (f[key] ?? []).includes(id) ? f[key].filter((x: string) => x !== id) : [...(f[key] ?? []), id] });
  return (
    <>
      {can('promotions.promotion.write') && <div className="rb-row"><RetroButton variant="neon" onClick={() => setF({ name: '', type: 'PERCENT', isActive: true, stackable: false, priority: 0, percent: 10 })}>+ Promoción</RetroButton></div>}
      <Async q={q}><RetroTable rows={q.data ?? []} onRowClick={can('promotions.promotion.write') ? edit : undefined} columns={[{ key: 'name', header: 'Promoción', render: (r: any) => <strong>{r.name}</strong> }, { key: 't', header: 'Tipo', render: (r: any) => <RetroBadge tone="orange">{TYPE_LABEL[r.type]}</RetroBadge> }, { key: 'c', header: 'Cupón', render: (r: any) => r.code ?? '' }, { key: 'v', header: 'Valor', render: (r: any) => (r.config.percent ? `${r.config.percent}%` : r.config.amount ? `$${r.config.amount}` : r.config.multiplier ? `×${r.config.multiplier}` : '') },
        { key: 's', header: 'Horario', render: (r: any) => (r.schedule ? `${(r.schedule.days ?? []).map((d: number) => DAYS[d]).join('')} ${r.schedule.from ?? ''}-${r.schedule.to ?? ''}` : 'Siempre') }, { key: 'a', header: 'Activa', render: (r: any) => (r.isActive ? '✅' : '⛔') }]} /></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title={f?.id ? 'Editar promoción' : 'Nueva promoción'} size="lg" busy={save.isPending} disabled={!f?.name} onSubmit={() => save.mutate()}>{f && <>
        <Row><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="HAPPY HOUR" /><RetroSelect label="Tipo" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={PROMOTION_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t]! }))} /></Row>
        {f.type === 'COUPON' && <Row><RetroInput label="Código" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /><RetroSelect label="Descuento" value={f.discountKind ?? 'PERCENT'} onChange={(e) => setF({ ...f, discountKind: e.target.value })} options={[{ value: 'PERCENT', label: 'Porcentaje' }, { value: 'FIXED', label: 'Monto fijo' }]} /></Row>}
        <Row>{['PERCENT', 'HAPPY_HOUR', 'BIRTHDAY'].includes(f.type) || (f.type === 'COUPON' && (f.discountKind ?? 'PERCENT') === 'PERCENT') ? <RetroInput label="% de descuento" inputMode="decimal" value={f.percent ?? ''} onChange={(e) => setF({ ...f, percent: e.target.value })} /> : null}
          {f.type === 'FIXED' || (f.type === 'COUPON' && f.discountKind === 'FIXED') ? <RetroInput label="Monto" inputMode="decimal" value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /> : null}
          {f.type === 'DOUBLE_POINTS' && <RetroInput label="Multiplicador de puntos" inputMode="decimal" value={f.multiplier ?? 2} onChange={(e) => setF({ ...f, multiplier: e.target.value })} />}<RetroInput label="Consumo mínimo" inputMode="decimal" value={f.minSubtotal ?? ''} onChange={(e) => setF({ ...f, minSubtotal: e.target.value })} /></Row>
        {f.type === 'FREE_PRODUCT' && <RetroSelect label="Producto gratis" value={f.freeProductId ?? ''} onChange={(e) => setF({ ...f, freeProductId: e.target.value })} options={[{ value: '', label: 'Selecciona…' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />}
        {['BOGO', 'PERCENT', 'HAPPY_HOUR', 'COUPON'].includes(f.type) && <><div className="rb-label">Aplica a categorías (vacío = todo)</div><div className="rb-row rb-wrap">{(cats.data ?? []).map((c) => <RetroCheck key={c.id} label={c.name} checked={(f.categoryIds ?? []).includes(c.id)} onChange={() => toggleIn('categoryIds', c.id)} />)}</div><div className="rb-label">…o productos específicos</div><div className="rb-row rb-wrap">{(products.data ?? []).filter((p) => p.kind === 'SIMPLE').map((p) => <RetroCheck key={p.id} label={p.name} checked={(f.productIds ?? []).includes(p.id)} onChange={() => toggleIn('productIds', p.id)} />)}</div></>}
        <RetroCheck label="Limitar por horario (ej. Happy Hour lunes a viernes 17:00–19:00)" checked={f.useSchedule ?? false} onChange={(e) => setF({ ...f, useSchedule: e.target.checked })} />
        {f.useSchedule && <><div className="rb-row rb-wrap">{DAYS.map((d, i) => <RetroButton key={d} size="sm" variant={(f.days ?? []).includes(i) ? 'red' : 'white'} onClick={() => toggleIn('days', i as any)}>{d}</RetroButton>)}</div><Row><RetroInput label="Desde" type="time" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value })} /><RetroInput label="Hasta" type="time" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value })} /></Row></>}
        <Row><RetroInput label="Inicio (opcional)" type="datetime-local" value={f.startsAt ?? ''} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /><RetroInput label="Fin (opcional)" type="datetime-local" value={f.endsAt ?? ''} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Row>
        <div className="rb-row rb-wrap"><RetroCheck label="Activa" checked={f.isActive ?? true} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><RetroCheck label="Se puede combinar con otras" checked={f.stackable ?? false} onChange={(e) => setF({ ...f, stackable: e.target.checked })} />{f.id && <RetroButton size="sm" variant="ink" onClick={() => remove.mutate(f.id)}>Eliminar</RetroButton>}</div></>}</FormModal>
      <RetroTabs value="x" onChange={() => undefined} tabs={[]} />
    </>
  );
}
