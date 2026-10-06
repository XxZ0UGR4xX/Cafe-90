-- 005: cargo de envío en la orden.
ALTER TABLE orders ADD COLUMN delivery_fee numeric(14,4) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
