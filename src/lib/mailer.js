const nodemailer = require('nodemailer');
const https = require('https');

function createMailer() {
    const port = Number(process.env.SMTP_PORT || 587);
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) {
        throw new Error('SMTP is not configured.');
    }
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    });
}

async function sendEmail(message) {
    return createMailer().sendMail({ from: process.env.SMTP_FROM, ...message });
}

function normalizeSmsNumber(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return '';
}

/**
 * Sends a transactional SMS through Twilio when its environment variables are
 * configured. Keeping this optional means an appliance request is never lost
 * because SMS is not set up yet.
 */
async function sendSms({ to, body }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    const recipient = normalizeSmsNumber(to);
    if (!accountSid || !authToken || !from) throw new Error('Twilio SMS is not configured.');
    if (!recipient) throw new Error('A valid US phone number is required for SMS.');

    const payload = new URLSearchParams({ To: recipient, From: from, Body: String(body || '') }).toString();
    const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname: 'api.twilio.com',
            path: `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
            method: 'POST',
            headers: {
                Authorization: `Basic ${authorization}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (response) => {
            let responseBody = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { responseBody += chunk; });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) return resolve(responseBody);
                return reject(new Error(`Twilio returned HTTP ${response.statusCode}: ${responseBody.slice(0, 300)}`));
            });
        });
        request.setTimeout(10_000, () => request.destroy(new Error('Twilio request timed out.')));
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

module.exports = { sendEmail, sendSms };
