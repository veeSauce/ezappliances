-- Ensures only one customer cancellation request can await staff review.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_cancellation_per_customer
    ON cancellation_requests (user_id)
    WHERE status = 'requested';
