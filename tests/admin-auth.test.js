const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword, hashToken } = require('../src/lib/adminAuth');

test('hash and verify password round trip', () => {
  const plainTextPassword = 'SuperSecurePassword123!';
  const result = hashPassword(plainTextPassword);

  assert.equal(typeof result, 'object');
  assert.ok(result.salt);
  assert.ok(result.passwordHash);
  assert.equal(result.passwordHash.length > 0, true);
  assert.equal(verifyPassword(plainTextPassword, result.passwordHash, result.salt), true);
  assert.equal(verifyPassword('WrongPassword', result.passwordHash, result.salt), false);
});

test('token hashing is deterministic for the same token value', () => {
  const token = 'admin-session-token-123';

  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken('admin-session-token-456'));
});
