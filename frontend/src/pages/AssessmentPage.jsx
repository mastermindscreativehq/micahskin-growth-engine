import { useState, useEffect } from 'react'
import PhoneInput, { combinePhone } from '../components/PhoneInput.jsx'
import {
  fetchAssessmentConfig,
  startAssessment,
  fetchAssessmentSession,
  completeAssessmentIntake,
  initializeAssessmentPayment,
} from '../api/index.js'

// Same-browser resume only (no cross-device login exists anywhere in this app).
// Lets a customer whose payment failed/was abandoned pick up where they left
// off without redoing intake or creating a duplicate AssessmentSession.
const STORAGE_KEY = 'msk_assessment_session_id'
const RESUMABLE_STATUSES = ['payment_required', 'payment_initialized', 'payment_failed']
const PAYMENT_PHASE_STATUSES = ['payment_required', 'payment_initialized', 'payment_failed']

function readStoredSessionId() {
  try { return localStorage.getItem(STORAGE_KEY) || null } catch { return null }
}
function storeSessionId(id) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
}
function clearStoredSessionId() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export default function AssessmentPage() {
  const [phase, setPhase] = useState('loading') // loading | intake | payment | error
  const [sessionId, setSessionId] = useState(null)
  const [config, setConfig] = useState(null)
  const [failureReason, setFailureReason] = useState(null)

  const [form, setForm] = useState({
    fullName: '', email: '', countryKey: 'NG', localPhone: '',
    concern: '', skinType: '', severity: '', routineLevel: '',
    sensitivity: '', budget: '', goal: '', notes: '',
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const cfg = await fetchAssessmentConfig()
        if (cancelled) return
        setConfig(cfg)

        const stored = readStoredSessionId()
        if (stored) {
          try {
            const res = await fetchAssessmentSession(stored)
            const s = res.data
            if (RESUMABLE_STATUSES.includes(s.status)) {
              setSessionId(stored)
              setForm(prev => ({
                ...prev,
                fullName: s.fullName || prev.fullName,
                email: s.email || prev.email,
                ...(s.intakeAnswers || {}),
              }))
              setFailureReason(s.failureReason || null)
              setPhase(PAYMENT_PHASE_STATUSES.includes(s.status) ? 'payment' : 'intake')
              return
            }
          } catch {
            // Stored session is gone, already paid, or invalid — start fresh below.
          }
          clearStoredSessionId()
        }

        const started = await startAssessment()
        if (cancelled) return
        storeSessionId(started.data.sessionId)
        setSessionId(started.data.sessionId)
        setPhase('intake')
      } catch {
        if (!cancelled) setPhase('error')
      }
    }

    init()
    return () => { cancelled = true }
  }, [])

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmitIntake(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await completeAssessmentIntake(sessionId, {
        fullName: form.fullName,
        email: form.email,
        phone: combinePhone(form.countryKey, form.localPhone) || undefined,
        answers: {
          concern: form.concern,
          skinType: form.skinType,
          severity: form.severity,
          routineLevel: form.routineLevel,
          sensitivity: form.sensitivity || undefined,
          budget: form.budget || undefined,
          goal: form.goal || undefined,
          notes: form.notes || undefined,
        },
      })
      setPhase('payment')
    } catch (err) {
      const messages = err.errors?.length
        ? err.errors.join(' · ')
        : err.message || 'Something went wrong. Please try again.'
      setError(messages)
    } finally {
      setLoading(false)
    }
  }

  async function handlePay() {
    setPayError(null)
    setPayLoading(true)
    try {
      const result = await initializeAssessmentPayment(sessionId)
      window.location.href = result.data.authorizationUrl
    } catch (err) {
      setPayError(err.message || 'Could not start payment. Please try again.')
      setPayLoading(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Something Went Wrong</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            We couldn't start your assessment. Please refresh the page or contact us.
          </p>
          <a href="mailto:mastermindscreativehq@gmail.com" className="btn-primary inline-block">
            Contact Support
          </a>
        </div>
      </div>
    )
  }

  // ── Payment gate ─────────────────────────────────────────────────────────────
  if (phase === 'payment') {
    const fee = config?.feeNgn ?? 10000
    return (
      <section className="px-6 py-14 bg-white min-h-screen flex items-center">
        <div className="max-w-lg mx-auto text-center">
          <div className="text-5xl mb-5">🧪</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Your Personalized Skin Assessment</h1>

          {failureReason && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl px-4 py-3 mb-6 text-left">
              Payment wasn't completed last time. Your answers are saved — you can try again below.
            </div>
          )}

          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            Complete your assessment payment to unlock your personalized skin analysis and recommendations.
          </p>

          <div className="text-4xl font-bold text-gray-900 mb-8">₦{fee.toLocaleString('en-NG')}</div>

          {payError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-6 text-left">
              {payError}
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={payLoading}
            className="btn-primary w-full text-base py-4"
          >
            {payLoading ? 'Redirecting…' : failureReason ? 'Try Payment Again' : 'Unlock My Skin Assessment'}
          </button>

          <p className="text-xs text-gray-400 mt-6 leading-relaxed">
            This ₦{fee.toLocaleString('en-NG')} fee covers your Personalized Skin Assessment only —
            it is not a product purchase, deposit, or credit.
          </p>
        </div>
      </section>
    )
  }

  // ── Intake form ──────────────────────────────────────────────────────────────
  return (
    <section className="px-6 py-14 bg-white min-h-screen">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Personalized Skin Assessment</h1>
        <p className="text-gray-500 text-sm mb-8">
          Answer a few quick questions so we can build your personalized skin analysis and recommendations.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmitIntake} className="space-y-5">
          <div>
            <label className="form-label" htmlFor="fullName">Full Name *</label>
            <input
              id="fullName" name="fullName" type="text" required className="form-input"
              placeholder="e.g. Amara Osei" value={form.fullName} onChange={handleChange}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="email">Email Address *</label>
            <input
              id="email" name="email" type="email" required className="form-input"
              placeholder="your@email.com" value={form.email} onChange={handleChange}
            />
          </div>

          <div>
            <label className="form-label">WhatsApp / Phone Number</label>
            <PhoneInput
              countryKey={form.countryKey}
              localPhone={form.localPhone}
              onCountryChange={(v) => setForm(prev => ({ ...prev, countryKey: v }))}
              onLocalChange={(v) => setForm(prev => ({ ...prev, localPhone: v }))}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="concern">What's your main skin concern? *</label>
            <select id="concern" name="concern" required className="form-input" value={form.concern} onChange={handleChange}>
              <option value="">Select a concern</option>
              {(config?.concernOptions || []).map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="skinType">What's your skin type? *</label>
            <select id="skinType" name="skinType" required className="form-input" value={form.skinType} onChange={handleChange}>
              <option value="">Select your skin type</option>
              {(config?.skinTypeOptions || []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="severity">How would you describe it? *</label>
            <select id="severity" name="severity" required className="form-input" value={form.severity} onChange={handleChange}>
              <option value="">Select severity</option>
              {(config?.severityOptions || []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="routineLevel">How much routine are you looking for? *</label>
            <select id="routineLevel" name="routineLevel" required className="form-input" value={form.routineLevel} onChange={handleChange}>
              <option value="">Select routine level</option>
              {(config?.routineLevelOptions || []).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="sensitivity">Does your skin react easily to new products?</label>
            <select id="sensitivity" name="sensitivity" className="form-input" value={form.sensitivity} onChange={handleChange}>
              <option value="">Select an option (optional)</option>
              {(config?.sensitivityOptions || []).map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="goal">What do you want to achieve?</label>
            <textarea
              id="goal" name="goal" rows={3} className="form-input resize-none"
              placeholder="e.g. Clear skin, even tone, a simple daily routine…"
              value={form.goal} onChange={handleChange}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="notes">Anything else we should know?</label>
            <textarea
              id="notes" name="notes" rows={3} className="form-input resize-none"
              placeholder="How long you've dealt with this, what you've tried, etc."
              value={form.notes} onChange={handleChange}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Saving…' : 'Continue to Payment'}
          </button>
        </form>
      </div>
    </section>
  )
}
