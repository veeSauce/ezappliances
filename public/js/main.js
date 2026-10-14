// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

let toastDismissTimer = null;

function dismissToast() {
  const toast = document.getElementById('appToast');
  if (!toast) return;
  toast.classList.remove('visible');
  clearTimeout(toastDismissTimer);
  toastDismissTimer = null;
}

function showToast(message, kind = 'success') {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('button');
    toast.id = 'appToast';
    toast.type = 'button';
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.title = 'Click to dismiss';
    toast.addEventListener('click', dismissToast);
    document.body.appendChild(toast);
  }
  clearTimeout(toastDismissTimer);
  toast.textContent = message;
  toast.classList.remove('success', 'error');
  toast.classList.add('visible', kind);
  toastDismissTimer = setTimeout(dismissToast, 15_000);
}

// Errors remain next to their form; successful actions are brief, global toasts.
function setStatus(el, message, kind) {
  if (kind === 'success') {
    if (el) {
      el.textContent = '';
      el.classList.remove('visible', 'success', 'error');
    }
    showToast(message, kind);
    return;
  }
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
// Looks up users by email, or by phone number plus a billing ZIP code.
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

    if (!data.email && data.phone && !validatePhone(data.phone)) {
      setStatus(statusEl, 'Please enter a valid phone number.', 'error');
      return;
    }

    if (!data.email && (!data.zip || !/^[0-9]{5}$/.test(data.zip))) {
      setStatus(statusEl, 'Please enter a valid 5-digit billing zip code with your phone number.', 'error');
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

const serviceAccountForm = document.getElementById('serviceAccountForm');
const serviceRequestForm = document.getElementById('serviceRequestForm');
let serviceAccountData = null;

if (serviceAccountForm) {
  serviceAccountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statusEl = document.getElementById('serviceAccountStatus');
    const submitBtn = serviceAccountForm.querySelector('button[type="submit"]');
    const data = sanitizePayload(Object.fromEntries(new FormData(serviceAccountForm).entries()));

    if (!data.email && !data.phone) {
      setStatus(statusEl, 'Enter an email address, or a phone number with billing ZIP code.', 'error');
      return;
    }
    if (data.email && !validateEmail(data.email)) {
      setStatus(statusEl, 'Please enter a valid email address.', 'error');
      return;
    }
    if (!data.email && (!validatePhone(data.phone) || !/^[0-9]{5}$/.test(data.zip || ''))) {
      setStatus(statusEl, 'Enter a valid phone number and 5-digit billing ZIP code.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Finding account...';
    try {
      const res = await fetch('/api/service-requests/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || 'Unable to find account.');
      serviceAccountData = data;
      const options = document.getElementById('serviceEquipmentOptions');
      options.innerHTML = responseData.equipment.map((unit) => `
        <label><input type="checkbox" name="equipmentIds" value="${escapeHtml(unit.id)}"> ${escapeHtml(unit.type)} · ${escapeHtml(unit.model_name)} (${escapeHtml(unit.serial_number)})</label>
      `).join('');
      serviceAccountForm.hidden = true;
      serviceRequestForm.hidden = false;
      serviceRequestForm.querySelector('input').focus();
    } catch (err) {
      setStatus(statusEl, err.message || 'Unable to find account. Please call us instead.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Find my account';
    }
  });
}

if (serviceRequestForm) {
  serviceRequestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statusEl = document.getElementById('serviceRequestStatus');
    const submitBtn = serviceRequestForm.querySelector('button[type="submit"]');
    const equipmentIds = [...serviceRequestForm.querySelectorAll('input[name="equipmentIds"]:checked')].map((input) => Number(input.value));
    const issueType = serviceRequestForm.querySelector('input[name="issueType"]:checked')?.value;
    if (!equipmentIds.length) {
      setStatus(statusEl, 'Select the appliance or appliances needing service.', 'error');
      return;
    }
    if (!issueType) {
      setStatus(statusEl, 'Select the issue that best describes the problem.', 'error');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      const res = await fetch('/api/service-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...serviceAccountData, equipmentIds, issueType })
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || 'Unable to submit service request.');
      serviceRequestForm.reset();
      setStatus(statusEl, 'Your service request has been submitted. Our team will follow up shortly.', 'success');
    } catch (err) {
      setStatus(statusEl, err.message || 'Unable to submit service request. Please call us instead.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit service request';
    }
  });
}

const ADMIN_TOKEN_KEY = 'adminToken';
const CUSTOMER_TOKEN_KEY = 'customerToken';

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function getCustomerToken() {
  return localStorage.getItem(CUSTOMER_TOKEN_KEY) || '';
}

function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
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
  if (kind === 'success') {
    if (el) {
      el.textContent = '';
      el.classList.remove('visible', 'success', 'error');
    }
    showToast(message, kind);
    return;
  }
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

const customerLoginForm = document.getElementById('customerLoginForm');
if (customerLoginForm) {
  if (getCustomerToken()) window.location.href = '/customer-dashboard.html';
  customerLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statusEl = document.getElementById('customerLoginStatus');
    const button = customerLoginForm.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(customerLoginForm).entries());
    const email = String(values.email || '').trim();
    const zip = String(values.zip || '').replace(/\D/g, '');
    if (!validateEmail(email) || !/^\d{5}$/.test(zip)) {
      setAuthStatus(statusEl, 'Enter your email address and 5-digit billing ZIP code.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Signing in...';
    try {
      const res = await fetch('/api/customer/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, zip }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to verify that customer account.');
      localStorage.setItem(CUSTOMER_TOKEN_KEY, data.token);
      window.location.href = '/customer-dashboard.html';
    } catch (err) {
      setAuthStatus(statusEl, err.message || 'Unable to sign in right now.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'View dashboard';
    }
  });
}

const adminPasswordRequestForm = document.getElementById('adminPasswordRequestForm');
if (adminPasswordRequestForm) {
  adminPasswordRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('adminPasswordRequestStatus');
    const submitBtn = adminPasswordRequestForm.querySelector('button[type="submit"]');
    const identifier = String(new FormData(adminPasswordRequestForm).get('identifier') || '').trim();
    if (!identifier) {
      setAuthStatus(statusEl, 'Enter your username or email.', 'error');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    try {
      const res = await fetch('/api/admin/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to request a reset code.');
      setAuthStatus(statusEl, data.message, 'success');
    } catch (err) {
      setAuthStatus(statusEl, err.message || 'Unable to request a reset code.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Email reset code';
    }
  });
}

const adminPasswordResetForm = document.getElementById('adminPasswordResetForm');
if (adminPasswordResetForm) {
  adminPasswordResetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('adminPasswordResetStatus');
    const submitBtn = adminPasswordResetForm.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(adminPasswordResetForm).entries());
    const code = String(values.code || '').trim();
    const newPassword = String(values.newPassword || '');
    if (!code || newPassword.length < 12 || newPassword !== String(values.confirmPassword || '')) {
      setAuthStatus(statusEl, 'Enter the code and matching new passwords of at least 12 characters.', 'error');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to reset password.');
      clearAdminSession();
      setAuthStatus(statusEl, 'Password reset. Redirecting to sign in...', 'success');
      setTimeout(() => { window.location.href = '/admin-login.html'; }, 1000);
    } catch (err) {
      setAuthStatus(statusEl, err.message || 'Unable to reset password.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset password';
    }
  });
}

const adminCustomersTableBody = document.getElementById('adminCustomersTableBody');
const adminNewCustomersTableBody = document.getElementById('adminNewCustomersTableBody');
const adminInventoryTableBody = document.getElementById('adminInventoryTableBody');
const adminMetricsContent = document.getElementById('adminMetricsContent');
const adminPastDueTableBody = document.getElementById('adminPastDueTableBody');
const adminLogOutput = document.getElementById('adminLogOutput');
const adminStatus = document.getElementById('adminStatus');
const adminLogoutButton = document.getElementById('adminLogoutButton');
let logStreamController = null;
let currentMetricView = 'customers';
let latestMetricsData = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatApplianceType(value) {
  return ({
    washer: 'Washer only', dryer: 'Dryer only', washer_dryer_pair: 'Washer + dryer set', stacked_dryer: 'Stacked unit'
  })[value] || value || 'Not specified';
}

async function adminFetch(path, options = {}) {
  const token = getAdminToken();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function handleAdminError(err, statusEl = adminStatus) {
  if (/expired|invalid|401|403|session|authorization/i.test(err.message || '')) {
    const message = 'Your session expired. Please log in again.';
    showSessionWarning(message);
    clearAdminSession();
    setTimeout(() => redirectToAdminLogin(message), 1200);
    return;
  }
  setAuthStatus(statusEl, err.message || 'Unable to load admin data.', 'error');
}

async function loadCustomers() {
  try {
    const data = await adminFetch('/api/admin/customers');
    if (!data.customers?.length) {
      adminCustomersTableBody.innerHTML = '<tr><td colspan="9" class="muted">No customers found.</td></tr>';
      return;
    }
    adminCustomersTableBody.innerHTML = data.customers.map((customer) => `
      <tr>
        <td><a href="/admin-customer.html?id=${encodeURIComponent(customer.user_id)}">${escapeHtml(customer.name || '—')}</a></td>
        <td>${customer.currently_subscribed ? (customer.cancellation_status === 'pending_cancellation' ? `Ending ${formatDate(customer.scheduled_end_at)}` : 'Active') : 'No'}</td>
        <td>${escapeHtml(customer.address || '—')}</td><td>${escapeHtml(customer.phone_number || '—')}</td>
        <td>${escapeHtml(customer.held_units || 'No Unit Assigned')}</td><td>${formatMoney(customer.monthly_rate)}${Number(customer.monthly_rate) === 49.99 ? ' + tax' : ''}</td><td>${escapeHtml(customer.installation_status || '—')}</td>
        <td>${formatDate(customer.billing_start_date)}</td>
        <td class="${customer.past_due ? 'past-due' : ''}">${customer.past_due ? 'Past due' : 'No'}</td>
      </tr>`).join('');
  } catch (err) {
    handleAdminError(err);
    adminCustomersTableBody.innerHTML = '<tr><td colspan="9" class="muted">Unable to load customer data.</td></tr>';
  }
}

async function loadNewCustomers() {
  try {
    const data = await adminFetch('/api/admin/new-customers');
    if (!data.customers?.length) {
      adminNewCustomersTableBody.innerHTML = '<tr><td colspan="7" class="muted">No new customer requests found.</td></tr>';
      return;
    }
    adminNewCustomersTableBody.innerHTML = data.customers.map((customer) => `
      <tr>
        <td><a href="/admin-customer.html?id=${encodeURIComponent(customer.user_id)}">${escapeHtml(customer.name || '—')}</a></td>
        <td>${escapeHtml(customer.email || '—')}</td><td>${escapeHtml(customer.phone_number || '—')}</td>
        <td>${escapeHtml(customer.address || '—')}</td><td>${escapeHtml(formatApplianceType(customer.requested_appliance_type))}</td>
        <td>${formatDate(customer.preferred_delivery_date)}</td><td>${formatDate(customer.requested_at)}</td>
      </tr>`).join('');
  } catch (err) {
    handleAdminError(err);
    adminNewCustomersTableBody.innerHTML = '<tr><td colspan="7" class="muted">Unable to load new customer requests.</td></tr>';
  }
}

async function loadServiceRequests() {
  const tableBody = document.getElementById('adminServiceRequestsTableBody');
  if (!tableBody) return;
  try {
    const data = await adminFetch('/api/admin/service-requests');
    if (!data.requests?.length) {
      tableBody.innerHTML = '<tr><td colspan="8" class="muted">No service requests found.</td></tr>';
      return;
    }
    tableBody.innerHTML = data.requests.map((request) => `
      <tr data-service-request-id="${escapeHtml(request.id)}">
        <td>${formatDate(request.created_at)}</td>
        <td><a href="/admin-customer.html?id=${encodeURIComponent(request.user_id)}">${escapeHtml(request.name || '—')}</a></td>
        <td>${escapeHtml(request.email || '—')}<br><span class="muted">${escapeHtml(request.phone_number || '')}</span></td>
        <td>${escapeHtml(request.equipment)}</td><td>${escapeHtml(request.description)}</td>
        <td><select name="serviceStatus">${['reported', 'in_progress', 'resolved'].map((status) => `<option value="${status}" ${request.status === status ? 'selected' : ''}>${status.replace('_', ' ')}</option>`).join('')}</select></td>
        <td>${formatDate(request.resolved_at)}</td><td><button class="btn btn-outline" type="button" data-service-action="save">Save</button></td>
      </tr>`).join('');
  } catch (err) {
    handleAdminError(err);
    tableBody.innerHTML = '<tr><td colspan="8" class="muted">Unable to load service requests.</td></tr>';
  }
}

async function loadInventory() {
  try {
    const data = await adminFetch('/api/admin/inventory');
    if (!data.inventory?.length) {
      adminInventoryTableBody.innerHTML = '<tr><td colspan="5" class="muted">No appliances found.</td></tr>';
      return;
    }
    adminInventoryTableBody.innerHTML = data.inventory.map((unit) => `
      <tr class="${unit.customer_id ? 'assigned-row' : ''}" ${unit.customer_id ? `data-customer-id="${escapeHtml(unit.customer_id)}" tabindex="0"` : ''}>
        <td>${escapeHtml(unit.type)}</td><td>${escapeHtml(unit.model_name)}</td><td>${escapeHtml(unit.serial_number)}</td>
        <td>${escapeHtml(unit.status)}</td><td>${unit.customer_id ? escapeHtml(unit.customer_name) : 'Unassigned'}</td>
      </tr>`).join('');
  } catch (err) {
    handleAdminError(err);
    adminInventoryTableBody.innerHTML = '<tr><td colspan="5" class="muted">Unable to load inventory.</td></tr>';
  }
}

function metricCard(label, value) {
  return `<article class="metric-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function metricBarChart(title, items, color = 'amber') {
  const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return `<section class="metric-chart"><h3>${escapeHtml(title)}</h3><div class="bar-chart">${items.map((item) => {
    const value = Number(item.value) || 0;
    return `<div class="bar-row"><span>${escapeHtml(item.label)}</span><div class="bar-track"><div class="bar-fill ${color}" style="width:${(value / max) * 100}%"></div></div><strong>${escapeHtml(value)}</strong></div>`;
  }).join('')}</div></section>`;
}

function renderMetrics(data) {
  if (!adminMetricsContent) return;
  const requests = data.requestCounts;
  const billingSection = document.getElementById('customerBillingMetrics');
  if (currentMetricView === 'customers') {
    adminMetricsContent.innerHTML = [
      metricCard('Equipment requests', requests.total),
      metricCard('Active customers', data.activeCustomerCount),
      metricCard('Pending new customers', data.pendingCustomerCount),
      metricCard('Past-due customers', data.pastDue.count),
      metricCard('Estimated outstanding', formatMoney(data.pastDue.estimatedOutstandingBalance)),
      metricBarChart('Customer account status', [
        { label: 'Active customers', value: data.activeCustomerCount },
        { label: 'Pending requests', value: data.pendingCustomerCount },
        { label: 'Past due', value: data.pastDue.count }
      ], 'green')
    ].join('');
    billingSection.hidden = false;
  } else {
    adminMetricsContent.innerHTML = [
      metricCard('Washer requests', requests.washer),
      metricCard('Dryer requests', requests.dryer),
      metricCard('Washer + dryer requests', requests.washer_dryer_pair),
      metricCard('Stacked-unit requests', requests.stacked_dryer),
      ...data.equipmentByStatus.map((item) => metricCard(`Equipment: ${item.status}`, item.count)),
      metricBarChart('New equipment requests', [
        { label: 'Washers', value: requests.washer }, { label: 'Dryers', value: requests.dryer },
        { label: 'Washer + dryer', value: requests.washer_dryer_pair }, { label: 'Stacked units', value: requests.stacked_dryer }
      ]),
      metricBarChart('Inventory status', data.equipmentByStatus.map((item) => ({ label: item.status, value: item.count })), 'steel')
    ].join('');
    billingSection.hidden = true;
  }
}

async function loadMetrics() {
  const form = document.getElementById('metricsFilterForm');
  const values = Object.fromEntries(new FormData(form).entries());
  const params = new URLSearchParams();
  if (values.from) params.set('from', values.from);
  if (values.to) params.set('to', values.to);
  try {
    const data = await adminFetch(`/api/admin/metrics?${params.toString()}`);
    latestMetricsData = data;
    renderMetrics(data);
    adminPastDueTableBody.innerHTML = data.pastDue.customers.length ? data.pastDue.customers.map((customer) => `
      <tr><td><a href="/admin-customer.html?id=${encodeURIComponent(customer.id)}">${escapeHtml(customer.name || '—')}</a></td>
      <td>${escapeHtml(customer.email || '—')}</td><td>${escapeHtml(customer.phone_number || '—')}</td>
      <td>${formatMoney(customer.estimated_outstanding_balance)}</td></tr>`).join('') :
      '<tr><td colspan="4" class="muted">No past-due subscriptions found.</td></tr>';
  } catch (err) {
    handleAdminError(err);
    adminMetricsContent.innerHTML = '<p class="muted">Unable to load metrics.</p>';
    adminPastDueTableBody.innerHTML = '<tr><td colspan="4" class="muted">Unable to load past-due accounts.</td></tr>';
  }
}

function stopLogStream() {
  if (logStreamController) logStreamController.abort();
  logStreamController = null;
}

async function streamLogs() {
  if (!adminLogOutput || logStreamController) return;
  logStreamController = new AbortController();
  adminLogOutput.textContent = 'Connecting to application logs…\n';
  try {
    const response = await fetch('/api/admin/logs/stream', {
      headers: { Authorization: `Bearer ${getAdminToken()}` }, signal: logStreamController.signal
    });
    if (!response.ok || !response.body) throw new Error('Unable to connect to application logs.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstBatch = true;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      events.forEach((event) => {
        const line = event.split('\n').find((item) => item.startsWith('data: '));
        if (!line) return;
        try {
          const entries = JSON.parse(line.slice(6));
          const output = entries.map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`).join('\n');
          adminLogOutput.textContent = firstBatch ? `${output}\n` : `${adminLogOutput.textContent}${output}\n`;
          firstBatch = false;
          adminLogOutput.scrollTop = adminLogOutput.scrollHeight;
        } catch (_) { /* Ignore malformed stream data. */ }
      });
    }
  } catch (err) {
    if (err.name !== 'AbortError') adminLogOutput.textContent += `Unable to stream logs: ${err.message}\n`;
  } finally {
    logStreamController = null;
  }
}

