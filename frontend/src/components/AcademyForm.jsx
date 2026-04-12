import { useState } from 'react'
import { submitAcademyRegistration } from '../api/index.js'
import PhoneInput, { combinePhone } from './PhoneInput.jsx'

const PLATFORMS = ['TikTok', 'Instagram', 'Other']
const LEVELS = [
  { value: 'beginner', label: 'Beginner — Just starting out' },
  { value: 'intermediate', label: 'Intermediate — Have some experience' },
  { value: 'advanced', label: 'Advanced — Growing an existing brand' },
]

export default function AcademyForm({ onSuccess, onBack, prefill = {} }) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    countryKey: 'NG',
    localPhone: '',
    businessType: '',
    experienceLevel: '',
    goals: '',
    // Pre-select platform if visitor arrived via a tagged link (user can still change it)
    sourcePlatform: prefill.sourcePlatform || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [telegramBotLink, setTelegramBotLink] = useState(null)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Merge visible form fields with hidden tracking data from URL params
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
      setTelegramBotLink(result.data?.telegramBotLink || null)
      setSubmitted(true)
    } catch (err) {
      const messages = err.errors?.length
        ? err.errors.join(' · ')
        : err.message || 'Something went wrong. Please try again.'
      setError(messages)
    } finally {
      setLoading(false)
    }
  }

  // ── Telegram success state ──────────────────────────────────────────────────
  if (submitted) {
    return (
      <section className="px-6 py-14 bg-white min-h-screen">
        <div className="max-w-lg mx-auto text-center">
          <div className="text-5xl mb-4">🎓</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">You're registered!</h2>
          <p className="text-gray-500 text-sm mb-2">
            Your academy registration is confirmed. We'll be in touch with next steps.
          </p>
          {telegramBotLink && (
            <>
              <p className="text-gray-700 text-sm font-medium mb-6 mt-4 leading-relaxed">
                To receive your academy updates on Telegram,<br />
                tap the button below and click <strong>Start</strong> in the Telegram app.
              </p>
              <a
                href={telegramBotLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full block mb-4"
              >
                Continue on Telegram
              </a>
            </>
          )}
          <button
            onClick={onSuccess}
            className="text-sm text-gray-400 hover:text-gray-600 hover:underline mt-2 block w-full"
          >
            Continue without Telegram
          </button>
        </div>
      </section>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <section className="px-6 py-14 bg-white min-h-screen">
      <div className="max-w-lg mx-auto">
        <button
          onClick={onBack}
          className="text-sm text-brand-600 hover:underline mb-8 inline-block"
        >
          ← Back
        </button>

        <h2 className="text-2xl font-bold text-gray-900 mb-1">Join the MICAHSKIN Academy</h2>
        <p className="text-gray-500 text-sm mb-8">
          Register for the masterclass and learn how to build and grow a skincare brand.
        </p>

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
    </section>
  )
}
