const pool = require('../db/pool');
const { hashToken } = require('../lib/adminAuth');

async function requireCustomer(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ success: false, error: 'Missing or malformed customer session.' });
    }
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.email
            FROM customer_sessions s
            INNER JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.role = 'customer'
        `, [hashToken(token)]);
        if (result.rows.length !== 1) {
            return res.status(401).json({ success: false, error: 'Your customer session is invalid or expired.' });
        }
        req.customer = result.rows[0];
        return next();
    } catch (err) {
        console.error('❌ Failed to validate customer session:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to verify customer session.' });
    }
}

module.exports = requireCustomer;
