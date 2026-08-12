-- 1. USERS TABLE (Handles Identity Mapping)
CREATE TABLE users (
    id TEXT PRIMARY KEY,                       -- Unique system user identifier
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone_number TEXT UNIQUE,
    address TEXT NOT NULL,
    role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'admin')),
    monthly_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
    stripe_customer_id TEXT UNIQUE,            -- Linked Stripe customer token
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. ADMIN AUTH TABLES (Simple Postgres-backed access control)
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_sessions (
    id SERIAL PRIMARY KEY,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. EQUIPMENT TABLE (Tracks physical appliances)
CREATE TABLE equipment (
    id SERIAL PRIMARY KEY,
    serial_number TEXT UNIQUE NOT NULL,
    model_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('washer', 'dryer', 'washer_dryer_pair', 'stacked_dryer')),
    status TEXT DEFAULT 'available' CHECK(status IN ('available', 'rented', 'maintenance')),
    last_inspected_at TIMESTAMP WITH TIME ZONE
);

-- 3. SUBSCRIPTIONS TABLE (Manages financial ties to Stripe)
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,                       -- Stripe Subscription ID (sub_xxxx)
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    stripe_price_id TEXT NOT NULL,             -- Corresponds to specific Stripe product pricing
    status TEXT NOT NULL,                      -- active, past_due, canceled
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE
);

-- 4. RENTAL_AGREEMENTS TABLE (Binds equipment to users & billing)
CREATE TABLE rental_agreements (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
    monthly_rate NUMERIC(10, 2) NOT NULL,      -- Exact decimal precision for financial math
    installation_fee NUMERIC(10, 2) DEFAULT 35.00,
    installation_status TEXT DEFAULT 'pending' CHECK(installation_status IN ('pending', 'scheduled', 'completed')),
    installation_date DATE,
    billing_start_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create tactical database indexes for Admin Page querying optimization
CREATE INDEX idx_users_search ON users (name, address, phone_number);
CREATE INDEX idx_agreements_user ON rental_agreements (user_id);
