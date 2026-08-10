const express = require('express');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

/**
 * GET /api/admin/customers
 * Secured Single-Page Admin View Query
 * Supports optional query params: ?name=john&address=main&phone=555
 *
 * Protected by requireAdmin: caller must send a valid Firebase ID token
 * for a user whose role in the users table is 'admin'.
 */
router.get('/api/admin/customers', requireAdmin, async (req, res) => {
    // Extract dynamic request filters directly from the query URL
    const { name, address, phone } = req.query;

    // Core structural query tracking structural dependencies and hardware status
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

    // Append Dynamic Filtering Conditions
    if (name) {
        queryText += ` AND u.name ILIKE $${paramCounter}`; // ILIKE provides case-insensitive matching
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

    // Aggregate everything neatly grouped by the primary user primary identifier
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
