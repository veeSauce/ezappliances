CREATE TABLE IF NOT EXISTS admin_password_reset_codes (
    id SERIAL PRIMARY KEY,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_password_reset_codes_active
    ON admin_password_reset_codes (admin_user_id, expires_at)
    WHERE used_at IS NULL;
