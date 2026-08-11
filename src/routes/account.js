const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db/pool');

const router = express.Router();

/**
 * POST /api/account/lookup
 * Used by the "Pay My Bill" page to find an account without a full login.
 * Requires billing zip PLUS either email or phone to match.
 *
 * If the account matches, this creates a Stripe Checkout session and returns
 * the session URL so the browser can redirect the customer to checkout.
 */
router.post('/api/account/lookup', express.json(), async (req, res) => {
    const { email, phone, zip, amount } = req.body;

    if (!zip || (!email && !phone)) {
        return res.status(400).json({ success: false, error: 'Zip code and either an email or phone number are required.' });
    }

    try {
        const result = await pool.query(`
            SELECT id, email, phone_number, name, address, stripe_customer_id
            FROM users
            WHERE address ILIKE $1
              AND (email = $2 OR phone_number = $3)
            LIMIT 1
        `, [`%${zip}%`, email || null, phone || null]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No matching account found.' });
        }

        const user = result.rows[0];
        const paymentAmount = Number(amount) > 0 ? Number(amount) : 2500;

        if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_replace_with_real_key')) {
            return res.status(500).json({ success: false, error: 'Stripe checkout is not configured yet.' });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `EZ Appliances payment for ${user.name || 'customer account'}`
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
                phone_number: user.phone_number
            }
        });
    } catch (err) {
        console.error('❌ Account lookup / checkout failed:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error looking up account or creating Stripe checkout.' });
    }
});

module.exports = router;
