const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

/**
 * POST /api/orders
 * Accepts a delivery request submitted from the homepage booking form.
 * This is a minimal first pass: it stores the request as a lead, since
 * equipment assignment normally happens after staff review.
 *
 * TODO: once an equipment unit is assigned, create the matching row in
 * rental_agreements and kick off the Stripe subscription/checkout flow.
 */
router.post('/api/orders', express.json(), async (req, res) => {
    const { fullName, phone, email, address, applianceType, deliveryDate } = req.body;

    if (!fullName || !phone || !email || !address || !applianceType) {
        return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    try {
        // Upsert a lightweight user record so staff can find this request later.
        // A real account (with stripe_customer_id, role, etc.) still gets created
        // properly during the staff-review step — this just captures the lead.
        await pool.query(`
            INSERT INTO users (id, name, email, phone_number, address)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email) DO UPDATE SET
                name = EXCLUDED.name,
                phone_number = EXCLUDED.phone_number,
                address = EXCLUDED.address
        `, [email, fullName, email, phone, address]);

        console.log(`ℹ️ New delivery request: ${fullName} (${applianceType}) — preferred date ${deliveryDate || 'unspecified'}`);

        return res.status(201).json({ success: true });
    } catch (err) {
        console.error('❌ Failed to save order request:', err.message);
        return res.status(500).json({ success: false, error: 'Could not save your request. Please call us instead.' });
    }
});

module.exports = router;
