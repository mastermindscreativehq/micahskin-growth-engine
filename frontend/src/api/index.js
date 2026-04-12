const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

// ── Public form submissions ───────────────────────────────────────────────────

/**
 * Submit a skincare lead. Public — no auth cookie needed.
 */
export async function submitLead(formData) {
  const res = await fetch(`${BASE_URL}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

/**
 * Submit an academy registration. Public — no auth cookie needed.
 */
export async function submitAcademyRegistration(formData) {
  const res = await fetch(`${BASE_URL}/api/academy/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

// ── Admin auth ────────────────────────────────────────────────────────────────
// All auth calls use credentials: 'include' so the browser sends and receives
// the HTTP-only session cookie set by the backend.

/**
 * Attempt admin login. Sends password to the server — never hardcode credentials here.
 * On success, the server sets an HTTP-only session cookie valid for 8 hours.
 */
export async function loginAdmin(password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Required to receive the session cookie
    body: JSON.stringify({ password }),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

/**
 * Log out of admin. Destroys the server-side session and clears the cookie.
 */
export async function logoutAdmin() {
  const res = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

/**
 * Check whether the current session is still authenticated.
 * Used on page load to restore admin access without re-entering the password.
 * Throws (with 401) if not authenticated.
 */
export async function checkAdminSession() {
  const res = await fetch(`${BASE_URL}/api/auth/me`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

// ── CRM / Admin data ─────────────────────────────────────────────────────────
// All CRM calls include credentials: 'include' so the session cookie is sent
// on every request and the backend requireAuth middleware can verify it.

function buildQuery(params) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)
  )
  const qs = new URLSearchParams(clean).toString()
  return qs ? `?${qs}` : ''
}

export async function fetchLeads(params = {}) {
  const res = await fetch(`${BASE_URL}/api/leads${buildQuery(params)}`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

export async function fetchRegistrations(params = {}) {
  const res = await fetch(`${BASE_URL}/api/academy/registrations${buildQuery(params)}`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

export async function fetchStats() {
  const res = await fetch(`${BASE_URL}/api/stats`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

export async function updateLeadStatus(id, status) {
  const res = await fetch(`${BASE_URL}/api/leads/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

export async function updateRegistrationStatus(id, status) {
  const res = await fetch(`${BASE_URL}/api/academy/registrations/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

// ── Academy Payment ───────────────────────────────────────────────────────────

/**
 * Save package choice for a registration and get the Paystack payment link.
 * Public — no auth cookie needed.
 */
export async function selectPackage(leadId, pkg) {
  const res = await fetch(`${BASE_URL}/api/academy/select-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, package: pkg }),
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

// ── Auto Reply Execution ──────────────────────────────────────────────────────

/**
 * Execute the initial reply send for a lead via Telegram relay.
 */
export async function sendInitialReply(id) {
  const res = await fetch(`${BASE_URL}/api/leads/${id}/send-initial-reply`, {
    method: 'POST',
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}

/**
 * Execute a follow-up send (1, 2, or 3) for a lead via Telegram relay.
 */
export async function sendFollowUp(id, num) {
  const res = await fetch(`${BASE_URL}/api/leads/${id}/send-followup-${num}`, {
    method: 'POST',
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}
