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
            FALSE AS past_due
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

    queryText += ` GROUP BY u.id, u.monthly_rate, ra.installation_status, ra.billing_start_date ORDER BY u.name ASC;`;

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

router.get('/api/admin/inventory', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.id, e.serial_number, e.model_name, e.type, e.status,
                   u.id AS customer_id, u.name AS customer_name
            FROM equipment e
            LEFT JOIN rental_agreements ra ON ra.equipment_id = e.id
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

        const [assignments, availableEquipment] = await Promise.all([
            pool.query(`
                SELECT ra.id, ra.equipment_id, ra.monthly_rate, ra.installation_status, ra.installation_date,
                       ra.billing_start_date, ra.created_at, e.serial_number, e.model_name, e.type
                FROM rental_agreements ra
                INNER JOIN equipment e ON e.id = ra.equipment_id
                WHERE ra.user_id = $1
                ORDER BY e.type, e.model_name
            `, [req.params.customerId]),
            pool.query(`
                SELECT e.id, e.serial_number, e.model_name, e.type
                FROM equipment e
                WHERE NOT EXISTS (
                    SELECT 1 FROM rental_agreements ra WHERE ra.equipment_id = e.id
                )
                ORDER BY e.type, e.model_name, e.serial_number
            `)
        ]);

        return res.json({
            success: true,
            customer: customer.rows[0],
            assignments: assignments.rows,
            availableEquipment: availableEquipment.rows
        });
    } catch (err) {
        console.error('❌ Admin customer detail query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load customer details.' });
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
        const alreadyAssigned = await client.query('SELECT id FROM rental_agreements WHERE equipment_id = $1', [equipmentId]);
        if (customer.rows.length === 0) throw new Error('CUSTOMER_NOT_FOUND');
        if (equipment.rows.length === 0) throw new Error('EQUIPMENT_NOT_FOUND');
        if (alreadyAssigned.rows.length > 0) throw new Error('EQUIPMENT_ASSIGNED');
        const assignedCount = await client.query('SELECT COUNT(*)::int AS count FROM rental_agreements WHERE user_id = $1', [req.params.customerId]);
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
            WHERE id = $4 AND user_id = $5
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
            DELETE FROM rental_agreements WHERE id = $1 AND user_id = $2 RETURNING equipment_id
        `, [req.params.assignmentId, req.params.customerId]);
        if (assignment.rows.length === 0) throw new Error('ASSIGNMENT_NOT_FOUND');
        await client.query("UPDATE equipment SET status = 'available' WHERE id = $1", [assignment.rows[0].equipment_id]);
        const remaining = await client.query('SELECT COUNT(*)::int AS count FROM rental_agreements WHERE user_id = $1', [req.params.customerId]);
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
