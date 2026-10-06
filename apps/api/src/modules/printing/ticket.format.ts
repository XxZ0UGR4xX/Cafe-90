/** Formateo de tickets en texto plano de ancho fijo (listo para ESC/POS). Funciones puras y probadas. */
export const money = (n: number) => `$${n.toFixed(2)}`;
export const line = (w: number, ch = '-') => ch.repeat(w);
export const center = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : ' '.repeat(Math.floor((w - s.length) / 2)) + s);
export const lr = (l: string, r: string, w: number) => {
  const gap = w - l.length - r.length;
  return gap >= 1 ? l + ' '.repeat(gap) + r : l.slice(0, Math.max(w - r.length - 1, 1)) + ' ' + r;
};
export const wrap = (s: string, w: number, indent = 0): string[] => {
  const out: string[] = []; let cur = '';
  for (const word of s.split(/\s+/)) {
    if ((cur + ' ' + word).trim().length > w - indent) { if (cur) out.push(' '.repeat(indent) + cur); cur = word; } else cur = (cur + ' ' + word).trim();
  }
  if (cur) out.push(' '.repeat(indent) + cur);
  return out;
};
const fmtDate = (d: string | Date) => new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', hour12: false });

export function renderReceipt(o: Dict, w = 42): string {
  const L: string[] = [];
  L.push(center('** RETROBURGER **', w), center(o.branch?.restaurant ?? '', w), center(o.branch?.name ?? '', w));
  if (o.branch?.address) L.push(...wrap(o.branch.address, w).map((x) => center(x, w)));
  if (o.branch?.taxId) L.push(center(`RFC: ${o.branch.taxId}`, w));
  L.push(line(w), lr(`Orden #${String(o.number).padStart(4, '0')}`, fmtDate(o.createdAt), w));
  L.push(`${o.channel}${o.tableNumber ? ` · Mesa ${o.tableNumber}` : ''}${o.waiterName ? ` · ${o.waiterName}` : ''}`, line(w));
  for (const it of o.items.filter((i: Dict) => !i.parentItemId)) {
    L.push(lr(`${it.qty} x ${it.name}`, money(it.lineTotal), w));
    for (const c of o.items.filter((x: Dict) => x.parentItemId === it.id)) L.push(`   · ${c.name}`);
    for (const m of it.modifiers ?? []) L.push(`   ${m.type === 'REMOVE' ? 'SIN' : '+'} ${m.name}${m.priceDelta ? ` (${money(m.priceDelta)})` : ''}`);
  }
  L.push(line(w), lr('Subtotal', money(o.subtotal), w));
  if (o.discountTotal > 0) L.push(lr('Descuento', `-${money(o.discountTotal)}`, w));
  if (o.deliveryFee > 0) L.push(lr('Envío', money(o.deliveryFee), w));
  L.push(lr('IVA incluido', money(o.taxTotal), w));
  if (o.tipTotal > 0) L.push(lr('Propina', money(o.tipTotal), w));
  L.push(lr('TOTAL', money(o.total + o.tipTotal), w), line(w));
  for (const p of o.payments ?? []) L.push(lr(`${p.kind === 'REFUND' ? 'Devolución' : 'Pago'} ${p.method}`, money(p.amount), w));
  L.push('', center('¡Gracias por tu visita!', w), center('RETROBURGER · THE 90s BURGER EXPERIENCE', w), '');
  return L.join('\n');
}

export function renderKitchenTicket(t: Dict, w = 42): string {
  const L: string[] = [center(`*** ${t.stationKey} ***`, w), lr(`#${String(t.number).padStart(4, '0')}${t.round > 1 ? ` (ronda ${t.round})` : ''}`, t.tableNumber ? `MESA ${t.tableNumber}` : String(t.channel), w), line(w)];
  for (const it of t.items) {
    L.push(`${it.qty} x ${it.name}`.toUpperCase());
    for (const m of it.modifiers ?? []) L.push(`    ${m}`);
    if (it.notes) L.push(...wrap(`NOTA: ${it.notes}`, w, 4));
  }
  L.push(line(w), fmtDate(t.createdAt), '');
  return L.join('\n');
}

export function renderCashClose(r: Dict, w = 42): string {
  const L: string[] = [center('CORTE DE CAJA', w), center(r.branchName ?? '', w), line(w),
    lr('Cajero', r.userName ?? '', w), lr('Apertura', fmtDate(r.openedAt), w), lr('Cierre', fmtDate(r.closedAt), w), line(w),
    lr('Fondo inicial', money(r.openingFloat), w), lr('Ventas totales', money(r.salesTotal), w)];
  for (const m of ['CASH', 'CARD', 'TRANSFER', 'QR']) L.push(lr(`  ${m}`, money(r.salesByMethod?.[m] ?? 0), w));
  L.push(lr('Propinas', money(r.tipsTotal), w), lr('Descuentos', money(r.discounts), w), lr('Cancelaciones', String(r.cancellations), w),
    lr('Devoluciones', money(r.refunds), w), lr('Gastos', money(r.expenses), w), lr('Retiros', money(r.withdrawals), w), line(w),
    lr('Total esperado', money(r.expectedCash), w), lr('Total real', money(r.countedCash), w), lr('DIFERENCIA', money(r.difference), w), '');
  return L.join('\n');
}

export function renderPurchaseOrder(po: Dict, w = 42): string {
  const L: string[] = [center('ORDEN DE COMPRA', w), lr(`OC #${po.number}`, String(po.status), w), `Proveedor: ${po.supplier}`, line(w)];
  for (const it of po.items) L.push(lr(`${it.qty}${it.unit} ${it.name}`, money(it.qty * it.unitPrice), w));
  L.push(line(w), lr('TOTAL', money(po.total), w), '');
  return L.join('\n');
}
type Dict = Record<string, any>;
