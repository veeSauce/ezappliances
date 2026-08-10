const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { hashPassword, hashToken, verifyPassword } = require('../lib/adminAuth');

const router = express.Router();

/**
 * POST /api/admin/login
 * Validates an admin user against the admin_users table and returns a DB-backed bearer token.
 */
router.post('/api/admin/login', express.json(), async (req, res) => {
    const { username, email, password } = req.body;
    const loginValue = username || email;

    if (!loginValue || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username or email and password are required.'
        });
    }

    try {
        const result = await pool.query(`
            SELECT id, username, email, password_hash, salt, is_active
            FROM admin_users
            WHERE is_active = TRUE
              AND (username = $1 OR email = $1)
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
            COALESCE(STRING_AGG(e.type, ', '), 'No Unit Assigned') AS held_units,
            ra.installation_status,
            ra.billing_start_date
        FROM users u
        LEFT JOIN rental_agreements ra ON u.id = ra.user_id
        LEFT JOIN equipment e ON ra.equipment_id = e.id
        WHERE u.role = 'customer'
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

    queryText += ` GROUP BY u.id, ra.installation_status, ra.billing_start_date ORDER BY u.name ASC;`;

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

module.exports = router;
