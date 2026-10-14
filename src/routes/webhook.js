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

function paymentEmailTemplate({ title, message, actionLabel, actionUrl }) {
    return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#eef0ee;font-family:Arial,sans-serif;color:#1b2320;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#eef0ee;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#fbfcfb;border:1px solid #d7dcda;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:14px 28px;background:#e2932e;color:#232c30;font-family:monospace;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">EZ · Appliances</td></tr>
      <tr><td style="padding:32px 28px 12px;"><p style="margin:0 0 10px;color:#46565f;font-family:monospace;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;">Payment update</p><h1 style="margin:0;font-size:29px;line-height:1.15;color:#1b2320;">${title}</h1></td></tr>
      <tr><td style="padding:12px 28px 28px;"><p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#4b5652;">${message}</p>
        <a href="${actionUrl}" style="display:inline-block;padding:13px 19px;background:#e2932e;border-radius:6px;color:#232c30;font-weight:700;text-decoration:none;">${actionLabel}</a>
      </td></tr>
      <tr><td style="padding:20px 28px;border-top:1px solid #d7dcda;background:#eef0ee;color:#4b5652;font-size:14px;line-height:1.6;">Need help? Call <a href="tel:2144940713" style="color:#1b2320;font-weight:700;">(214) 494-0713</a> or visit <a href="${process.env.APP_URL || 'https://www.ezappliancestx.com'}" style="color:#1b2320;font-weight:700;">EZ Appliances</a>.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function findPaymentEmail(client, paymentIntent) {
    if (paymentIntent.receipt_email) return paymentIntent.receipt_email;
    const userId = paymentIntent.metadata?.user_id;
    if (!userId) return null;
    const user = await client.query('SELECT email FROM users WHERE id = $1 AND email IS NOT NULL', [userId]);
    return user.rows[0]?.email || null;
}

async function sendPaymentNotification(client, { paymentIntent, checkoutSessionId = null, eventId, type, email, subject, text, html = null, receiptUrl = null }) {
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
    await sendEmail({ to: email, subject, text, html: html || undefined });
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
                await client.query(`UPDATE cancellation_requests SET status = 'cancelled', resolved_at = NOW()
                    WHERE user_id = (SELECT user_id FROM subscriptions WHERE id = $1)
                      AND status = 'pending_cancellation'`, [subscription.id]);
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
                const applianceSummary = session.metadata?.appliance_summary || 'appliance rental';
                const billingMonth = session.metadata?.billing_month || new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
                const userId = session.metadata?.user_id;
                if (userId) {
                    await client.query(`
                        INSERT INTO customer_payment_history (payment_intent_id, user_id, amount_cents, currency, receipt_url)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (payment_intent_id) DO UPDATE SET receipt_url = EXCLUDED.receipt_url
                    `, [paymentIntent.id, userId, session.amount_total || 0, session.currency || 'usd', receiptUrl]);
                }
                await sendPaymentNotification(client, {
                    paymentIntent, checkoutSessionId: session.id, eventId: event.id, type: 'receipt', email: customerEmail,
                    subject: `Your EZ Appliances payment receipt (${amount})`,
                    text: `Thank you for your payment to EZ Appliances.\n\nPayment received: ${amount}\nBilled for: ${applianceSummary}\nBilling month: ${billingMonth}${receiptLine}\n\nPayment reference: ${paymentIntent.id}`,
                    html: paymentEmailTemplate({
                        title: 'Thank you for your payment',
                        message: `We received your EZ Appliances payment of <strong>${amount}</strong> for your <strong>${applianceSummary}</strong> rental for <strong>${billingMonth}</strong>.`,
                        actionLabel: receiptUrl ? 'View Stripe receipt' : 'Visit EZ Appliances',
                        actionUrl: receiptUrl || (process.env.APP_URL || 'https://www.ezappliancestx.com')
                    }),
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
                const siteUrl = process.env.APP_URL || 'https://www.ezappliancestx.com';
                const paymentPageUrl = `${siteUrl}/pay-bill.html`;
                await sendPaymentNotification(client, {
                    paymentIntent, eventId: event.id, type: 'failure', email: customerEmail,
                    subject: 'Your EZ Appliances payment was not completed',
                    text: `We were unable to complete your EZ Appliances payment of ${amount}. No payment was collected.\n\nTry again: ${paymentPageUrl}\nNeed help? Call EZ Appliances at (214) 494-0713.\n\nPayment reference: ${paymentIntent.id}`,
                    html: paymentEmailTemplate({
                        title: 'Your payment was not completed',
                        message: `We were unable to complete your EZ Appliances payment of <strong>${amount}</strong>. No payment was collected. You can try again using the secure payment page below.`,
                        actionLabel: 'Try payment again',
                        actionUrl: paymentPageUrl
                    })
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
