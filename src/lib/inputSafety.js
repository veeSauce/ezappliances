function normalizeValue(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '$1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeName(value) {
  const clean = normalizeValue(value);
  if (!clean) return '';

  const noSymbols = clean.replace(/[^a-zA-Z0-9\s'\-.]/g, ' ');
  return noSymbols.replace(/\s+/g, ' ').trim();
}

function sanitizeEmail(value) {
  const clean = normalizeValue(value).toLowerCase();
  if (!clean) return '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return '';
  }

  return clean;
}

function sanitizePhone(value) {
  return normalizeValue(value).replace(/\D/g, '');
}

function sanitizeAddress(value) {
  return normalizeValue(value)
    .replace(/[^a-zA-Z0-9\s,.-/#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const safe = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) {
      safe[key] = '';
      continue;
    }

    if (typeof value === 'string') {
      const lowerKey = key.toLowerCase();

      if (lowerKey.includes('email')) {
        safe[key] = sanitizeEmail(value);
      } else if (lowerKey.includes('phone')) {
        safe[key] = sanitizePhone(value);
      } else if (lowerKey.includes('name')) {
        safe[key] = sanitizeName(value);
      } else if (lowerKey.includes('address') || lowerKey.includes('street')) {
        safe[key] = sanitizeAddress(value);
      } else if (lowerKey.includes('zip')) {
        safe[key] = normalizeValue(value).replace(/\D/g, '').slice(0, 10);
      } else {
        safe[key] = normalizeValue(value);
      }
      continue;
    }

    if (Array.isArray(value)) {
      safe[key] = value.map(item => sanitizePayload(item));
      continue;
    }

    if (typeof value === 'object') {
      safe[key] = sanitizePayload(value);
      continue;
    }

    safe[key] = value;
  }

  return safe;
}

module.exports = {
  normalizeValue,
  sanitizeName,
  sanitizeEmail,
  sanitizePhone,
  sanitizeAddress,
  sanitizePayload
};
