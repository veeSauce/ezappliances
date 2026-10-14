CREATE TABLE IF NOT EXISTS cancellation_requests (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'pending_cancellation', 'cancelled', 'declined', 're_enrolled')),
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scheduled_end_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_cancellation_per_customer
    ON cancellation_requests (user_id) WHERE status = 'requested';
