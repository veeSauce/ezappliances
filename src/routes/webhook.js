const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db/pool');

const router = express.Router();

/**
 * CRITICAL: Stripe webhooks require the raw request body string to securely
 * calculate and verify the event hashes before extracting payload details.
 * This route must be mounted BEFORE any global express.json() middleware —
 * see src/app.js for the mounting order.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`❌ Webhook Signature Verification Failed: ${err.message}`);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    const client = await pool.connect();

    try {
        // Enforce basic isolation transactional design for safe billing operations
        await client.query('BEGIN');

        switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const stripeCustomerId = subscription.customer;
                const stripeSubscriptionId = subscription.id;
                const subscriptionStatus = subscription.status;
                const currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
                const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
                const priceId = subscription.items.data[0].price.id;

                console.log(`ℹ️ Syncing Subscription Status [${subscriptionStatus}] for Customer [${stripeCustomerId}]`);

                // Step 1: Look up local user ID matching the Stripe Customer identifier
                const userRes = await client.query('SELECT id FROM users WHERE stripe_customer_id = $1', [stripeCustomerId]);

                if (userRes.rows.length === 0) {
                    console.warn(`⚠️ No local user found for customer ID: ${stripeCustomerId}`);
                    break;
                }
                const userId = userRes.rows[0].id;

                // Step 2: Upsert records atomically into subscriptions
                await client.query(`
                    INSERT INTO subscriptions (id, user_id, stripe_price_id, status, current_period_start, current_period_end)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id) DO UPDATE SET
                        status = EXCLUDED.status,
                        current_period_start = EXCLUDED.current_period_start,
                        current_period_end = EXCLUDED.current_period_end
                `, [stripeSubscriptionId, userId, priceId, subscriptionStatus, currentPeriodStart, currentPeriodEnd]);

                // Step 3: Map active subscription channel back to the pending equipment deployment form
                await client.query(`
                    UPDATE rental_agreements
                    SET subscription_id = $1, installation_status = 'completed'
                    WHERE user_id = $2 AND subscription_id IS NULL
                `, [stripeSubscriptionId, userId]);

                console.log(`✅ Database successfully synced with active Stripe setup: ${stripeSubscriptionId}`);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                console.log(`❌ Subscription explicitly canceled or terminated on Stripe: ${subscription.id}`);

                await client.query('UPDATE subscriptions SET status = $1 WHERE id = $2', ['canceled', subscription.id]);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                console.log(`⚠️ Automatic monthly payment processing failed for Invoice: ${invoice.id}`);
                break;
            }

            default:
                console.log(`Unhandled event stream webhook event category: ${event.type}`);
        }

        await client.query('COMMIT');
    } catch (transactionError) {
        await client.query('ROLLBACK');
        console.error('❌ Error executing database pool operation within event loop:', transactionError.message);
    } finally {
        client.release();
    }

    // Always return a 200 response to Stripe swiftly to confirm safe package delivery
    response.json({ received: true });
});

module.exports = router;
