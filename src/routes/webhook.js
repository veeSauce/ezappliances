const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db/pool');
const { sendEmail } = require('../lib/mailer');

const router = express.Router();

function formatAmount(amount, currency) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: String(currency || 'usd').toUpperCase()
    }).format(Number(amount || 0) / 100);
}

async function findPaymentEmail(client, paymentIntent) {
    if (paymentIntent.receipt_email) return paymentIntent.receipt_email;
    const userId = paymentIntent.metadata?.user_id;
    if (!userId) return null;
    const user = await client.query('SELECT email FROM users WHERE id = $1 AND email IS NOT NULL', [userId]);
    return user.rows[0]?.email || null;
}

async function sendPaymentNotification(client, { paymentIntent, checkoutSessionId = null, eventId, type, email, subject, text, receiptUrl = null }) {
    const delivery = await client.query(`
        INSERT INTO stripe_payment_notifications
            (payment_intent_id, notification_type, checkout_session_id, stripe_event_id, customer_email, receipt_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (payment_intent_id, notification_type) DO NOTHING
        RETURNING payment_intent_id
    `, [paymentIntent.id, type, checkoutSessionId, eventId, email, receiptUrl]);
    if (delivery.rowCount === 0) {
        console.log(`ℹ️ ${type} email already sent for payment ${paymentIntent.id}; skipping duplicate webhook delivery.`);
        return;
    }
    await sendEmail({ to: email, subject, text });
    await client.query(
        'UPDATE stripe_payment_notifications SET sent_at = NOW() WHERE payment_intent_id = $1 AND notification_type = $2',
        [paymentIntent.id, type]
    );
}

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

            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded': {
                const session = event.data.object;
                const paymentIntentId = typeof session.payment_intent === 'string'
                    ? session.payment_intent
                    : session.payment_intent?.id;
                if (session.payment_status !== 'paid' || !paymentIntentId) {
                    console.log(`ℹ️ Checkout session ${session.id} is not yet paid; receipt email deferred.`);
                    break;
                }
                const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
                    expand: ['latest_charge']
                });
                const customerEmail = session.customer_details?.email || session.customer_email || await findPaymentEmail(client, paymentIntent);
                if (!customerEmail) {
                    console.warn(`⚠️ Paid Checkout session ${session.id} has no customer email; receipt was not sent.`);
                    break;
                }
                const charge = paymentIntent.latest_charge;
                const receiptUrl = charge && typeof charge === 'object' ? charge.receipt_url : null;
                const amount = formatAmount(session.amount_total, session.currency);
                const receiptLine = receiptUrl ? `\n\nView your Stripe receipt: ${receiptUrl}` : '';
                await sendPaymentNotification(client, {
                    paymentIntent, checkoutSessionId: session.id, eventId: event.id, type: 'receipt', email: customerEmail,
                    subject: `Your EZ Appliances payment receipt (${amount})`,
                    text: `Thank you for your payment to EZ Appliances.\n\nPayment received: ${amount}${receiptLine}\n\nPayment reference: ${paymentIntent.id}`,
                    receiptUrl
                });
                console.log(`✅ Sent payment receipt ${paymentIntent.id} to ${customerEmail}`);
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                const customerEmail = await findPaymentEmail(client, paymentIntent);
                if (!customerEmail) {
                    console.warn(`⚠️ Failed payment ${paymentIntent.id} has no customer email; failure notice was not sent.`);
                    break;
                }
                const amount = formatAmount(paymentIntent.amount, paymentIntent.currency);
                await sendPaymentNotification(client, {
                    paymentIntent, eventId: event.id, type: 'failure', email: customerEmail,
                    subject: 'Your EZ Appliances payment was not completed',
                    text: `We were unable to complete your EZ Appliances payment of ${amount}. No payment was collected.\n\nPlease return to the payment page and try again, or contact us if you need help.\n\nPayment reference: ${paymentIntent.id}`
                });
                console.log(`⚠️ Sent payment failure notice for ${paymentIntent.id} to ${customerEmail}`);
                break;
            }

            default:
                console.log(`Unhandled event stream webhook event category: ${event.type}`);
        }

        await client.query('COMMIT');
    } catch (transactionError) {
        await client.query('ROLLBACK');
        console.error('❌ Error executing database pool operation within event loop:', transactionError.message);
        return response.status(500).json({ received: false });
    } finally {
        client.release();
    }

    // Always return a 200 response to Stripe swiftly to confirm safe package delivery
    response.json({ received: true });
});

module.exports = router;
