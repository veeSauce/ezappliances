ALTER TABLE users
    ADD COLUMN IF NOT EXISTS requested_appliance_type TEXT,
    ADD COLUMN IF NOT EXISTS preferred_delivery_date DATE,
    ADD COLUMN IF NOT EXISTS order_requested_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_pending_orders
    ON users (order_requested_at DESC)
    WHERE role = 'customer';
