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
    const payload = Object.fromEntries(new FormData(orderForm).entries());

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
    const data = Object.fromEntries(new FormData(lookupForm).entries());

    if (!data.email && !data.phone) {
      setStatus(statusEl, 'Enter either an email address or a phone number.', 'error');
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

      if (!res.ok) throw new Error('Not found');

      setStatus(statusEl, 'Account found — redirecting you to payment...', 'success');
    } catch (err) {
      setStatus(statusEl, "We couldn't find an account matching that information.", 'error');
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
    const payload = Object.fromEntries(new FormData(adminLoginForm).entries());

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
    window.location.href = '/admin-login.html';
  } else {
    fetch('/api/admin/customers', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    })
      .then(async (res) => {
        const data = await res.json();

        if (!res.ok) {
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
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      window.location.href = '/admin-login.html';
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
        throw new Error(data.error || 'Logout failed.');
      }

      localStorage.removeItem(ADMIN_TOKEN_KEY);
      window.location.href = '/admin-login.html';
    } catch (err) {
      setAuthStatus(adminStatus, err.message || 'Unable to log out.', 'error');
    }
  });
}
