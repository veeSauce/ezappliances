const crypto = require('crypto');
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');
const appLogs = require('../lib/appLogs');
const { sendEmail } = require('../lib/mailer');
const { hashPassword, hashToken, verifyPassword } = require('../lib/adminAuth');

const router = express.Router();

/**
 * POST /api/admin/login
 * Validates an admin user against the admin_users table and returns a DB-backed bearer token.
 */
router.post('/api/admin/login', express.json(), async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawUsername = typeof body.username === 'string' ? body.username : '';
    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const loginValue = (rawEmail || rawUsername).trim();
    const isEmailLogin = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginValue);
    // Credentials must be validated, never sanitized: changing an identifier
    // or password before verification can make correct credentials fail.
    const password = typeof body.password === 'string' ? body.password : '';

    if (!loginValue || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username or email and password are required.'
        });
    }

    if (!isEmailLogin && !/^[A-Za-z0-9\s'\-.]{2,}$/.test(loginValue)) {
        return res.status(400).json({ success: false, error: 'Username contains invalid characters.' });
    }

    try {
        const result = await pool.query(`
            SELECT id, username, email, password_hash, salt, is_active
            FROM admin_users
            WHERE is_active = TRUE
              AND (username = $1 OR LOWER(email) = LOWER($1))
        `, [loginValue]);

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid admin credentials.' });
        }

        const adminUser = result.rows[0];

        if (!verifyPassword(password, adminUser.password_hash, adminUser.salt)) {
            return res.status(401).json({ success: false, error: 'Invalid admin credentials.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + (8 * 60 * 60 * 1000));

        await pool.query(`
            INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
            VALUES ($1, $2, $3)
        `, [adminUser.id, hashToken(token), expiresAt]);

        return res.status(200).json({
            success: true,
            token,
            admin: {
                id: adminUser.id,
                username: adminUser.username,
                email: adminUser.email
            }
        });
    } catch (err) {
        console.error('❌ Admin login failed:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error during admin login.' });
    }
});

router.post('/api/admin/logout', requireAdmin, express.json(), async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.split(' ');

    if (!token) {
        return res.status(400).json({ success: false, error: 'Session token is required.' });
    }

    try {
        await pool.query(`
            UPDATE admin_sessions
            SET revoked_at = NOW()
            WHERE token_hash = $1
        `, [hashToken(token)]);

        return res.status(200).json({ success: true, message: 'Logged out successfully.' });
    } catch (err) {
        console.error('❌ Admin logout failed:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error during logout.' });
    }
});

function validAdminIdentifier(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^[A-Za-z0-9\s'\-.]{2,}$/.test(value);
}

router.post('/api/admin/request-password-reset', express.json(), async (req, res) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
    const genericResponse = { success: true, message: 'If the account is eligible, a reset code has been sent.' };
    if (!identifier || !validAdminIdentifier(identifier)) return res.status(200).json(genericResponse);

    try {
        const account = await pool.query(
            `SELECT id, username FROM admin_users
             WHERE is_active = TRUE AND (username = $1 OR LOWER(email) = LOWER($1))`,
            [identifier]
        );
        if (account.rows.length !== 1) return res.status(200).json(genericResponse);

        const admin = account.rows[0];
        const recent = await pool.query(
            `SELECT created_at FROM admin_password_reset_codes
             WHERE admin_user_id = $1 AND used_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [admin.id]
        );
        if (recent.rows[0] && Date.now() - new Date(recent.rows[0].created_at).getTime() < 60_000) return res.status(200).json(genericResponse);

        const code = crypto.randomBytes(8).toString('hex').toUpperCase();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE admin_password_reset_codes SET used_at = NOW() WHERE admin_user_id = $1 AND used_at IS NULL', [admin.id]);
            await client.query(
                `INSERT INTO admin_password_reset_codes (admin_user_id, code_hash, expires_at)
                 VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
                [admin.id, hashToken(code)]
            );
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        try {
            await sendEmail({
                to: process.env.PASSWORD_RESET_RECIPIENT || 'inquiry@ezappliancesupport.com',
                subject: 'EZ Appliances admin password reset code',
                text: `A password reset was requested for admin account ${admin.username}.\n\nYour one-time code is: ${code}\n\nIt expires in 15 minutes. If you did not request this, you can ignore this email.`
            });
        } catch (err) {
            await pool.query('UPDATE admin_password_reset_codes SET used_at = NOW() WHERE code_hash = $1 AND used_at IS NULL', [hashToken(code)]);
            console.error('❌ Admin password reset email failed:', err.message);
        }
        return res.status(200).json(genericResponse);
    } catch (err) {
        console.error('❌ Admin password reset request failed:', err.message);
        return res.status(200).json(genericResponse);
    }
});

