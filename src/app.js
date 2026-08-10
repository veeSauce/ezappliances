const express = require('express');

const webhookRoutes = require('./routes/webhook');
const orderRoutes = require('./routes/orders');
const accountRoutes = require('./routes/account');
const adminRoutes = require('./routes/admin');

const app = express();

// Serve the frontend (index.html, pay-bill.html, css/, js/) from /public.
app.use(express.static('public'));

// The Stripe webhook route needs the raw request body to verify signatures,
// so it must be mounted before anything that applies express.json() globally.
// Mounting order matters here — do not move webhookRoutes below a global
// express.json() call.
app.use(webhookRoutes);

app.use(orderRoutes);
app.use(accountRoutes);
app.use(adminRoutes);

module.exports = app;
