const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

// ── Protected fetch helper ────────────────────────────────────────────────────
//
// Wraps fetch for admin-only routes that require the session cookie.
// When the server returns 401 (session expired or cleared by a backend restart),
// it dispatches a browser-level 'session:expired' event so App.jsx can
// immediately show the login form — preventing the confusing "stale CRM" state
// where the UI looks loaded but every action silently fails with Unauthorised.

function _dispatchSessionExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('session:expired'))
  }
}

async function protectedFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options })
  const data = await res.json()
  if (res.status === 401) {
    _dispatchSessionExpired()
  }
  if (!res.ok) throw data
  return data
}

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
// Auth calls use raw fetch (not protectedFetch) — 401 here means
// "wrong password" or "not logged in yet", handled explicitly by the caller.

/**
 * Attempt admin login. Sends password to the server — never hardcode credentials here.
 * On success, the server sets an HTTP-only session cookie valid for 7 days.
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
// All CRM calls go through protectedFetch, which adds credentials: 'include'
// and fires 'session:expired' if the server returns 401 (session was cleared
// by a backend restart or redeploy). App.jsx listens for that event and
// redirects to the login form automatically.

function buildQuery(params) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)
  )
  const qs = new URLSearchParams(clean).toString()
  return qs ? `?${qs}` : ''
}

export async function fetchLeads(params = {}) {
  return protectedFetch(`${BASE_URL}/api/leads${buildQuery(params)}`)
}

export async function fetchRegistrations(params = {}) {
  return protectedFetch(`${BASE_URL}/api/academy/registrations${buildQuery(params)}`)
}

export async function fetchStats() {
  return protectedFetch(`${BASE_URL}/api/stats`)
}

export async function updateLeadStatus(id, status) {
  return protectedFetch(`${BASE_URL}/api/leads/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

export async function updateRegistrationStatus(id, status) {
  return protectedFetch(`${BASE_URL}/api/academy/registrations/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

/**
 * Update premium delivery pipeline fields for a registration.
 * fields: { implementationStage, systemSetupStatus, deliveryNotes, deliveryOwner,
 *           implementationCallBooked, deliveryCompletedAt, implementationStatus }
 */
export async function updateImplementationDelivery(id, fields) {
  return protectedFetch(`${BASE_URL}/api/academy/registrations/${id}/delivery`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

/**
 * Toggle one or more task flags for a premium registration.
 * fields: { taskIntakeReviewed, taskScopeReady, taskCallBooked,
 *           taskBuildStarted, taskDeliveryComplete }
 */
export async function updateImplementationTasks(id, fields) {
  return protectedFetch(`${BASE_URL}/api/academy/registrations/${id}/tasks`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

/**
 * Trigger a manual operator action on an academy member.
 * action: 'resend-lesson' | 'unlock-next' | 'pause' | 'resume' |
 *         'complete-lesson' | 'graduate' | 'revoke'
 */
export async function academyOperatorAction(id, action) {
  return protectedFetch(`${BASE_URL}/api/academy/registrations/${id}/operator/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

// ── Academy Access Gate ───────────────────────────────────────────────────────

/**
 * Check whether a registration has completed payment.
 * Returns { paid: true, telegramBotLink, fullName, package } on success,
 * or { paid: false } if payment isn't confirmed yet.
 * Only call this from /academy/success — do NOT expose telegramBotLink elsewhere.
 */
export async function fetchAcademyAccess(registrationId) {
  const res = await fetch(`${BASE_URL}/api/academy/access/${encodeURIComponent(registrationId)}`)
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

// ── Conversion Tracking ───────────────────────────────────────────────────────

/**
 * Record a conversion event (click, signup, payment) against a Lead.
 * Best-effort — never throws; logs errors silently.
 *
 * @param {string}  leadId
 * @param {string}  type   academy_click | consult_click | academy_signup | academy_paid
 * @param {number}  [value]
 */
export async function trackConversion(leadId, type, value) {
  try {
    const body = { leadId, type }
    if (value != null) body.value = value
    await fetch(`${BASE_URL}/api/conversion/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Conversion tracking is non-blocking — swallow network errors silently
  }
}

// ── Auto Reply Execution ──────────────────────────────────────────────────────

/**
 * Execute the initial reply send for a lead via Telegram relay.
 */
export async function sendInitialReply(id) {
  return protectedFetch(`${BASE_URL}/api/leads/${id}/send-initial-reply`, {
    method: 'POST',
  })
}

/**
 * Execute a follow-up send (1, 2, or 3) for a lead via Telegram relay.
 */
export async function sendFollowUp(id, num) {
  return protectedFetch(`${BASE_URL}/api/leads/${id}/send-followup-${num}`, {
    method: 'POST',
  })
}

// ── Conversion Engine — manual CRM actions ───────────────────────────────────

/**
 * Send a conversion offer immediately from the CRM.
 * actionType: 'product_offer' | 'consult_offer' | 'academy_offer' | 'resend_payment'
 */
export async function sendManualConversionAction(leadId, actionType, adminName = 'admin', note = '') {
  return protectedFetch(`${BASE_URL}/api/conversion/manual-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, actionType, adminName, note }),
  })
}

/**
 * Resend the academy payment link to a lead via Telegram.
 */
export async function resendConversionPaymentLink(leadId, adminName = 'admin', note = '') {
  return protectedFetch(`${BASE_URL}/api/conversion/resend-payment-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, adminName, note }),
  })
}

/**
 * Send a custom operator-written conversion message to a lead immediately.
 */
export async function sendConversionCustomMessage(leadId, message, adminName = 'admin', note = '') {
  return protectedFetch(`${BASE_URL}/api/conversion/custom-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, message, adminName, note }),
  })
}

/**
 * Fetch a context-aware message draft for the custom message modal.
 * Returns { draft: string } pre-filled with lead diagnosis/product context.
 */
export async function fetchConversionContext(leadId) {
  return protectedFetch(`${BASE_URL}/api/conversion/context/${encodeURIComponent(leadId)}`)
}

// ── Scraping / Import ─────────────────────────────────────────────────────────

/**
 * Trigger an Apify dataset import from the admin CRM.
 * Uses the existing browser session — no terminal or manual cookie copy needed.
 * Returns ImportSummary: { rawFetched, duplicatesSkipped, sentToProcessing,
 *   processed, qualifiedLeads, hot, warm, cold, rejected,
 *   droppedMissingText, droppedInvalidShape, errors }
 */
export async function importInstagramDataset(datasetId, platform = 'instagram') {
  return protectedFetch(`${BASE_URL}/api/scraping/apify/import-instagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId, platform }),
  })
}

