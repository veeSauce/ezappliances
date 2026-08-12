const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizePayload,
  sanitizeName,
  sanitizeEmail,
  sanitizePhone,
  sanitizeAddress,
  normalizeValue
} = require('../src/lib/inputSafety');

test('sanitizeName strips symbols and trims whitespace', () => {
  assert.equal(sanitizeName('  Jane@ Doe  '), 'Jane Doe');
  assert.equal(sanitizeName('O\'Connor-Smith'), "O'Connor-Smith");
});

test('sanitizeEmail normalizes and rejects invalid addresses', () => {
  assert.equal(sanitizeEmail('  JOHN.DOE+TEST@EXAMPLE.COM '), 'john.doe+test@example.com');
  assert.equal(sanitizeEmail('not-an-email'), '');
});

test('sanitizePhone strips non-digit characters', () => {
  assert.equal(sanitizePhone('(214) 494-0713'), '2144940713');
  assert.equal(sanitizePhone('abc'), '');
});

test('sanitizeAddress removes control characters and trims', () => {
  assert.equal(sanitizeAddress('  123 Main St\n Apt 4  '), '123 Main St Apt 4');
});

test('sanitizePayload removes injection-like payload content from nested objects', () => {
  const payload = {
    name: '  Mary <script>bad</script> Smith  ',
    email: ' test@example.com ',
    address: ' 123 Main St\r\n apt 5 ',
    notes: 'DROP TABLE users;'
  };

  const result = sanitizePayload(payload);

  assert.equal(result.name, 'Mary bad Smith');
  assert.equal(result.email, 'test@example.com');
  assert.equal(result.address, '123 Main St apt 5');
  assert.equal(result.notes, 'DROP TABLE users;');
});

test('normalizeValue strips scripts and controls', () => {
  assert.equal(normalizeValue('<script>alert(1)</script>'), 'alert(1)');
});
