// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

// Small helper to show a status message under a form
function setStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('success', 'error');
  el.classList.add('visible', kind);
}

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function sanitizeName(value) {
  const clean = normalizeValue(value).replace(/[^a-zA-Z0-9\s'\-.]/g, ' ');
  return clean.replace(/\s+/g, ' ').trim();
}

function sanitizeEmail(value) {
  const clean = normalizeValue(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return '';
  }
  return clean;
}

function sanitizePhone(value) {
  return normalizeValue(value).replace(/\D/g, '');
}

function sanitizeAddress(value) {
  return normalizeValue(value).replace(/[^a-zA-Z0-9\s,.-/#]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizePayload(payload) {
  const sanitized = { ...payload };

  Object.keys(sanitized).forEach((key) => {
    const rawValue = sanitized[key];
    if (typeof rawValue !== 'string') return;

    if (key.toLowerCase().includes('email')) {
      sanitized[key] = sanitizeEmail(rawValue);
    } else if (key.toLowerCase().includes('phone')) {
      sanitized[key] = sanitizePhone(rawValue);
    } else if (key.toLowerCase().includes('name')) {
      sanitized[key] = sanitizeName(rawValue);
    } else if (key.toLowerCase().includes('address') || key.toLowerCase().includes('street')) {
      sanitized[key] = sanitizeAddress(rawValue);
    } else if (key.toLowerCase().includes('zip')) {
      sanitized[key] = normalizeValue(rawValue).replace(/\D/g, '').slice(0, 10);
    } else {
      sanitized[key] = normalizeValue(rawValue);
    }
  });

  return sanitized;
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function validateName(value) {
  const cleaned = sanitizeName(value);
  return cleaned.length >= 2 && !/[!@#$%^&*_=+\[\]{};:"<>?/|\\~`]/.test(cleaned);
}

function validatePhone(value) {
  return sanitizePhone(value).length >= 10;
}

function validateAddress(value) {
  return sanitizeAddress(value).length >= 6;
}

// ---- Order form (homepage #booking) ----
// NOTE: POSTs to /api/orders, which does not exist on the backend yet.
// This needs a matching Express route (see server.js) that validates the
// payload and inserts into rental_agreements / equipment. Until that route
// exists, this will fail with a 404 — that's expected.
const orderForm = document.getElementById('orderForm');
if (orderForm) {
  orderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('orderStatus');
    const submitBtn = orderForm.querySelector('button[type="submit"]');
    const rawPayload = Object.fromEntries(new FormData(orderForm).entries());
    const payload = sanitizePayload(rawPayload);

    if (!validateName(payload.fullName)) {
      setStatus(statusEl, 'Please enter a valid full name without symbols.', 'error');
      return;
    }

    if (!validatePhone(payload.phone)) {
      setStatus(statusEl, 'Please enter a valid phone number.', 'error');
      return;
    }

    if (!validateEmail(payload.email)) {
      setStatus(statusEl, 'Please enter a valid email address.', 'error');
      return;
    }

    if (!validateAddress(payload.address)) {
      setStatus(statusEl, 'Please enter a valid delivery address.', 'error');
      return;
    }

    if (!payload.applianceType) {
      setStatus(statusEl, 'Please select an appliance type.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Request failed');

      setStatus(statusEl, "Request received — we'll confirm your delivery window shortly.", 'success');
      orderForm.reset();
    } catch (err) {
      setStatus(statusEl, "Something went wrong sending your request. Please call us instead.", 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request My Delivery';
    }
  });
}

// ---- Account lookup form (pay-bill.html) ----
// NOTE: POSTs to /api/account/lookup, which does not exist on the backend
// yet either. Needs a route that looks up users by email OR phone + zip
// and returns enough info to route the customer to a payment step.
const lookupForm = document.getElementById('lookupForm');
if (lookupForm) {
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('lookupStatus');
    const submitBtn = lookupForm.querySelector('button[type="submit"]');
    const rawData = Object.fromEntries(new FormData(lookupForm).entries());
    const data = sanitizePayload(rawData);

    if (!data.email && !data.phone) {
      setStatus(statusEl, 'Enter either an email address or a phone number.', 'error');
      return;
    }

    if (data.email && !validateEmail(data.email)) {
      setStatus(statusEl, 'Please enter a valid email address.', 'error');
      return;
    }

    if (data.phone && !validatePhone(data.phone)) {
      setStatus(statusEl, 'Please enter a valid phone number.', 'error');
      return;
    }

    if (!data.zip || !/^[0-9]{5}$/.test(data.zip)) {
      setStatus(statusEl, 'Please enter a valid 5-digit billing zip code.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Searching...';

    try {
      const res = await fetch('/api/account/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const responseData = await res.json();

      if (!res.ok) {
        throw new Error(responseData.error || 'Not found');
      }

      if (responseData.checkoutUrl) {
        window.location.href = responseData.checkoutUrl;
        return;
      }

      setStatus(statusEl, 'Account found — redirecting you to payment...', 'success');
    } catch (err) {
      setStatus(statusEl, err.message || "We couldn't find an account matching that information.", 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Find My Account';
    }
  });
}

const ADMIN_TOKEN_KEY = 'adminToken';

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function redirectToAdminLogin(message) {
  const target = '/admin-login.html';

  if (message && typeof window !== 'undefined') {
    sessionStorage.setItem('adminLoginMessage', message);
  }

  window.location.href = target;
}

function showSessionWarning(message) {
  const banner = document.getElementById('sessionWarning');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.add('visible');
}

function setAuthStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('success', 'error');
  el.classList.add('visible', kind);
}

const adminLoginForm = document.getElementById('adminLoginForm');
if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const statusEl = document.getElementById('adminLoginStatus');
    const submitBtn = adminLoginForm.querySelector('button[type="submit"]');
    const rawPayload = Object.fromEntries(new FormData(adminLoginForm).entries());
    const loginValue = String(rawPayload.username || '').trim();
    const loginIsEmail = validateEmail(loginValue);
    const payload = {
      username: loginIsEmail ? '' : loginValue,
      email: loginIsEmail ? loginValue : '',
      // Passwords must be sent unchanged; spaces can be valid password characters.
      password: String(rawPayload.password || ''),
    };

    if ((!payload.username && !payload.email) || !payload.password) {
      setAuthStatus(statusEl, 'Username or email and password are required.', 'error');
      return;
    }

    if (payload.username && !/^[A-Za-z0-9\s'\-.]{2,}$/.test(payload.username)) {
      setAuthStatus(statusEl, 'Please enter a valid username.', 'error');
      return;
    }

    if (payload.email && !validateEmail(payload.email)) {
      setAuthStatus(statusEl, 'Please enter a valid email address.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Invalid admin credentials.');
      }

      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAuthStatus(statusEl, 'Login successful — redirecting...', 'success');
      window.location.href = '/admin.html';
    } catch (err) {
      setAuthStatus(statusEl, err.message || 'Unable to log in.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
    }
  });
}

const adminCustomersTableBody = document.getElementById('adminCustomersTableBody');
const adminStatus = document.getElementById('adminStatus');
const adminLogoutButton = document.getElementById('adminLogoutButton');

if (adminCustomersTableBody) {
  const token = getAdminToken();

  if (!token) {
    redirectToAdminLogin('Your session expired. Please log in again.');
  } else {
    fetch('/api/admin/customers', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (res.status === 401 || res.status === 403 || /expired|invalid|missing|malformed/i.test(data.error || '')) {
            const message = 'Your session expired. Please log in again.';
            showSessionWarning(message);
            clearAdminSession();
            setTimeout(() => redirectToAdminLogin(message), 1200);
            return;
          }
          throw new Error(data.error || 'Access denied.');
        }

        if (!Array.isArray(data.customers) || data.customers.length === 0) {
          adminCustomersTableBody.innerHTML = `
            <tr>
              <td colspan="6" class="muted">No customers found.</td>
            </tr>
          `;
          return;
        }

        adminCustomersTableBody.innerHTML = data.customers.map((customer) => `
          <tr>
            <td>${customer.name || '—'}</td>
            <td>${customer.address || '—'}</td>
            <td>${customer.phone_number || '—'}</td>
            <td>${customer.held_units || 'No Unit Assigned'}</td>
            <td>${customer.installation_status || '—'}</td>
            <td>${customer.billing_start_date ? new Date(customer.billing_start_date).toLocaleDateString() : '—'}</td>
          </tr>
        `).join('');
      })
      .catch((err) => {
        if (/expired|invalid|401|403|session/i.test(err.message || '')) {
          const message = 'Your session expired. Please log in again.';
          showSessionWarning(message);
          clearAdminSession();
          setTimeout(() => redirectToAdminLogin(message), 1200);
          return;
        }

        setAuthStatus(adminStatus, err.message || 'Unable to load customers.', 'error');
        adminCustomersTableBody.innerHTML = `
          <tr>
            <td colspan="6" class="muted">Unable to load customer data.</td>
          </tr>
        `;
      });
  }
}

if (adminLogoutButton) {
  adminLogoutButton.addEventListener('click', async () => {
    const token = getAdminToken();

    if (!token) {
      clearAdminSession();
      redirectToAdminLogin('Please log in to continue.');
      return;
    }

    try {
      const res = await fetch('/api/admin/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403 || /expired|invalid|missing|malformed/i.test(data.error || '')) {
          const message = 'Your session expired. Please log in again.';
          showSessionWarning(message);
          clearAdminSession();
          setTimeout(() => redirectToAdminLogin(message), 1200);
          return;
        }
        throw new Error(data.error || 'Logout failed.');
      }

      clearAdminSession();
      redirectToAdminLogin('Logged out successfully.');
    } catch (err) {
      const message = err.message || 'Your session expired. Please log in again.';
      showSessionWarning(message);
      clearAdminSession();
      setTimeout(() => redirectToAdminLogin(message), 1200);
    }
  });
}
