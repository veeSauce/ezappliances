const nodemailer = require('nodemailer');

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

module.exports = { sendEmail };
