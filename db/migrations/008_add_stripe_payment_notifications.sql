CREATE TABLE IF NOT EXISTS stripe_payment_notifications (
    payment_intent_id TEXT NOT NULL,
    notification_type TEXT NOT NULL CHECK(notification_type IN ('receipt', 'failure')),
    checkout_session_id TEXT,
    stripe_event_id TEXT NOT NULL UNIQUE,
    customer_email TEXT NOT NULL,
    receipt_url TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payment_intent_id, notification_type)
);