router.post('/api/admin/reset-password', express.json(), async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!code || newPassword.length < 12) {
        return res.status(400).json({ success: false, error: 'A reset code and a new password of at least 12 characters are required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const reset = await client.query(
            `SELECT id, admin_user_id FROM admin_password_reset_codes
             WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
            [hashToken(code)]
        );
        if (reset.rows.length !== 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'That reset code is invalid or has expired.' });
        }

        const { passwordHash, salt } = hashPassword(newPassword);
        const resetCode = reset.rows[0];
        await client.query('UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3', [passwordHash, salt, resetCode.admin_user_id]);
        await client.query('UPDATE admin_password_reset_codes SET used_at = NOW() WHERE id = $1', [resetCode.id]);
        await client.query('UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_user_id = $1 AND revoked_at IS NULL', [resetCode.admin_user_id]);
        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Password updated. You can now sign in.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Admin password reset failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to reset password.' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/admin/change-password
 * Changes the password for the authenticated admin after confirming the current password.
 */
router.post('/api/admin/change-password', requireAdmin, express.json(), async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Current and new passwords are required.' });
    }
    if (newPassword.length < 12) {
        return res.status(400).json({ success: false, error: 'New password must be at least 12 characters.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await client.query(
            'SELECT password_hash, salt FROM admin_users WHERE id = $1 AND is_active = TRUE FOR UPDATE',
            [req.admin.id]
        );
        if (user.rows.length !== 1 || !verifyPassword(currentPassword, user.rows[0].password_hash, user.rows[0].salt)) {
            await client.query('ROLLBACK');
            return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
        }

        const { passwordHash, salt } = hashPassword(newPassword);
        await client.query(
            'UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3',
            [passwordHash, salt, req.admin.id]
        );
        await client.query(
            'UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_user_id = $1 AND revoked_at IS NULL',
            [req.admin.id]
        );
        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Password updated. Please sign in again.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Admin password change failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to update password.' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/admin/logs/stream
 * Streams recent in-memory application logs to an authenticated admin browser.
 */
router.get('/api/admin/logs/stream', requireAdmin, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.write(`event: logs\ndata: ${JSON.stringify(appLogs.recent(200))}\n\n`);

    let lastId = 0;
    const sendUpdates = () => {
        const latest = appLogs.recent(200).filter((entry) => entry.id > lastId);
        if (latest.length) {
            lastId = latest[latest.length - 1].id;
            res.write(`event: logs\ndata: ${JSON.stringify(latest)}\n\n`);
        } else {
            res.write(': keepalive\n\n');
        }
    };
    const initial = appLogs.recent(200);
    if (initial.length) lastId = initial[initial.length - 1].id;
    const timer = setInterval(sendUpdates, 1500);
    req.on('close', () => clearInterval(timer));
});

/**
 * GET /api/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Provides operational summaries. Past-due balances are estimated from the
 * recorded monthly rate because the database does not store invoice balances.
 */
router.get('/api/admin/metrics', requireAdmin, async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    const isDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isDate(from) || !isDate(to) || (from && to && from > to)) {
        return res.status(400).json({ success: false, error: 'Use valid from/to dates in YYYY-MM-DD format.' });
    }

    try {
        const [requests, activeCustomers, pendingCustomers, equipment, pastDue] = await Promise.all([
            pool.query(`
                SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE requested_appliance_type = 'washer')::int AS washer,
                       COUNT(*) FILTER (WHERE requested_appliance_type = 'dryer')::int AS dryer,
                       COUNT(*) FILTER (WHERE requested_appliance_type = 'washer_dryer_pair')::int AS washer_dryer_pair,
                       COUNT(*) FILTER (WHERE requested_appliance_type = 'stacked_dryer')::int AS stacked_dryer
                FROM users
                WHERE role = 'customer'
                  AND COALESCE(order_requested_at, created_at) >= COALESCE($1::date, '-infinity'::date)
                  AND COALESCE(order_requested_at, created_at) < COALESCE($2::date + INTERVAL '1 day', 'infinity'::timestamp)
            `, [from, to]),
            pool.query(`SELECT COUNT(*)::int AS count FROM users u WHERE u.role = 'customer'
                AND EXISTS (SELECT 1 FROM rental_agreements ra WHERE ra.user_id = u.id AND ra.unassigned_at IS NULL)`),
            pool.query(`SELECT COUNT(*)::int AS count FROM users u WHERE u.role = 'customer'
                AND NOT EXISTS (SELECT 1 FROM rental_agreements ra WHERE ra.user_id = u.id)`),
            pool.query(`SELECT status, COUNT(*)::int AS count FROM equipment GROUP BY status ORDER BY status`),
            pool.query(`
                SELECT u.id, u.name, u.email, u.phone_number, u.monthly_rate
                FROM users u
                WHERE u.role = 'customer'
                  AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'past_due')
                ORDER BY u.name
            `)
        ]);
        const pastDueCustomers = pastDue.rows.map((customer) => ({
            ...customer,
            estimated_outstanding_balance: Number(customer.monthly_rate || 0)
        }));
        return res.json({
            success: true,
            filters: { from, to },
            requestCounts: requests.rows[0],
            activeCustomerCount: activeCustomers.rows[0].count,
            pendingCustomerCount: pendingCustomers.rows[0].count,
            equipmentByStatus: equipment.rows,
            pastDue: {
                count: pastDueCustomers.length,
                estimatedOutstandingBalance: pastDueCustomers.reduce((total, customer) => total + customer.estimated_outstanding_balance, 0),
                customers: pastDueCustomers
            }
        });
    } catch (err) {
        console.error('❌ Admin metrics query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load admin metrics.' });
    }
});

/**
 * GET /api/admin/customers
 * Secured Single-Page Admin View Query
 * Supports optional query params: ?name=john&address=main&phone=555
 */
router.get('/api/admin/customers', requireAdmin, async (req, res) => {
    const { name, address, phone } = req.query;

    let queryText = `
        SELECT
            u.id AS user_id,
            u.name,
            u.address,
            u.phone_number,
            u.monthly_rate,
            COALESCE(STRING_AGG(e.type, ', '), 'No Unit Assigned') AS held_units,
            ra.installation_status,
            ra.billing_start_date,
            CASE WHEN sub.status IN ('active', 'trialing', 'past_due')
                      AND (sub.current_period_end IS NULL OR sub.current_period_end > NOW())
                 THEN TRUE ELSE FALSE END AS currently_subscribed,
            cancellation.status AS cancellation_status,
            cancellation.scheduled_end_at,
            FALSE AS past_due
        FROM users u
        LEFT JOIN rental_agreements ra ON u.id = ra.user_id AND ra.unassigned_at IS NULL
        LEFT JOIN equipment e ON ra.equipment_id = e.id
        LEFT JOIN LATERAL (
            SELECT status, current_period_end FROM subscriptions
            WHERE user_id = u.id ORDER BY current_period_end DESC NULLS LAST LIMIT 1
        ) sub ON TRUE
        LEFT JOIN LATERAL (
            SELECT status, scheduled_end_at FROM cancellation_requests
            WHERE user_id = u.id ORDER BY requested_at DESC LIMIT 1
        ) cancellation ON TRUE
        WHERE u.role = 'customer'
          AND EXISTS (SELECT 1 FROM rental_agreements prior_ra WHERE prior_ra.user_id = u.id)
    `;

    const queryParams = [];
    let paramCounter = 1;

    if (name) {
        queryText += ` AND u.name ILIKE $${paramCounter}`;
        queryParams.push(`%${name}%`);
        paramCounter++;
    }

    if (address) {
        queryText += ` AND u.address ILIKE $${paramCounter}`;
        queryParams.push(`%${address}%`);
        paramCounter++;
    }

    if (phone) {
        queryText += ` AND u.phone_number LIKE $${paramCounter}`;
        queryParams.push(`%${phone}%`);
        paramCounter++;
    }

    queryText += ` GROUP BY u.id, u.monthly_rate, ra.installation_status, ra.billing_start_date, sub.status, sub.current_period_end, cancellation.status, cancellation.scheduled_end_at ORDER BY u.name ASC;`;

    try {
        const result = await pool.query(queryText, queryParams);
        return res.status(200).json({
            success: true,
            count: result.rows.length,
            customers: result.rows
        });
    } catch (err) {
        console.error('❌ Admin customer portal query exception caught:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error processing administration query request.'
        });
    }
});

/**
 * GET /api/admin/new-customers
 * Lists pending delivery requests that have not yet been assigned equipment.
 */
router.get('/api/admin/new-customers', requireAdmin, async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                u.id AS user_id,
                u.name,
                u.email,
                u.phone_number,
                u.address,
                u.requested_appliance_type,
                u.preferred_delivery_date,
                COALESCE(u.order_requested_at, u.created_at) AS requested_at
            FROM users u
            WHERE u.role = 'customer'
              AND NOT EXISTS (SELECT 1 FROM rental_agreements ra WHERE ra.user_id = u.id)
            ORDER BY COALESCE(u.order_requested_at, u.created_at) DESC
        `);
        return res.status(200).json({ success: true, count: result.rows.length, customers: result.rows });
    } catch (err) {
        console.error('❌ Admin new customer query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load new customer requests.' });
    }
});