/**
 * Check that the scraping route is live and whether the current browser
 * session is authenticated. Public — works even when not logged in.
 */
export async function fetchScrapingDebugAuth() {
  const res = await fetch(`${BASE_URL}/api/scraping/debug-auth`, {
    credentials: 'include',
  })
  return res.json()
}

/**
 * Extract valid post/reel URLs from a discovery dataset and save them as
 * comment_scrape_targets (pending).
 * Returns PrepareSummary: { rawItemsSeen, droppedInvalidShape, validCandidates,
 *   newTargetsSaved, duplicatesSkipped, invalidSkipped }
 */
export async function prepareInstagramComments(datasetId) {
  return protectedFetch(`${BASE_URL}/api/scraping/apify/prepare-instagram-comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId }),
  })
}

/**
 * Pick up to `limit` pending comment scrape targets and trigger an Apify run.
 * Returns HarvestResult: { pendingFound, targetsQueued, apifyRunId, apifyRunUrl,
 *   apifyRunStatus }
 */
export async function runInstagramComments(limit = 50) {
  return protectedFetch(`${BASE_URL}/api/scraping/apify/run-instagram-comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  })
}

/**
 * Fetch aggregate counts for comment_scrape_targets by status.
 * Returns: { pending, running, done, failed, total }
 */
export async function fetchCommentTargetStats() {
  return protectedFetch(`${BASE_URL}/api/scraping/comment-targets/stats`)
}

/**
 * Import a completed Apify comment-scrape dataset and convert commenters into leads.
 * Returns: { rawItems, normalizedCount, skippedInvalid, inserted, duplicates }
 */
export async function importInstagramCommentDataset(datasetId) {
  return protectedFetch(`${BASE_URL}/api/scraping/apify/import-instagram-comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId }),
  })
}

// ── Product Catalog ───────────────────────────────────────────────────────────

export async function fetchProducts(params = {}) {
  return protectedFetch(`${BASE_URL}/api/products${buildQuery(params)}`)
}

export async function createProduct(data) {
  return protectedFetch(`${BASE_URL}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateProduct(id, data) {
  return protectedFetch(`${BASE_URL}/api/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deactivateProduct(id) {
  return protectedFetch(`${BASE_URL}/api/products/${id}`, { method: 'DELETE' })
}

export async function ingestManualProducts(products) {
  return protectedFetch(`${BASE_URL}/api/products/ingest/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products }),
  })
}

export async function fetchIngestionLogs() {
  return protectedFetch(`${BASE_URL}/api/products/ingestion/logs`)
}

export async function matchProductsForLead(leadId) {
  return protectedFetch(`${BASE_URL}/api/products/match/${leadId}`)
}

export async function generateProductQuote(leadId) {
  return protectedFetch(`${BASE_URL}/api/products/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId }),
  })
}

export async function fetchQuotesForLead(leadId) {
  return protectedFetch(`${BASE_URL}/api/products/quotes/lead/${leadId}`)
}

export async function updateQuoteItem(quoteId, itemId, fields) {
  return protectedFetch(`${BASE_URL}/api/products/quotes/${quoteId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

export async function reviewQuote(quoteId, action) {
  return protectedFetch(`${BASE_URL}/api/products/quotes/${quoteId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

export async function getLeadQuote(leadId) {
  return protectedFetch(`${BASE_URL}/api/products/leads/${leadId}/quote`)
}

export async function sendDiagnosisAndQuote(leadId, quoteId) {
  return protectedFetch(`${BASE_URL}/api/products/leads/${leadId}/send-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId: quoteId || undefined }),
  })
}
