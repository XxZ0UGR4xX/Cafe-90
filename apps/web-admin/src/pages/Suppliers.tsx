import { useState } from 'react';
import { RetroBadge, RetroButton, RetroInput, RetroSelect, RetroTable } from '@retroburger/ui';
import { post, put } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { Async, FormModal, Row, num } from './common';
import { formatMoney2 } from '@retroburger/ui';

export default function Suppliers() {
  const { can } = useSession(); const q = useGet<any[]>(['suppliers'], '/suppliers'); const ing = useGet<any[]>(['ingredients'], '/ingredients');
  const [f, setF] = useState<any | null>(null);
  const save = useAct(() => (f.id ? put(`/suppliers/${f.id}`, body(f)) : post('/suppliers', body(f))), { invalidate: [['suppliers']], ok: 'Proveedor guardado', onSuccess: () => setF(null) });
  const body = (x: any) => ({ name: x.name, contactName: x.contactName || undefined, phone: x.phone || undefined, email: x.email || undefined, taxId: x.taxId || undefined, address: x.address || undefined, leadTimeDays: num(String(x.leadTimeDays ?? 2)), paymentTermsDays: num(String(x.paymentTermsDays ?? 0)), isActive: x.isActive ?? true, products: (x.products ?? []).filter((p: any) => p.ingredientId).map((p: any) => ({ ingredientId: p.ingredientId, price: num(String(p.price ?? 0)) })) });
  return (
    <>
      {can('purchasing.supplier.write') && <div className="rb-row"><RetroButton variant="neon" onClick={() => setF({ name: '', products: [], isActive: true, leadTimeDays: 2, paymentTermsDays: 0 })}>+ Proveedor</RetroButton></div>}
      <Async q={q}><RetroTable rows={q.data ?? []} onRowClick={can('purchasing.supplier.write') ? (r) => setF(r) : undefined} columns={[{ key: 'name', header: 'Proveedor', render: (r: any) => <strong>{r.name}</strong> }, { key: 'c', header: 'Contacto', render: (r: any) => `${r.contactName ?? ''} ${r.phone ?? ''}` }, { key: 'l', header: 'Entrega', render: (r: any) => `${r.leadTimeDays} d` }, { key: 'p', header: 'Productos', render: (r: any) => r.products.length }, { key: 'a', header: 'Estado', render: (r: any) => <RetroBadge tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'Activo' : 'Inactivo'}</RetroBadge> }]} /></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title={f?.id ? `Proveedor · ${f.name}` : 'Nuevo proveedor'} size="lg" busy={save.isPending} disabled={!f?.name} onSubmit={() => save.mutate()}>
        {f && <><Row><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Contacto" value={f.contactName ?? ''} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Row>
          <Row><RetroInput label="Teléfono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /><RetroInput label="Correo" type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Row>
          <Row><RetroInput label="Días de entrega" type="number" value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} /><RetroInput label="Días de crédito" type="number" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value })} /></Row>
          <div className="rb-label">Catálogo de precios</div>
          {(f.products ?? []).map((p: any, i: number) => <Row key={i}><RetroSelect value={p.ingredientId} onChange={(e) => setF({ ...f, products: f.products.map((x: any, j: number) => (j === i ? { ...x, ingredientId: e.target.value } : x)) })} options={[{ value: '', label: 'Insumo…' }, ...(ing.data ?? []).map((g) => ({ value: g.id, label: g.name }))]} /><RetroInput inputMode="decimal" placeholder="Precio" value={p.price ?? ''} onChange={(e) => setF({ ...f, products: f.products.map((x: any, j: number) => (j === i ? { ...x, price: e.target.value } : x)) })} /></Row>)}
          <RetroButton size="sm" variant="white" onClick={() => setF({ ...f, products: [...(f.products ?? []), { ingredientId: '', price: '' }] })}>+ Producto</RetroButton></>}
      </FormModal>
      <span className="rb-hint">Precios pactados ayudan a precargar las órdenes de compra. {formatMoney2(0).slice(0, 0)}</span>
    </>
  );
}
