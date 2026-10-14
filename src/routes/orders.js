const express = require('express');
const pool = require('../db/pool');
const { sanitizePayload, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeAddress } = require('../lib/inputSafety');
const { sendEmail, sendSms } = require('../lib/mailer');

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
    const smsOptIn = req.body?.smsOptIn === true || req.body?.smsOptIn === 'on';

    if (!fullName || !phone || !email || !address || !applianceType || !deliveryDate) {
        return res.status(400).json({ success: false, error: 'Missing required fields or invalid values.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
        return res.status(400).json({ success: false, error: 'Choose a valid preferred delivery date.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format.' });
    }

    if (!/^[A-Za-z0-9\s'\-.]{2,}$/.test(fullName)) {
        return res.status(400).json({ success: false, error: 'Name contains invalid characters.' });
    }

    try {
        await pool.query(`
            INSERT INTO users (id, name, email, phone_number, address, requested_appliance_type, preferred_delivery_date, sms_opt_in, order_requested_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (email) DO UPDATE SET
                name = EXCLUDED.name,
                phone_number = EXCLUDED.phone_number,
                address = EXCLUDED.address,
                requested_appliance_type = EXCLUDED.requested_appliance_type,
                preferred_delivery_date = EXCLUDED.preferred_delivery_date,
                sms_opt_in = EXCLUDED.sms_opt_in,
                order_requested_at = NOW()
        `, [email, fullName, email, phone, address, applianceType, deliveryDate, smsOptIn]);

        console.log(`ℹ️ New delivery request: ${fullName} (${applianceType}) — preferred date ${deliveryDate || 'unspecified'}`);

        const applianceLabel = {
            washer: 'washer', dryer: 'dryer', washer_dryer_pair: 'washer and dryer set', stacked_dryer: 'stacked unit'
        }[applianceType] || 'appliance';
        const formattedDate = new Date(`${deliveryDate}T12:00:00`).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric'
        });
        const safeName = escapeHtml(fullName);
        const safeAppliance = escapeHtml(applianceLabel);
        const safeDate = escapeHtml(formattedDate);
        const confirmation = {
            to: email,
            subject: 'We received your EZ Appliances request',
            text: `Hi ${fullName},\n\nWe received your request for a ${applianceLabel} with a preferred delivery date of ${formattedDate}. Our team will review it and contact you promptly to confirm the next steps.\n\nEZ Appliances\n(214) 494-0713\nhttps://www.ezappliancestx.com`,
            html: `<main style="max-width:600px;margin:auto;font-family:Arial,sans-serif;color:#17212b;border:1px solid #e4e7ea;border-radius:10px;overflow:hidden"><header style="background:#17212b;color:#fff;padding:24px"><strong style="font-size:22px">EZ<span style="color:#e5a93e">·</span>Appliances</strong></header><section style="padding:28px"><h1 style="font-size:24px;margin-top:0">Request received</h1><p>Hi ${safeName},</p><p>We received your request for a <strong>${safeAppliance}</strong> with a preferred delivery date of <strong>${safeDate}</strong>.</p><p>Our team will review it and contact you promptly to confirm the next steps.</p><p style="margin-top:28px">Questions? Call <a href="tel:2144940713">(214) 494-0713</a> or visit <a href="https://www.ezappliancestx.com">ezappliancestx.com</a>.</p></section></main>`
        };
        const notifications = [sendEmail(confirmation)];
        // SMS is deliberately disabled until the business has a funded Twilio
        // account and has completed the required US messaging registration.
        // Keep the implementation and consent field ready for later enablement.
        if (process.env.SMS_NOTIFICATIONS_ENABLED === 'true' && smsOptIn) {
            notifications.push(sendSms({
                to: phone,
                body: `EZ Appliances: Hi ${fullName}, we received your ${applianceLabel} request for ${formattedDate}. Our team will contact you promptly. Reply STOP to opt out.`
            }));
        }
        const notificationResults = await Promise.allSettled(notifications);
        notificationResults.forEach((result, index) => {
            if (result.status === 'rejected') console.error(`❌ ${index === 0 ? 'Order confirmation email' : 'Order confirmation SMS'} failed:`, result.reason.message);
        });

        return res.status(201).json({ success: true });
    } catch (err) {
        console.error('❌ Failed to save order request:', err.message);
        return res.status(500).json({ success: false, error: 'Could not save your request. Please call us instead.' });
    }
});

function normalizeValue(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

module.exports = router;