router.get('/api/admin/service-requests', requireAdmin, async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT sr.id, sr.description, sr.status, sr.created_at, sr.resolved_at,
                   u.id AS user_id, u.name, u.email, u.phone_number,
                   COALESCE(STRING_AGG(CONCAT(e.type, ' · ', e.model_name, ' (', e.serial_number, ')'), ' | ' ORDER BY e.type, e.model_name), 'No appliance recorded') AS equipment
            FROM service_requests sr
            INNER JOIN users u ON u.id = sr.user_id
            LEFT JOIN service_request_equipment sre ON sre.service_request_id = sr.id
            LEFT JOIN equipment e ON e.id = sre.equipment_id
            GROUP BY sr.id, u.id
            ORDER BY CASE sr.status WHEN 'reported' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, sr.created_at DESC
        `);
        return res.json({ success: true, requests: result.rows });
    } catch (err) {
        console.error('❌ Admin service request query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load service requests.' });
    }
});

router.patch('/api/admin/service-requests/:requestId', requireAdmin, express.json(), async (req, res) => {
    const status = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!['reported', 'in_progress', 'resolved'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Use a valid service request status.' });
    }
    try {
        const result = await pool.query(`
            UPDATE service_requests
            SET status = $1, resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE NULL END
            WHERE id = $2
            RETURNING id, status, resolved_at
        `, [status, req.params.requestId]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Service request not found.' });
        return res.json({ success: true, request: result.rows[0] });
    } catch (err) {
        console.error('❌ Admin service request update failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to update service request.' });
    }
});

router.get('/api/admin/inventory', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.id, e.serial_number, e.model_name, e.type, e.status,
                   u.id AS customer_id, u.name AS customer_name
            FROM equipment e
            LEFT JOIN rental_agreements ra ON ra.equipment_id = e.id AND ra.unassigned_at IS NULL
            LEFT JOIN users u ON u.id = ra.user_id AND u.role = 'customer'
            ORDER BY e.type, e.model_name, e.serial_number
        `);
        return res.json({ success: true, inventory: result.rows });
    } catch (err) {
        console.error('❌ Admin inventory query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load inventory.' });
    }
});

