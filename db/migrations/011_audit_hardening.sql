-- 011: endurecimiento tras la auditoría
-- · orders.refunded_total: una devolución parcial deja la venta PAGADA (cuenta en reportes) y lleva lo devuelto aparte
-- · order_discounts.self_approved: descuento manual aprobado sin supervisor (se revoca si la cuenta baja y supera el umbral)
ALTER TABLE orders ADD COLUMN refunded_total numeric(14,4) NOT NULL DEFAULT 0 CHECK (refunded_total >= 0);
ALTER TABLE order_discounts ADD COLUMN self_approved boolean NOT NULL DEFAULT false;

-- Un pedido con clientUuid que se fusiona en la cuenta abierta de una mesa conserva su uuid como alias:
-- los reintentos no duplican y las operaciones offline posteriores (pago, cancelación) encuentran la cuenta.
CREATE TABLE order_client_aliases (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  client_uuid uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, client_uuid)
);
SELECT enable_tenant_rls('order_client_aliases');
