import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { apiBase, getToken } from './api';
import { useSession } from './auth';
import { play } from './sound';

type Handler = (payload: any) => void;
const listeners = new Map<string, Set<Handler>>();
let socket: Socket | null = null;

export function connectRealtime() {
  if (socket || !getToken()) return;
  socket = io(apiBase, { path: '/ws', auth: (cb) => cb({ token: getToken() }), transports: ['websocket'], reconnectionDelayMax: 8000 });
  socket.onAny((event, payload) => listeners.get(event)?.forEach((h) => h(payload)));
}
export function disconnectRealtime() { socket?.close(); socket = null; }
export function isRealtimeUp() { return !!socket?.connected; }

/** Suscribe a un evento en tiempo real (KitchenChanged, TableChanged, ...). */
export function useRealtime(event: string | string[], handler: Handler) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    const evs = Array.isArray(event) ? event : [event]; const fn: Handler = (p) => ref.current(p);
    for (const e of evs) { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e)!.add(fn); }
    return () => { for (const e of evs) listeners.get(e)?.delete(fn); };
  }, [Array.isArray(event) ? event.join('|') : event]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** Invalida consultas cuando llegan eventos y reproduce sonidos (pedido nuevo / listo). Se monta una vez en el shell. */
export function useRealtimeSync() {
  const qc = useQueryClient(); const status = useSession((s) => s.status);
  useEffect(() => { if (status === 'ready') connectRealtime(); else disconnectRealtime(); return disconnectRealtime; }, [status]);
  useRealtime(['KitchenChanged', 'KitchenTicketChanged'], (p) => { qc.invalidateQueries({ queryKey: ['kitchen'] }); if (p?.new) play('newOrder'); });
  useRealtime(['TableChanged', 'OrderCreated', 'OrderStatusChanged', 'PaymentReceived', 'OrderCancelled', 'OrderPaid'], () => { qc.invalidateQueries({ queryKey: ['tables'] }); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); });
  useRealtime('OrderItemsReady', () => play('ready'));
  useRealtime('DeliveryChanged', () => qc.invalidateQueries({ queryKey: ['delivery'] }));
  useRealtime('ReservationChanged', () => qc.invalidateQueries({ queryKey: ['reservations'] }));
  useRealtime('Notification', () => { qc.invalidateQueries({ queryKey: ['notifications'] }); play('newOrder'); });
}