router.post('/api/admin/inventory', requireAdmin, express.json(), async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const type = typeof body.type === 'string' ? body.type : '';
    const serialNumber = typeof body.serialNumber === 'string' ? body.serialNumber.trim() : '';
    const make = typeof body.make === 'string' ? body.make.trim() : '';
    const allowedTypes = new Set(['washer', 'dryer', 'stacked_dryer']);

    if (!allowedTypes.has(type) || !serialNumber || !make) {
        return res.status(400).json({ success: false, error: 'Unit type, serial number, and make are required.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO equipment (serial_number, model_name, type, status)
            VALUES ($1, $2, $3, 'available')
            RETURNING id, serial_number, model_name, type, status
        `, [serialNumber, make, type]);
        return res.status(201).json({ success: true, appliance: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'An appliance with that serial number already exists.' });
        }
        console.error('❌ Admin inventory creation failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to add appliance.' });
    }
});

router.get('/api/admin/customers/:customerId', requireAdmin, async (req, res) => {
    try {
        const customer = await pool.query(`
            SELECT id, name, email, address, phone_number, monthly_rate, FALSE AS past_due
            FROM users WHERE id = $1 AND role = 'customer'
        `, [req.params.customerId]);
        if (customer.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Customer not found.' });
        }

        const [assignments, assignmentHistory, availableEquipment, subscription, cancellationRequest] = await Promise.all([
            pool.query(`
                SELECT ra.id, ra.equipment_id, ra.monthly_rate, ra.installation_status, ra.installation_date,
                       ra.billing_start_date, ra.created_at, e.serial_number, e.model_name, e.type
                FROM rental_agreements ra
                INNER JOIN equipment e ON e.id = ra.equipment_id
                WHERE ra.user_id = $1 AND ra.unassigned_at IS NULL
                ORDER BY e.type, e.model_name
            `, [req.params.customerId]),
            pool.query(`
                SELECT ra.id, ra.monthly_rate, ra.installation_status, ra.installation_date,
                       ra.billing_start_date, ra.created_at, ra.unassigned_at,
                       e.serial_number, e.model_name, e.type
                FROM rental_agreements ra
                INNER JOIN equipment e ON e.id = ra.equipment_id
                WHERE ra.user_id = $1 AND ra.unassigned_at IS NOT NULL
                ORDER BY ra.unassigned_at DESC
            `, [req.params.customerId]),
            pool.query(`
                SELECT e.id, e.serial_number, e.model_name, e.type
                FROM equipment e
                WHERE NOT EXISTS (
                    SELECT 1 FROM rental_agreements ra WHERE ra.equipment_id = e.id AND ra.unassigned_at IS NULL
                )
                ORDER BY e.type, e.model_name, e.serial_number
            `),
            pool.query(`SELECT id, stripe_price_id, status, current_period_start, current_period_end
                FROM subscriptions WHERE user_id = $1 ORDER BY current_period_end DESC NULLS LAST LIMIT 1`, [req.params.customerId]),
            pool.query(`SELECT id, status, requested_at, scheduled_end_at
                FROM cancellation_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`, [req.params.customerId])
        ]);

        return res.json({
            success: true,
            customer: customer.rows[0],
            assignments: assignments.rows,
            assignmentHistory: assignmentHistory.rows,
            availableEquipment: availableEquipment.rows,
            subscription: subscription.rows[0] || null,
            cancellationRequest: cancellationRequest.rows[0] || null
        });
    } catch (err) {
        console.error('❌ Admin customer detail query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load customer details.' });
    }
});

router.post('/api/admin/customers/:customerId/subscription/cancel', requireAdmin, express.json(), async (req, res) => {
    try {
        const request = await pool.query(`SELECT id FROM cancellation_requests
            WHERE user_id = $1 AND status = 'requested' ORDER BY requested_at DESC LIMIT 1`, [req.params.customerId]);
        const subscription = await pool.query(`SELECT id FROM subscriptions
            WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')
            ORDER BY current_period_end DESC NULLS LAST LIMIT 1`, [req.params.customerId]);
        if (!request.rows[0]) return res.status(409).json({ success: false, error: 'There is no pending cancellation request.' });
        if (!subscription.rows[0]) return res.status(409).json({ success: false, error: 'This customer has no active subscription to cancel.' });

        const stripeSubscription = await stripe.subscriptions.update(subscription.rows[0].id, { cancel_at_period_end: true });
        const scheduledEnd = new Date(stripeSubscription.current_period_end * 1000);
        await pool.query(`UPDATE cancellation_requests
            SET status = 'pending_cancellation', scheduled_end_at = $1, processed_at = NOW()
            WHERE id = $2`, [scheduledEnd, request.rows[0].id]);
        await pool.query('UPDATE subscriptions SET current_period_end = $1 WHERE id = $2', [scheduledEnd, subscription.rows[0].id]);
        return res.json({ success: true, scheduledEnd });
    } catch (err) {
        console.error('❌ Admin subscription cancellation failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to schedule the subscription cancellation.' });
    }
});

router.post('/api/admin/customers/:customerId/subscription/reenroll', requireAdmin, express.json(), async (req, res) => {
    try {
        const customer = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1 AND role = \'customer\'', [req.params.customerId]);
        const latest = await pool.query(`SELECT id, stripe_price_id, status FROM subscriptions
            WHERE user_id = $1 ORDER BY current_period_end DESC NULLS LAST LIMIT 1`, [req.params.customerId]);
        if (!customer.rows[0]?.stripe_customer_id || !latest.rows[0]?.stripe_price_id) {
            return res.status(409).json({ success: false, error: 'A saved Stripe customer and prior subscription price are required to re-enroll this customer.' });
        }

        const prior = latest.rows[0];
        let stripeSubscription;
        if (prior.status !== 'canceled') {
            stripeSubscription = await stripe.subscriptions.update(prior.id, { cancel_at_period_end: false });
        } else {
            stripeSubscription = await stripe.subscriptions.create({
                customer: customer.rows[0].stripe_customer_id,
                items: [{ price: prior.stripe_price_id }]
            });
        }
        const startsAt = new Date(stripeSubscription.current_period_start * 1000);
        const endsAt = new Date(stripeSubscription.current_period_end * 1000);
        await pool.query(`INSERT INTO subscriptions (id, user_id, stripe_price_id, status, current_period_start, current_period_end)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end`,
            [stripeSubscription.id, req.params.customerId, prior.stripe_price_id, stripeSubscription.status, startsAt, endsAt]);
        await pool.query(`UPDATE cancellation_requests SET status = 're_enrolled', resolved_at = NOW(), processed_at = NOW()
            WHERE user_id = $1 AND status IN ('requested', 'pending_cancellation')`, [req.params.customerId]);
        return res.json({ success: true, startsAt, endsAt });
    } catch (err) {
        console.error('❌ Admin subscription re-enrollment failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to re-enroll this customer. Confirm that Stripe has a valid saved payment method.' });
    }
});

router.post('/api/admin/customers/:customerId/assignments', requireAdmin, express.json(), async (req, res) => {
    const { equipmentId, installationStatus = 'pending', installationDate = null, billingStartDate = null } = req.body || {};
    const allowedStatuses = new Set(['pending', 'scheduled', 'completed']);

    if (!Number.isInteger(Number(equipmentId)) || !allowedStatuses.has(installationStatus)) {
        return res.status(400).json({ success: false, error: 'Choose an available appliance and a valid installation status.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const customer = await client.query('SELECT id FROM users WHERE id = $1 AND role = \'customer\' FOR UPDATE', [req.params.customerId]);
        const equipment = await client.query('SELECT id FROM equipment WHERE id = $1 FOR UPDATE', [equipmentId]);
        const alreadyAssigned = await client.query('SELECT id FROM rental_agreements WHERE equipment_id = $1 AND unassigned_at IS NULL', [equipmentId]);
        if (customer.rows.length === 0) throw new Error('CUSTOMER_NOT_FOUND');
        if (equipment.rows.length === 0) throw new Error('EQUIPMENT_NOT_FOUND');
        if (alreadyAssigned.rows.length > 0) throw new Error('EQUIPMENT_ASSIGNED');
        const assignedCount = await client.query('SELECT COUNT(*)::int AS count FROM rental_agreements WHERE user_id = $1 AND unassigned_at IS NULL', [req.params.customerId]);
        if (assignedCount.rows[0].count >= 2) throw new Error('MAXIMUM_ASSIGNMENTS');
        const monthlyRate = assignedCount.rows[0].count === 0 ? 29.99 : 49.99;

        await client.query(`
            INSERT INTO rental_agreements
                (user_id, equipment_id, monthly_rate, installation_status, installation_date, billing_start_date)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [req.params.customerId, equipmentId, monthlyRate, installationStatus, installationDate || null, billingStartDate || null]);
        await client.query("UPDATE equipment SET status = 'rented' WHERE id = $1", [equipmentId]);
        await client.query('UPDATE users SET monthly_rate = $1 WHERE id = $2', [monthlyRate, req.params.customerId]);
        await client.query('COMMIT');
        return res.status(201).json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        const errors = {
            CUSTOMER_NOT_FOUND: 'Customer not found.', EQUIPMENT_NOT_FOUND: 'Appliance not found.',
            EQUIPMENT_ASSIGNED: 'This appliance is already assigned.',
            MAXIMUM_ASSIGNMENTS: 'A customer may have a maximum of two appliances.'
        };
        if (errors[err.message]) return res.status(409).json({ success: false, error: errors[err.message] });
        console.error('❌ Admin assignment creation failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to assign appliance.' });
    } finally {
        client.release();
    }
});

