const pool = require('../db/pool');
const { hashToken } = require('../lib/adminAuth');

/**
 * Middleware: requireAdmin
 *
 * Validates a bearer token issued by the database-backed admin login flow.
 * Tokens are stored as a SHA-256 hash in admin_sessions and must still be active.
 */
async function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ success: false, error: 'Missing or malformed Authorization header.' });
    }

    try {
        const result = await pool.query(`
            SELECT au.id, au.username, au.email
            FROM admin_sessions s
            INNER JOIN admin_users au ON au.id = s.admin_user_id
            WHERE s.token_hash = $1
              AND s.revoked_at IS NULL
              AND s.expires_at > NOW()
              AND au.is_active = TRUE
        `, [hashToken(token)]);

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid or expired admin session.' });
        }

        req.admin = result.rows[0];
        next();
    } catch (err) {
        console.error('❌ Failed to validate admin session:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error verifying permissions.' });
    }
}

module.exports = requireAdmin;
