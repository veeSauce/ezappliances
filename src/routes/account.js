const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

/**
 * POST /api/account/lookup
 * Used by the "Pay My Bill" page to find an account without a full login.
 * Requires billing zip PLUS either email or phone to match — zip alone,
 * or email/phone alone, is not enough to identify an account here.
 *
 * NOTE: this currently only confirms a match exists. It does not return
 * balance/payment details or start a Stripe Checkout session yet — wire
 * that up once the actual payment flow (Stripe Checkout or a saved card
 * charge) is decided.
 *
 * CAVEAT: the users table only has a single `address` text field, so zip
 * is matched with ILIKE against the whole address string, which is fragile
 * (e.g. a street number that happens to match the zip pattern). Add a
 * dedicated `zip_code` column to users and match against that instead
 * before relying on this in production.
 */
router.post('/api/account/lookup', express.json(), async (req, res) => {
    const { email, phone, zip } = req.body;

    if (!zip || (!email && !phone)) {
        return res.status(400).json({ success: false, error: 'Zip code and either an email or phone number are required.' });
    }

    try {
        const result = await pool.query(`
            SELECT id FROM users
            WHERE address ILIKE $1
            AND (email = $2 OR phone_number = $3)
        `, [`%${zip}%`, email || null, phone || null]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No matching account found.' });
        }

        // Only confirm a match for now — do not leak account details here.
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('❌ Account lookup query failed:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error looking up account.' });
    }
});

module.exports = router;
