const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db/pool');
const { sanitizePayload, sanitizeEmail, sanitizePhone, sanitizeName } = require('../lib/inputSafety');

const router = express.Router();

/**
 * POST /api/account/lookup
 * Used by the "Pay My Bill" page to find an account without a full login.
 * Matches an email address alone, or a phone number plus billing zip.
 *
 * If the account matches, this creates a Stripe Checkout session and returns
 * the session URL so the browser can redirect the customer to checkout.
 */
router.post('/api/account/lookup', express.json(), async (req, res) => {
    const payload = sanitizePayload(req.body || {});
    const email = sanitizeEmail(payload.email || '');
    const phone = sanitizePhone(payload.phone || '');
    const zip = String(payload.zip || '').replace(/\D/g, '').slice(0, 10);

    if (!email && !phone) {
        return res.status(400).json({ success: false, error: 'Enter an email address, or a phone number with billing zip code.' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format.' });
    }

    if (phone && phone.length < 10) {
        return res.status(400).json({ success: false, error: 'Invalid phone number format.' });
    }

    if (!email && (!zip || !/^\d{5}$/.test(zip))) {
        return res.status(400).json({ success: false, error: 'A valid 5-digit billing zip code is required when using a phone number.' });
    }

    try {
        const query = email
            ? `SELECT id, email, phone_number, name, address, stripe_customer_id, monthly_rate
               FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`
            : `SELECT id, email, phone_number, name, address, stripe_customer_id, monthly_rate
               FROM users WHERE phone_number = $1 AND address ILIKE $2 LIMIT 1`;
        const params = email ? [email] : [phone, `%${zip}%`];
        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No matching account found.' });
        }

        const user = result.rows[0];
        // The customer billing record is the sole source of truth for charges.
        // Never accept an amount from the browser for a payment session.
        const paymentAmount = Math.round(Number(user.monthly_rate) * 100);
        const safeName = sanitizeName(user.name || 'customer account');

        if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({ success: false, error: 'There is no active monthly billing rate for this account.' });
        }

        if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_replace_with_real_key')) {
            return res.status(500).json({ success: false, error: 'Stripe checkout is not configured yet.' });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `EZ Appliances monthly rental for ${safeName || 'customer account'}`
                    },
                    unit_amount: paymentAmount
                },
                quantity: 1
            }],
            success_url: `${process.env.APP_URL || 'http://localhost:3000'}/pay-bill.html?checkout=success`,
            cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/pay-bill.html?checkout=cancelled`,
            customer_email: user.email || email || undefined,
            metadata: {
                user_id: user.id,
                monthly_rate_cents: String(paymentAmount),
                zip,
                phone: user.phone_number || phone || ''
            }
        });

        return res.status(200).json({
            success: true,
            checkoutUrl: session.url,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone_number: user.phone_number,
                monthly_rate: Number(user.monthly_rate)
            },
            amount: paymentAmount
        });
    } catch (err) {
        console.error('❌ Account lookup / checkout failed:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error looking up account or creating Stripe checkout.' });
    }
});

async function findServiceAccount(email, phone, zip) {
    const query = email
        ? 'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1'
        : 'SELECT id FROM users WHERE phone_number = $1 AND address ILIKE $2 LIMIT 1';
    const account = await pool.query(query, email ? [email] : [phone, `%${zip}%`]);
    return account.rows[0] || null;
}

function serviceAccountInput(body) {
    const payload = sanitizePayload(body || {});
    return {
        email: sanitizeEmail(payload.email || ''),
        phone: sanitizePhone(payload.phone || ''),
        zip: String(payload.zip || '').replace(/\D/g, '').slice(0, 10)
    };
}

function validateServiceAccountInput({ email, phone, zip }) {
    if (!email && !phone) return 'Enter an email address, or a phone number with billing zip code.';
    if (phone && phone.length < 10) return 'Invalid phone number format.';
    if (!email && (!zip || !/^\d{5}$/.test(zip))) return 'A valid 5-digit billing zip code is required when using a phone number.';
    return '';
}

router.post('/api/service-requests/lookup', express.json(), async (req, res) => {
    const input = serviceAccountInput(req.body);
    const error = validateServiceAccountInput(input);
    if (error) return res.status(400).json({ success: false, error });
    try {
        const account = await findServiceAccount(input.email, input.phone, input.zip);
        if (!account) return res.status(404).json({ success: false, error: 'No matching account found.' });
        const equipment = await pool.query(`
            SELECT e.id, e.type, e.model_name, e.serial_number
            FROM rental_agreements ra
            INNER JOIN equipment e ON e.id = ra.equipment_id
            WHERE ra.user_id = $1 ORDER BY e.type, e.model_name
        `, [account.id]);
        if (equipment.rows.length === 0) return res.status(404).json({ success: false, error: 'No assigned equipment was found for this account.' });
        return res.json({ success: true, equipment: equipment.rows });
    } catch (err) {
        console.error('❌ Service account lookup failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to look up this account. Please call us instead.' });
    }
});

router.post('/api/service-requests', express.json(), async (req, res) => {
    const payload = sanitizePayload(req.body || {});
    const email = sanitizeEmail(payload.email || '');
    const phone = sanitizePhone(payload.phone || '');
    const zip = String(payload.zip || '').replace(/\D/g, '').slice(0, 10);
    const issueType = typeof req.body?.issueType === 'string' ? req.body.issueType : '';
    const equipmentIds = Array.isArray(req.body?.equipmentIds) ? [...new Set(req.body.equipmentIds.map(Number))] : [];
    const issueDescriptions = {
        not_powering_on: 'Machine is not powering on.',
        working_incorrectly: 'Machine is working incorrectly.',
        error_code: 'Machine is showing an error code.',
        other: 'Other equipment issue.'
    };

    if (!email && !phone) {
        return res.status(400).json({ success: false, error: 'Enter an email address, or a phone number with billing zip code.' });
    }
    if (phone && phone.length < 10) {
        return res.status(400).json({ success: false, error: 'Invalid phone number format.' });
    }
    if (!email && (!zip || !/^\d{5}$/.test(zip))) {
        return res.status(400).json({ success: false, error: 'A valid 5-digit billing zip code is required when using a phone number.' });
    }
    if (!issueDescriptions[issueType]) return res.status(400).json({ success: false, error: 'Select an issue type.' });
    if (!equipmentIds.length || equipmentIds.some((id) => !Number.isInteger(id))) return res.status(400).json({ success: false, error: 'Select the equipment needing service.' });

    const client = await pool.connect();
    try {
        const account = await findServiceAccount(email, phone, zip);
        if (!account) return res.status(404).json({ success: false, error: 'No matching account found.' });
        const assigned = await client.query(`
            SELECT equipment_id FROM rental_agreements
            WHERE user_id = $1 AND equipment_id = ANY($2::int[])
        `, [account.id, equipmentIds]);
        if (assigned.rows.length !== equipmentIds.length) return res.status(400).json({ success: false, error: 'One or more selected appliances are not assigned to this account.' });
        await client.query('BEGIN');
        const request = await client.query(`
            INSERT INTO service_requests (user_id, description)
            VALUES ($1, $2) RETURNING id, status, created_at
        `, [account.id, issueDescriptions[issueType]]);
        await client.query(`
            INSERT INTO service_request_equipment (service_request_id, equipment_id)
            SELECT $1, UNNEST($2::int[])
        `, [request.rows[0].id, equipmentIds]);
        await client.query('COMMIT');
        return res.status(201).json({ success: true, request: request.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Service request creation failed:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to submit your service request. Please call us instead.' });
    } finally {
        client.release();
    }
});

module.exports = router;
