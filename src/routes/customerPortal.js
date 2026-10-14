const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const requireCustomer = require('../middleware/requireCustomer');
const { hashToken } = require('../lib/adminAuth');
const { sanitizeEmail } = require('../lib/inputSafety');

const router = express.Router();

router.post('/api/customer/login', express.json(), async (req, res) => {
    const email = sanitizeEmail(req.body?.email || '');
    const zip = String(req.body?.zip || '').replace(/\D/g, '').slice(0, 5);
    if (!email || !/^\d{5}$/.test(zip)) {
        return res.status(400).json({ success: false, error: 'Enter your email address and 5-digit billing ZIP code.' });
    }

    try {
        const customer = await pool.query(`
            SELECT id, name, email
            FROM users
            WHERE role = 'customer' AND LOWER(email) = LOWER($1) AND address ILIKE $2
            LIMIT 1
        `, [email, `%${zip}%`]);
        if (customer.rows.length !== 1) {
            return res.status(401).json({ success: false, error: 'We could not verify that customer account.' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + (60 * 60 * 1000));
        await pool.query(
            'INSERT INTO customer_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [customer.rows[0].id, hashToken(token), expiresAt]
        );
        return res.json({ success: true, token, customer: customer.rows[0] });
    } catch (err) {
        console.error('❌ Customer portal login failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to sign in right now.' });
    }
});

router.post('/api/customer/logout', requireCustomer, express.json(), async (req, res) => {
    const [, token] = (req.headers.authorization || '').split(' ');
    await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [hashToken(token)]);
    return res.json({ success: true });
});

router.get('/api/customer/dashboard', requireCustomer, async (req, res) => {
    try {
        const userId = req.customer.id;
        const [customer, payments, subscriptions, activeAppliances, previousAppliances, cancellationRequests, serviceRequests] = await Promise.all([
            pool.query('SELECT name, email, phone_number, address, monthly_rate FROM users WHERE id = $1', [userId]),
            pool.query(`SELECT payment_intent_id, amount_cents, currency, receipt_url, paid_at
                FROM customer_payment_history WHERE user_id = $1 ORDER BY paid_at DESC`, [userId]),
            pool.query(`SELECT id, stripe_price_id, status, current_period_start, current_period_end
                FROM subscriptions WHERE user_id = $1 ORDER BY current_period_end DESC NULLS LAST`, [userId]),
            pool.query(`SELECT e.type, e.model_name, e.serial_number, ra.installation_status, ra.installation_date, ra.billing_start_date
                FROM rental_agreements ra INNER JOIN equipment e ON e.id = ra.equipment_id
                WHERE ra.user_id = $1 AND ra.unassigned_at IS NULL ORDER BY e.type, e.model_name`, [userId]),
            pool.query(`SELECT e.type, e.model_name, e.serial_number, ra.installation_date, ra.billing_start_date, ra.unassigned_at
                FROM rental_agreements ra INNER JOIN equipment e ON e.id = ra.equipment_id
                WHERE ra.user_id = $1 AND ra.unassigned_at IS NOT NULL ORDER BY ra.unassigned_at DESC`, [userId]),
            pool.query(`SELECT id, status, requested_at, scheduled_end_at FROM cancellation_requests
                WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`, [userId]),
            pool.query(`
                SELECT sr.id, sr.description, sr.status, sr.created_at, sr.resolved_at,
                       COALESCE(STRING_AGG(CONCAT(e.type, ' · ', e.model_name, ' (', e.serial_number, ')'), ' | ' ORDER BY e.type, e.model_name), 'No appliance recorded') AS equipment
                FROM service_requests sr
                LEFT JOIN service_request_equipment sre ON sre.service_request_id = sr.id
                LEFT JOIN equipment e ON e.id = sre.equipment_id
                WHERE sr.user_id = $1
                GROUP BY sr.id
                ORDER BY sr.created_at DESC
            `, [userId])
        ]);
        return res.json({
            success: true,
            customer: customer.rows[0],
            payments: payments.rows,
            subscriptions: subscriptions.rows,
            activeAppliances: activeAppliances.rows,
            previousAppliances: previousAppliances.rows,
            cancellationRequest: cancellationRequests.rows[0] || null,
            serviceRequests: serviceRequests.rows
        });
    } catch (err) {
        console.error('❌ Customer portal dashboard failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load your dashboard.' });
    }
});

router.post('/api/customer/cancellation-request', requireCustomer, express.json(), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Serialize requests for one customer without relying on a particular
        // database index being present in older deployments.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.customer.id]);
        const subscription = await client.query(`
            SELECT id FROM subscriptions
            WHERE user_id = $1
              AND status IN ('active', 'trialing', 'past_due')
              AND (current_period_end IS NULL OR current_period_end > NOW())
            ORDER BY current_period_end DESC NULLS LAST
            LIMIT 1
        `, [req.customer.id]);
        if (!subscription.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'There is no active subscription to cancel.' });
        }
        const pending = await client.query(`SELECT id FROM cancellation_requests
            WHERE user_id = $1 AND status = 'requested' LIMIT 1`, [req.customer.id]);
        if (pending.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'A cancellation request is already pending.' });
        }
        const request = await client.query(`
            INSERT INTO cancellation_requests (user_id)
            VALUES ($1)
            RETURNING id, status, requested_at
        `, [req.customer.id]);
        await client.query('COMMIT');
        return res.status(201).json({ success: true, request: request.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Customer cancellation request failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to submit your cancellation request.' });
    } finally {
        client.release();
    }
});

module.exports = router;