router.patch('/api/admin/customers/:customerId/assignments/:assignmentId', requireAdmin, express.json(), async (req, res) => {
    const { installationStatus, installationDate = null, billingStartDate = null } = req.body || {};
    if (!['pending', 'scheduled', 'completed'].includes(installationStatus)) {
        return res.status(400).json({ success: false, error: 'Invalid installation status.' });
    }
    try {
        const result = await pool.query(`
            UPDATE rental_agreements
            SET installation_status = $1, installation_date = $2, billing_start_date = $3
            WHERE id = $4 AND user_id = $5 AND unassigned_at IS NULL
        `, [installationStatus, installationDate || null, billingStartDate || null, req.params.assignmentId, req.params.customerId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Assignment not found.' });
        return res.json({ success: true });
    } catch (err) {
        console.error('❌ Admin assignment update failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to update assignment.' });
    }
});

router.delete('/api/admin/customers/:customerId/assignments/:assignmentId', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const assignment = await client.query(`
            UPDATE rental_agreements
            SET unassigned_at = NOW()
            WHERE id = $1 AND user_id = $2 AND unassigned_at IS NULL
            RETURNING equipment_id
        `, [req.params.assignmentId, req.params.customerId]);
        if (assignment.rows.length === 0) throw new Error('ASSIGNMENT_NOT_FOUND');
        await client.query("UPDATE equipment SET status = 'available' WHERE id = $1", [assignment.rows[0].equipment_id]);
        const remaining = await client.query('SELECT COUNT(*)::int AS count FROM rental_agreements WHERE user_id = $1 AND unassigned_at IS NULL', [req.params.customerId]);
        const monthlyRate = remaining.rows[0].count === 0 ? 0 : remaining.rows[0].count === 1 ? 29.99 : 49.99;
        await client.query('UPDATE users SET monthly_rate = $1 WHERE id = $2', [monthlyRate, req.params.customerId]);
        await client.query('COMMIT');
        return res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, error: 'Assignment not found.' });
        console.error('❌ Admin assignment removal failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to unassign appliance.' });
    } finally {
        client.release();
    }
});

module.exports = router;
