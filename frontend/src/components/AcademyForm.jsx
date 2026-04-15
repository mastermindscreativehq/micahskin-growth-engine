import { useState } from 'react'
import { submitAcademyRegistration, selectPackage, trackConversion } from '../api/index.js'
import PhoneInput, { combinePhone } from './PhoneInput.jsx'

const PLATFORMS = ['TikTok', 'Instagram', 'Other']
const LEVELS = [
  { value: 'beginner', label: 'Beginner — Just starting out' },
  { value: 'intermediate', label: 'Intermediate — Have some experience' },
  { value: 'advanced', label: 'Advanced — Growing an existing brand' },
]

export default function AcademyForm({ onSuccess, onBack, prefill = {}, leadId = null, embedded = false }) {
  // step: 'form' → 'packages' → (redirect to Paystack)
  const [step, setStep] = useState('form')
  const [registrationId, setRegistrationId] = useState(null)
  const [packageLoading, setPackageLoading] = useState(null) // 'premium' | 'basic' | null
  const [packageError, setPackageError] = useState(null)

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    countryKey: 'NG',
    localPhone: '',
    businessType: '',
    experienceLevel: '',
    goals: '',
    sourcePlatform: prefill.sourcePlatform || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await submitAcademyRegistration({
        fullName: form.fullName,
        email: form.email,
        phone: combinePhone(form.countryKey, form.localPhone),
        businessType: form.businessType,
        experienceLevel: form.experienceLevel,
        goals: form.goals,
        sourcePlatform: form.sourcePlatform,
        sourceType: prefill.sourceType || undefined,
        handle: prefill.handle || undefined,
        campaign: prefill.campaign || undefined,
        utmSource: prefill.utmSource || undefined,
        utmMedium: prefill.utmMedium || undefined,
        utmCampaign: prefill.utmCampaign || undefined,
        utmContent: prefill.utmContent || undefined,
        utmTerm: prefill.utmTerm || undefined,
      })
      setRegistrationId(result.data?.id || null)
      if (leadId) {
        trackConversion(leadId, 'academy_signup')
      }
      setStep('packages')
    } catch (err) {
      const messages = err.errors?.length
        ? err.errors.join(' · ')
        : err.message || 'Something went wrong. Please try again.'
      setError(messages)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectPackage(pkg) {
    if (!registrationId || packageLoading) return
    setPackageError(null)
    setPackageLoading(pkg)
    try {
      const result = await selectPackage(registrationId, pkg)
      window.location.href = result.paymentLink
    } catch (err) {
      setPackageError(err.message || 'Could not start payment. Please try again.')
      setPackageLoading(null)
    }
  }

  // ── Package selection step ─────────────────────────────────────────────────
  if (step === 'packages') {
    return (
      <section className="px-6 py-14 bg-white min-h-screen">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">🎓</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Choose Your Package</h2>
            <p className="text-gray-500 text-sm">
              Select the package that best fits your goals. Basic users can upgrade later.
            </p>
          </div>

          {packageError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-6">
              {packageError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Premium */}
            <div className="border-2 border-brand-500 rounded-2xl p-5 flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 bg-brand-50 px-2 py-0.5 rounded self-start mb-3">
                Premium
              </span>
              <div className="text-3xl font-bold text-gray-900 mb-1">₦60,000</div>
              <ul className="text-sm text-gray-600 space-y-1.5 mb-6 flex-1">
                <li>✓ Full masterclass access</li>
                <li>✓ Skincare system included</li>
                <li>✓ Priority support</li>
              </ul>
              <button
                onClick={() => handleSelectPackage('premium')}
                disabled={!!packageLoading}
                className="btn-primary w-full"
              >
                {packageLoading === 'premium' ? 'Redirecting…' : 'Choose Premium'}
              </button>
            </div>

            {/* Basic */}
            <div className="border-2 border-gray-200 rounded-2xl p-5 flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 px-2 py-0.5 rounded self-start mb-3">
                Basic
              </span>
              <div className="text-3xl font-bold text-gray-900 mb-1">₦50,000</div>
              <ul className="text-sm text-gray-600 space-y-1.5 mb-6 flex-1">
                <li>✓ Full masterclass access</li>
                <li className="text-gray-400">✗ System not included</li>
                <li>✓ Upgrade for ₦50k later</li>
              </ul>
              <button
                onClick={() => handleSelectPackage('basic')}
                disabled={!!packageLoading}
                className="btn-secondary w-full"
              >
                {packageLoading === 'basic' ? 'Redirecting…' : 'Choose Basic'}
              </button>
            </div>
          </div>

        </div>
      </section>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const formContent = (
    <div className="max-w-lg mx-auto">
      {!embedded && (
        <button
          onClick={onBack}
          className="text-sm text-brand-600 hover:underline mb-8 inline-block"
        >
          ← Back
        </button>
      )}

      {!embedded && (
        <>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Join the MICAHSKIN Academy</h2>
          <p className="text-gray-500 text-sm mb-8">
            Register for the masterclass and learn how to build and grow a skincare brand.
          </p>
        </>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="form-label" htmlFor="fullName">Full Name *</label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              className="form-input"
              placeholder="e.g. Amara Osei"
              value={form.fullName}
              onChange={handleChange}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="email">Email Address *</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="form-input"
              placeholder="your@email.com"
              value={form.email}
              onChange={handleChange}
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
            <label className="form-label" htmlFor="businessType">Business / Brand Type</label>
            <input
              id="businessType"
              name="businessType"
              type="text"
              className="form-input"
              placeholder="e.g. Skincare brand, Makeup artist, Reseller…"
              value={form.businessType}
              onChange={handleChange}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="experienceLevel">Experience Level *</label>
            <select
              id="experienceLevel"
              name="experienceLevel"
              required
              className="form-input"
              value={form.experienceLevel}
              onChange={handleChange}
            >
              <option value="">Select your level</option>
              {LEVELS.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="goals">What are your goals? *</label>
            <textarea
              id="goals"
              name="goals"
              required
              rows={4}
              className="form-input resize-none"
              placeholder="What do you want to achieve from this masterclass? What does success look like for you?"
              value={form.goals}
              onChange={handleChange}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="sourcePlatform">Where did you find us? *</label>
            <select
              id="sourcePlatform"
              name="sourcePlatform"
              required
              className="form-input"
              value={form.sourcePlatform}
              onChange={handleChange}
            >
              <option value="">Select a platform</option>
              {PLATFORMS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Registering…' : 'Register for the Academy'}
          </button>
        </form>
      </div>
  )

  if (embedded) return formContent

  return (
    <section className="px-6 py-14 bg-white min-h-screen">
      {formContent}
    </section>
  )
}
