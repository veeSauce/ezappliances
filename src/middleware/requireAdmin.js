const admin = require('../config/firebase');
const pool = require('../db/pool');

/**
 * Middleware: requireAdmin
 *
 * Verifies the caller's Firebase ID token (sent as "Authorization: Bearer <token>"),
 * then confirms the matching user row in our own database has role = 'admin'.
 * Both checks must pass or the request is rejected before it reaches the route handler.
 */
async function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ success: false, error: 'Missing or malformed Authorization header.' });
    }

    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(token);
    } catch (err) {
        console.warn('⚠️ Rejected request with invalid Firebase ID token:', err.message);
        return res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
    }

    try {
        const result = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.uid]);

        if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
            console.warn(`⚠️ Non-admin user attempted to access admin route: ${decoded.uid}`);
            return res.status(403).json({ success: false, error: 'Admin privileges required.' });
        }
    } catch (err) {
        console.error('❌ Failed to verify admin role:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error verifying permissions.' });
    }

    req.user = { uid: decoded.uid };
    next();
}

module.exports = requireAdmin;
