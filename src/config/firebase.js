const admin = require('firebase-admin');

// Initialize Firebase Admin (used to verify user identity tokens for protected routes).
// FIREBASE_SERVICE_ACCOUNT_KEY should hold the full service account JSON as a string.
// Guarded with admin.apps.length so this is safe to import from multiple modules
// without re-initializing the app each time.
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
}

module.exports = admin;