if (adminCustomersTableBody) {
  const token = getAdminToken();
  if (!token) {
    redirectToAdminLogin('Your session expired. Please log in again.');
  } else {
    loadCustomers();
    document.getElementById('metricsFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      loadMetrics();
    });
    document.querySelectorAll('[data-metric-view]').forEach((tab) => tab.addEventListener('click', () => {
      currentMetricView = tab.dataset.metricView;
      document.querySelectorAll('[data-metric-view]').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      if (latestMetricsData) renderMetrics(latestMetricsData);
    }));
    document.querySelectorAll('[data-admin-view]').forEach((tab) => tab.addEventListener('click', () => {
      const view = tab.dataset.adminView;
      document.getElementById('customersView').hidden = view !== 'customers';
      document.getElementById('newCustomersView').hidden = view !== 'new-customers';
      document.getElementById('serviceRequestsView').hidden = view !== 'service-requests';
      document.getElementById('inventoryView').hidden = view !== 'inventory';
      document.getElementById('metricsView').hidden = view !== 'metrics';
      document.getElementById('logsView').hidden = view !== 'logs';
      document.querySelectorAll('[data-admin-view]').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active));
      });
      if (view === 'new-customers') loadNewCustomers();
      if (view === 'service-requests') loadServiceRequests();
      if (view === 'inventory') loadInventory();
      if (view === 'metrics') loadMetrics();
      if (view === 'logs') streamLogs(); else stopLogStream();
    }));
    adminInventoryTableBody.addEventListener('click', (event) => {
      const row = event.target.closest('[data-customer-id]');
      if (row) window.location.href = `/admin-customer.html?id=${encodeURIComponent(row.dataset.customerId)}`;
    });
    document.getElementById('adminServiceRequestsTableBody')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-service-action="save"]');
      if (!button) return;
      const row = button.closest('[data-service-request-id]');
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/service-requests/${encodeURIComponent(row.dataset.serviceRequestId)}`, {
          method: 'PATCH', body: JSON.stringify({ status: row.querySelector('[name="serviceStatus"]').value })
        });
        setAuthStatus(adminStatus, 'Service request status updated.', 'success');
        loadServiceRequests();
      } catch (err) {
        handleAdminError(err);
      } finally {
        button.disabled = false;
      }
    });
    adminInventoryTableBody.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.target.closest('[data-customer-id]')?.click();
    });
    document.getElementById('addInventoryForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await adminFetch('/api/admin/inventory', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        form.reset();
        setAuthStatus(adminStatus, 'Appliance added to inventory.', 'success');
        loadInventory();
      } catch (err) {
        handleAdminError(err);
      } finally {
        button.disabled = false;
      }
    });
  }
}

const customerDetail = document.getElementById('customerDetail');
const customerDetailStatus = document.getElementById('customerDetailStatus');

function dateInputValue(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function assignmentForm(assignment) {
  return `<article class="assignment-card" data-assignment-id="${assignment.id}">
    <h3>${escapeHtml(assignment.type)} · ${escapeHtml(assignment.model_name)} <span class="muted">${escapeHtml(assignment.serial_number)}</span></h3>
    <div class="assignment-fields">
      <label>Installation status<select name="installationStatus">
        ${['pending', 'scheduled', 'completed'].map((status) => `<option value="${status}" ${assignment.installation_status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select></label>
      <label>Install date<input name="installationDate" type="date" value="${dateInputValue(assignment.installation_date)}"></label>
      <label>Billing start date<input name="billingStartDate" type="date" value="${dateInputValue(assignment.billing_start_date)}"></label>
    </div>
    <div class="assignment-actions"><button class="btn btn-primary" type="button" data-action="save">Save changes</button><button class="btn btn-outline btn-danger" type="button" data-action="unassign">Unassign appliance</button></div>
  </article>`;
}

function assignmentHistoryItem(assignment) {
  return `<article class="assignment-card assignment-history">
    <h3>${escapeHtml(assignment.type)} · ${escapeHtml(assignment.model_name)} <span class="muted">${escapeHtml(assignment.serial_number)}</span></h3>
    <p>Assigned: ${formatDate(assignment.created_at)} · Unassigned: ${formatDate(assignment.unassigned_at)}</p>
    <p>Installation: ${escapeHtml(assignment.installation_status || '—')} · Monthly rate: ${formatMoney(assignment.monthly_rate)}</p>
  </article>`;
}

async function loadCustomerDetail() {
  const customerId = new URLSearchParams(window.location.search).get('id');
  if (!customerId || !getAdminToken()) {
    redirectToAdminLogin('Please log in to view customer details.');
    return;
  }
  try {
    const data = await adminFetch(`/api/admin/customers/${encodeURIComponent(customerId)}`);
    const { customer, assignments, assignmentHistory, availableEquipment, subscription, cancellationRequest } = data;
    const subscriptionIsCurrent = subscription && ['active', 'trialing', 'past_due'].includes(subscription.status);
    const subscriptionSummary = subscriptionIsCurrent
      ? `${subscription.status}${cancellationRequest?.status === 'pending_cancellation' ? ` · ends ${formatDate(cancellationRequest.scheduled_end_at)}` : ` · renews through ${formatDate(subscription.current_period_end)}`}`
      : 'Not currently subscribed';
    const subscriptionAction = cancellationRequest?.status === 'requested' && subscriptionIsCurrent
      ? '<button class="btn btn-outline btn-danger" type="button" data-subscription-action="cancel">Schedule cancellation at period end</button>'
      : (cancellationRequest?.status === 'pending_cancellation' || !subscriptionIsCurrent)
        ? '<button class="btn btn-amber" type="button" data-subscription-action="reenroll">Re-enroll customer</button>'
        : '';
    customerDetail.innerHTML = `
      <section class="customer-card"><span class="eyebrow">Customer details</span><h1>${escapeHtml(customer.name)}</h1>
        <div class="customer-meta"><div><strong>Email</strong>${escapeHtml(customer.email || '—')}</div><div><strong>Phone</strong>${escapeHtml(customer.phone_number || '—')}</div><div><strong>Address</strong>${escapeHtml(customer.address || '—')}</div><div><strong>Monthly rate</strong>${formatMoney(customer.monthly_rate)}${assignments.length === 2 ? ' + applicable tax' : ''}</div><div><strong>Subscription</strong>${escapeHtml(subscriptionSummary)}</div></div>
        ${subscriptionAction ? `<div class="assignment-actions">${subscriptionAction}</div>` : ''}
      </section>
      <section><h2>Assigned appliances</h2>${assignments.length ? assignments.map(assignmentForm).join('') : '<p class="muted">No appliances assigned.</p>'}</section>
      <section><h2>Assignment history</h2>${assignmentHistory.length ? assignmentHistory.map(assignmentHistoryItem).join('') : '<p class="muted">No previous appliance assignments.</p>'}</section>
      <section class="customer-card"><h2>Assign appliance</h2>
        ${availableEquipment.length ? `<form id="assignApplianceForm"><div class="assignment-fields">
          <label>Available appliance<select name="equipmentId" required>${availableEquipment.map((unit) => `<option value="${unit.id}">${escapeHtml(unit.type)} · ${escapeHtml(unit.model_name)} (${escapeHtml(unit.serial_number)})</option>`).join('')}</select></label>
          <label>Installation status<select name="installationStatus"><option value="pending">pending</option><option value="scheduled">scheduled</option><option value="completed">completed</option></select></label>
          <label>Install date<input name="installationDate" type="date"></label><label>Billing start date<input name="billingStartDate" type="date"></label>
        </div><div class="assignment-actions"><button class="btn btn-amber" type="submit">Assign appliance</button></div></form>` : '<p class="muted">No unassigned appliances are available.</p>'}
      </section>`;

    customerDetail.querySelectorAll('[data-action="save"]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-assignment-id]');
      const values = {
        installationStatus: card.querySelector('[name="installationStatus"]').value,
        installationDate: card.querySelector('[name="installationDate"]').value || null,
        billingStartDate: card.querySelector('[name="billingStartDate"]').value || null,
      };
      try {
        await adminFetch(`/api/admin/customers/${encodeURIComponent(customerId)}/assignments/${card.dataset.assignmentId}`, { method: 'PATCH', body: JSON.stringify(values) });
        setAuthStatus(customerDetailStatus, 'Assignment updated.', 'success');
      } catch (err) { handleAdminError(err, customerDetailStatus); }
    }));
    customerDetail.querySelector('[data-subscription-action="cancel"]')?.addEventListener('click', async () => {
      if (!window.confirm('Schedule this subscription to end when the current billing period ends?')) return;
      try {
        await adminFetch(`/api/admin/customers/${encodeURIComponent(customerId)}/subscription/cancel`, { method: 'POST' });
        setAuthStatus(customerDetailStatus, 'Cancellation scheduled for the end of the current billing period.', 'success');
        loadCustomerDetail();
      } catch (err) { handleAdminError(err, customerDetailStatus); }
    });
    customerDetail.querySelector('[data-subscription-action="reenroll"]')?.addEventListener('click', async () => {
      if (!window.confirm('Re-enroll this customer? A new billing cycle may begin immediately.')) return;
      try {
        await adminFetch(`/api/admin/customers/${encodeURIComponent(customerId)}/subscription/reenroll`, { method: 'POST' });
        setAuthStatus(customerDetailStatus, 'Customer re-enrolled successfully.', 'success');
        loadCustomerDetail();
      } catch (err) { handleAdminError(err, customerDetailStatus); }
    });
    customerDetail.querySelectorAll('[data-action="unassign"]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Unassign this appliance from the customer?')) return;
      try {
        await adminFetch(`/api/admin/customers/${encodeURIComponent(customerId)}/assignments/${button.closest('[data-assignment-id]').dataset.assignmentId}`, { method: 'DELETE' });
        setAuthStatus(customerDetailStatus, 'Appliance unassigned.', 'success'); loadCustomerDetail();
      } catch (err) { handleAdminError(err, customerDetailStatus); }
    }));
    document.getElementById('assignApplianceForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await adminFetch(`/api/admin/customers/${encodeURIComponent(customerId)}/assignments`, { method: 'POST', body: JSON.stringify(values) });
        setAuthStatus(customerDetailStatus, 'Appliance assigned.', 'success'); loadCustomerDetail();
      } catch (err) { handleAdminError(err, customerDetailStatus); }
    });
  } catch (err) {
    handleAdminError(err, customerDetailStatus);
    customerDetail.innerHTML = '<p class="muted">Unable to load customer details.</p>';
  }
}

