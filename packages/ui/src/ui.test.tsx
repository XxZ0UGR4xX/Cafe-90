import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RetroButton, RetroDialog, RetroModal, RetroTable, RetroTabs, RetroStatCard, RetroToastProvider, useToast, formatMoney, mmss, niceScale, RetroKitchenTicket, RetroTableCard } from './index';

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
