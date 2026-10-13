const MAX_LOG_ENTRIES = 500;
const entries = [];
let nextId = 1;

function redact(value) {
    return String(value)
        .replace(/(sk_(?:test|live)_[A-Za-z0-9_]+)/g, '[REDACTED_STRIPE_KEY]')
        .replace(/(whsec_[A-Za-z0-9_]+)/g, '[REDACTED_WEBHOOK_SECRET]')
        .replace(/(postgres(?:ql)?:\/\/[^\s:@]+:)[^@\s]+@/gi, '$1[REDACTED]@');
}

function format(args) {
    return redact(args.map((value) => {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'object') {
            try { return JSON.stringify(value); } catch (_) { return '[Unserializable object]'; }
        }
        return String(value);
    }).join(' '));
}

function add(level, args) {
    const entry = { id: nextId++, timestamp: new Date().toISOString(), level, message: format(args) };
    entries.push(entry);
    if (entries.length > MAX_LOG_ENTRIES) entries.shift();
    return entry;
}

function recent(limit = 100) {
    return entries.slice(-Math.min(Math.max(Number(limit) || 100, 1), MAX_LOG_ENTRIES));
}

function installConsoleCapture() {
    ['log', 'warn', 'error'].forEach((level) => {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            add(level, args);
            original(...args);
        };
    });
}

module.exports = { installConsoleCapture, recent };