if (customerDetail) loadCustomerDetail();

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

async function customerPortalFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getCustomerToken()}`, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function applianceTableRows(appliances, includeUnassignedDate = false) {
  if (!appliances.length) return '<tr><td colspan="4" class="muted">None</td></tr>';
  return appliances.map((item) => `<tr><td>${escapeHtml(formatApplianceType(item.type))}</td><td>${escapeHtml(item.model_name || '—')}</td><td>${escapeHtml(item.serial_number || '—')}</td><td>${includeUnassignedDate ? formatDate(item.unassigned_at) : escapeHtml(item.installation_status || '—')}</td></tr>`).join('');
}

async function loadCustomerDashboard() {
  const content = document.getElementById('customerDashboardContent');
  const statusEl = document.getElementById('customerDashboardStatus');
  if (!getCustomerToken()) {
    window.location.href = '/customer-login.html';
    return;
  }
  try {
    const data = await customerPortalFetch('/api/customer/dashboard');
    const { customer, payments, subscriptions, activeAppliances, previousAppliances, cancellationRequest, serviceRequests } = data;
    const currentSubscription = subscriptions.find((subscription) =>
      ['active', 'trialing', 'past_due'].includes(subscription.status) &&
      (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date())
    ) || null;
    const cancellationPending = ['requested', 'pending_cancellation'].includes(cancellationRequest?.status);
    const canRequestCancellation = Boolean(currentSubscription) && !cancellationPending;
    const cancellationMessage = cancellationRequest?.status === 'pending_cancellation'
      ? `Your service is scheduled to end on ${formatDate(cancellationRequest.scheduled_end_at)}. No future renewal will be charged.`
      : 'Your cancellation request is pending staff review.';
    content.innerHTML = `
      <section class="customer-card"><span class="eyebrow">Account details</span><h2>${escapeHtml(customer.name || 'Customer')}</h2>
        <div class="customer-meta"><div><strong>Email</strong>${escapeHtml(customer.email || '—')}</div><div><strong>Phone</strong>${escapeHtml(customer.phone_number || '—')}</div><div><strong>Address</strong>${escapeHtml(customer.address || '—')}</div><div><strong>Monthly rate</strong>${formatMoney(customer.monthly_rate)}</div></div>
      </section>
      <div class="admin-tabs" role="tablist" aria-label="Customer dashboard views">
        <button class="admin-tab active" type="button" data-customer-view="current" role="tab" aria-selected="true">Current order</button>
        <button class="admin-tab" type="button" data-customer-view="previous-orders" role="tab" aria-selected="false">Previous orders</button>
        <button class="admin-tab" type="button" data-customer-view="billing-history" role="tab" aria-selected="false">Billing history</button>
        <button class="admin-tab" type="button" data-customer-view="service-requests" role="tab" aria-selected="false">Service requests</button>
      </div>
      <section data-customer-panel="current" role="tabpanel">
        <h2>Current order</h2>
        <div class="customer-meta"><div><strong>Current monthly billing</strong>${formatMoney(customer.monthly_rate)}</div><div><strong>Billing status</strong>${escapeHtml(currentSubscription?.status || 'No current billing record')}</div><div><strong>Billing period</strong>${currentSubscription ? `${formatDate(currentSubscription.current_period_start)} – ${formatDate(currentSubscription.current_period_end)}` : '—'}</div></div>
        <h3>Current appliances</h3><div class="admin-table-wrap"><table><thead><tr><th>Type</th><th>Model</th><th>Serial number</th><th>Installation status</th></tr></thead><tbody>${applianceTableRows(activeAppliances)}</tbody></table></div>
        ${currentSubscription ? `<div class="assignment-actions"><button id="customerCancellationButton" class="btn btn-outline btn-danger" type="button" ${canRequestCancellation ? '' : 'disabled'}>${cancellationPending ? 'Cancellation requested' : 'Request cancellation'}</button></div>` : '<p class="muted">There is no active subscription to cancel.</p>'}
        <p id="customerCancellationStatus" class="form-status ${cancellationPending ? 'visible success' : ''}" role="status">${cancellationPending ? cancellationMessage : ''}</p>
      </section>
      <section data-customer-panel="previous-orders" role="tabpanel" hidden>
        <h2>Previous orders</h2><p>Appliances previously assigned to your account.</p><div class="admin-table-wrap"><table><thead><tr><th>Type</th><th>Model</th><th>Serial number</th><th>Unassigned</th></tr></thead><tbody>${applianceTableRows(previousAppliances, true)}</tbody></table></div>
      </section>
      <section data-customer-panel="billing-history" role="tabpanel" hidden>
        <h2>Billing history</h2><div class="admin-table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Payment reference</th><th>Receipt</th></tr></thead><tbody>${payments.length ? payments.map((payment) => `<tr><td>${formatDate(payment.paid_at)}</td><td>${formatMoney(Number(payment.amount_cents || 0) / 100)}</td><td>${escapeHtml(payment.payment_intent_id)}</td><td>${payment.receipt_url ? `<a href="${escapeHtml(payment.receipt_url)}" target="_blank" rel="noopener">View receipt</a>` : '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No payments have been recorded yet.</td></tr>'}</tbody></table></div>
        <h3>Billing record</h3><div class="admin-table-wrap"><table><thead><tr><th>Status</th><th>Period starts</th><th>Period ends</th></tr></thead><tbody>${subscriptions.length ? subscriptions.map((subscription) => `<tr><td>${escapeHtml(subscription.status || '—')}</td><td>${formatDate(subscription.current_period_start)}</td><td>${formatDate(subscription.current_period_end)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No recurring billing record found.</td></tr>'}</tbody></table></div>
      </section>
      <section data-customer-panel="service-requests" role="tabpanel" hidden>
        <h2>Service requests</h2><p>Track the status of equipment service requests submitted for your account.</p><div class="admin-table-wrap"><table><thead><tr><th>Submitted</th><th>Appliance</th><th>Issue</th><th>Status</th><th>Resolved</th></tr></thead><tbody>${serviceRequests.length ? serviceRequests.map((request) => `<tr><td>${formatDate(request.created_at)}</td><td>${escapeHtml(request.equipment)}</td><td>${escapeHtml(request.description)}</td><td>${escapeHtml(String(request.status || '').replace('_', ' ') || '—')}</td><td>${formatDate(request.resolved_at)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">No service requests have been submitted.</td></tr>'}</tbody></table></div>
      </section>`;

    content.querySelectorAll('[data-customer-view]').forEach((tab) => tab.addEventListener('click', () => {
      const view = tab.dataset.customerView;
      content.querySelectorAll('[data-customer-panel]').forEach((panel) => { panel.hidden = panel.dataset.customerPanel !== view; });
      content.querySelectorAll('[data-customer-view]').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
    }));
    document.getElementById('customerCancellationButton')?.addEventListener('click', async () => {
      if (!window.confirm('Request cancellation of your appliance rental? Our team will review your request.')) return;
      const button = document.getElementById('customerCancellationButton');
      const cancellationStatus = document.getElementById('customerCancellationStatus');
      button.disabled = true;
      try {
        await customerPortalFetch('/api/customer/cancellation-request', { method: 'POST' });
        button.textContent = 'Cancellation requested';
        setAuthStatus(cancellationStatus, 'Your cancellation request is pending staff review.', 'success');
      } catch (err) {
        button.disabled = false;
        setAuthStatus(cancellationStatus, err.message || 'Unable to submit your cancellation request.', 'error');
      }
    });
  } catch (err) {
    if (/session|expired|invalid|authorization/i.test(err.message || '')) {
      clearCustomerSession();
      window.location.href = '/customer-login.html';
      return;
    }
    setAuthStatus(statusEl, err.message || 'Unable to load your dashboard.', 'error');
    content.innerHTML = '<p class="muted">Unable to load your account.</p>';
  }
}

const customerDashboardContent = document.getElementById('customerDashboardContent');
if (customerDashboardContent) loadCustomerDashboard();

const customerLogoutButton = document.getElementById('customerLogoutButton');
if (customerLogoutButton) {
  customerLogoutButton.addEventListener('click', async () => {
    try { await customerPortalFetch('/api/customer/logout', { method: 'POST' }); } catch (_) { /* Clear local session either way. */ }
    clearCustomerSession();
    window.location.href = '/customer-login.html';
  });
}
