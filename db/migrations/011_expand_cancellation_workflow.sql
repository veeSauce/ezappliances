ALTER TABLE cancellation_requests
    ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE cancellation_requests
    DROP CONSTRAINT IF EXISTS cancellation_requests_status_check;

ALTER TABLE cancellation_requests
    ADD CONSTRAINT cancellation_requests_status_check
    CHECK(status IN ('requested', 'pending_cancellation', 'cancelled', 'declined', 're_enrolled'));
