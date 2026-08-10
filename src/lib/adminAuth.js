const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const passwordHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { salt, passwordHash };
}

function verifyPassword(password, passwordHash, salt) {
    const derivedHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(derivedHash, 'hex'),
            Buffer.from(passwordHash, 'hex')
        );
    } catch (err) {
        return false;
    }
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = {
    hashPassword,
    verifyPassword,
    hashToken
};
