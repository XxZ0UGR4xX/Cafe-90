import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RetroButton, RetroDialog, RetroModal, RetroTable, RetroTabs, RetroStatCard, RetroToastProvider, useToast, formatMoney, mmss, niceScale, RetroKitchenTicket, RetroTableCard } from './index';

afterEach(cleanup);

describe('utilidades', () => {
  it('formatMoney y mmss', () => { expect(formatMoney(129)).toContain('129'); expect(mmss(512)).toBe('08:32'); expect(mmss(-5)).toBe('00:00'); });
  it('niceScale produce marcas redondas', () => { expect(niceScale(0).max).toBe(1); expect(niceScale(870).max).toBe(1000); expect(niceScale(18450).max).toBe(20000); });
});

describe('componentes Retro*', () => {
  it('RetroButton dispara click y se bloquea al cargar', () => {
    const fn = vi.fn();
    const { rerender } = render(<RetroButton onClick={fn}>COBRAR</RetroButton>);
    fireEvent.click(screen.getByText('COBRAR')); expect(fn).toHaveBeenCalledTimes(1);
    rerender(<RetroButton onClick={fn} loading>COBRAR</RetroButton>);
    fireEvent.click(screen.getByRole('button')); expect(fn).toHaveBeenCalledTimes(1);
  });
  it('RetroModal cierra con Escape y expone role=dialog', () => {
    const close = vi.fn();
    render(<RetroModal open title="Modificadores" onClose={close}>contenido</RetroModal>);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalled();
  });
  it('RetroDialog confirma/cancela', () => {
    const ok = vi.fn(); const no = vi.fn();
    render(<RetroDialog open title="¿Cancelar?" message="Seguro" onConfirm={ok} onCancel={no} confirmLabel="Sí" />);
    fireEvent.click(screen.getByText('Sí')); expect(ok).toHaveBeenCalled();
  });
  it('RetroTable muestra vacío y filas clicables', () => {
    const click = vi.fn();
    const { rerender } = render(<RetroTable columns={[{ key: 'n', header: 'Nombre' }]} rows={[]} empty="Nada" />);
    expect(screen.getByText('Nada')).toBeTruthy();
    rerender(<RetroTable columns={[{ key: 'n', header: 'Nombre' }]} rows={[{ id: '1', n: 'Retro Burger' }]} onRowClick={click} />);
    fireEvent.click(screen.getByText('Retro Burger')); expect(click).toHaveBeenCalled();
  });
  it('RetroTabs y RetroStatCard', () => {
    const ch = vi.fn();
    render(<><RetroTabs tabs={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} value="a" onChange={ch} /><RetroStatCard label="VENTAS" value="$1" delta={-12} /></>);
    fireEvent.click(screen.getByText('B')); expect(ch).toHaveBeenCalledWith('b');
    expect(screen.getByText(/12%/)).toBeTruthy();
  });
  it('Toast aparece con mensaje legible', () => {
    function T() { const t = useToast(); return <button onClick={() => t.error('No pudimos registrar el pedido')}>x</button>; }
    render(<RetroToastProvider><T /></RetroToastProvider>);
    fireEvent.click(screen.getByText('x')); expect(screen.getByText('No pudimos registrar el pedido')).toBeTruthy();
  });
  it('Ticket de cocina muestra tiempo, modificadores y notas; mesa muestra estado', () => {
    render(<><RetroKitchenTicket seconds={512} t={{ id: '1', number: 38, tableNumber: 12, channel: 'DINE_IN', stationKey: 'PARRILLA', round: 1, status: 'NEW', elapsedSeconds: 512, sla: 'warn', items: [{ id: 'i', name: 'Retro Burger', qty: 2, modifiers: ['SIN Cebolla'], notes: 'Extra queso' }] }} />
      <RetroTableCard number={12} capacity={4} status="OCCUPIED" seconds={90} total={248} /></>);
    expect(screen.getByText('⏱ 08:32')).toBeTruthy(); expect(screen.getByText('SIN Cebolla')).toBeTruthy(); expect(screen.getByText(/Ocupada/)).toBeTruthy(); expect(screen.getByText('MESA 12')).toBeTruthy();
  });
});

describe('RetroModal: foco y teclado', () => {
  // Regresión: con un `onClose` en línea (nuevo en cada render) el foco volvía al primer campo en cada tecla.
  function Form() {
    const [a, setA] = useState(''); const [b, setB] = useState(''); const [open, setOpen] = useState(true);
    return <><button>afuera</button><RetroModal open={open} title="Datos" onClose={() => setOpen(false)}>
      <label>Nombre<input aria-label="nombre" value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label>Teléfono<input aria-label="telefono" value={b} onChange={(e) => setB(e.target.value)} /></label>
    </RetroModal></>;
  }
  it('al teclear en el 2.º campo el foco no salta al 1.º aunque el padre se re-renderice con cada tecla', async () => {
    render(<Form />);
    const tel = screen.getByLabelText('telefono') as HTMLInputElement;
    tel.focus();
    for (const ch of '5551') { fireEvent.change(tel, { target: { value: tel.value + ch } }); expect(document.activeElement).toBe(tel); }
    expect(tel.value).toBe('5551'); expect((screen.getByLabelText('nombre') as HTMLInputElement).value).toBe('');
  });
  it('enfoca el primer campo al abrir, atrapa el Tab dentro del diálogo y devuelve el foco al cerrar', () => {
    render(<Form />);
    const nombre = screen.getByLabelText('nombre'); const tel = screen.getByLabelText('telefono'); const cerrar = screen.getByLabelText('Cerrar');
    expect(document.activeElement).toBe(nombre);                                          // al abrir: primer campo del cuerpo
    tel.focus(); fireEvent.keyDown(document, { key: 'Tab' });                             // último elemento → primero (✕ del encabezado)
    expect(document.activeElement).toBe(cerrar);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });                          // primero → último
    expect(document.activeElement).toBe(tel);
    (screen.getByText('afuera') as HTMLElement).focus(); fireEvent.keyDown(document, { key: 'Tab' });   // foco fuera → vuelve adentro
    expect(document.activeElement).toBe(cerrar);
  });
  it('el diálogo tiene nombre accesible (su título) y Escape lo cierra', () => {
    render(<Form />);
    expect(screen.getByRole('dialog', { name: 'Datos' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
