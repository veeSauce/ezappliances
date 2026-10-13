#!/usr/bin/env node

require('dotenv').config();

const readline = require('readline');
const pool = require('../src/db/pool');
const { hashPassword } = require('../src/lib/adminAuth');

function prompt(question, { hidden = false } = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        let value = '';

        if (hidden && process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', function onData(chunk) {
                const key = chunk.toString();
                if (key === '\r' || key === '\n') {
                    process.stdin.setRawMode(false);
                    process.stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    rl.close();
                    resolve(value);
                } else if (key === '\u0003') {
                    process.stdin.setRawMode(false);
                    process.stdin.removeListener('data', onData);
                    rl.close();
                    process.exit(130);
                } else if (key === '\u007f') {
                    value = value.slice(0, -1);
                } else if (key >= ' ') {
                    value += key;
                }
            });
            process.stdout.write(question);
        } else {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        }
    });
}

async function main() {
    const identifier = process.argv[2]?.trim();
    if (!identifier) {
        console.error('Usage: node tools/reset-admin-password.js <username-or-email>');
        process.exitCode = 1;
        return;
    }

    const password = await prompt('New password: ', { hidden: true });
    const confirmation = await prompt('Confirm new password: ', { hidden: true });
    if (password.length < 12) throw new Error('Password must be at least 12 characters.');
    if (password !== confirmation) throw new Error('Passwords do not match.');

    const { passwordHash, salt } = hashPassword(password);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updated = await client.query(
            `UPDATE admin_users
             SET password_hash = $1, salt = $2
             WHERE username = $3 OR email = $3
             RETURNING id, username, email`,
            [passwordHash, salt, identifier]
        );
        if (updated.rowCount !== 1) throw new Error('No unique admin account matched that username or email.');

        await client.query(
            'UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_user_id = $1 AND revoked_at IS NULL',
            [updated.rows[0].id]
        );
        await client.query('COMMIT');
        console.log(`Password reset for ${updated.rows[0].username}; existing sessions were revoked.`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error(`Password reset failed: ${err.message}`);
    process.exitCode = 1;
});
