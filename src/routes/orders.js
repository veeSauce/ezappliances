const express = require('express');
const pool = require('../db/pool');
const { sanitizePayload, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeAddress } = require('../lib/inputSafety');

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
    const payload = sanitizePayload(req.body || {});
    const fullName = sanitizeName(payload.fullName || payload.name || '');
    const phone = sanitizePhone(payload.phone || '');
    const email = sanitizeEmail(payload.email || '');
    const address = sanitizeAddress(payload.address || '');
    const applianceType = normalizeValue(payload.applianceType || payload.appliance_type || '');
    const deliveryDate = normalizeValue(payload.deliveryDate || payload.delivery_date || '');

    if (!fullName || !phone || !email || !address || !applianceType) {
        return res.status(400).json({ success: false, error: 'Missing required fields or invalid values.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format.' });
    }

    if (!/^[A-Za-z0-9\s'\-.]{2,}$/.test(fullName)) {
        return res.status(400).json({ success: false, error: 'Name contains invalid characters.' });
    }

    try {
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

function normalizeValue(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

module.exports = router;
