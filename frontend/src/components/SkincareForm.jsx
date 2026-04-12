import { useState, useEffect } from 'react'
import { submitLead } from '../api/index.js'
import PhoneInput, { combinePhone } from './PhoneInput.jsx'

const SKIN_CONCERNS = [
  { value: 'acne', label: 'Acne' },
  { value: 'dark_spots', label: 'Dark Spots' },
  { value: 'stretch_marks', label: 'Stretch Marks' },
  { value: 'dry_skin', label: 'Dry Skin' },
  { value: 'hyperpigmentation', label: 'Hyperpigmentation' },
  { value: 'body_care', label: 'Body Care' },
  { value: 'other', label: 'Other' },
]

const PLATFORMS = ['TikTok', 'Instagram', 'Other']

export default function SkincareForm({ onSuccess, onBack, prefill = {} }) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    countryKey: 'NG',
    localPhone: '',
    // Pre-select platform if visitor arrived via a tagged link (user can still change it)
    sourcePlatform: prefill.sourcePlatform || '',
    skinConcern: '',
    message: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [telegramBotLink, setTelegramBotLink] = useState(null)
  const [showNoTelegramModal, setShowNoTelegramModal] = useState(false)
  const [showWarning, setShowWarning] = useState(false)

  // Show delivery warning after 12 s if the user hasn't tapped Telegram yet
  useEffect(() => {
    if (!submitted || !telegramBotLink) return
    const timer = setTimeout(() => setShowWarning(true), 12_000)
    return () => clearTimeout(timer)
  }, [submitted, telegramBotLink])

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Merge visible form fields with hidden tracking data from URL params
      const result = await submitLead({
        fullName: form.fullName,
        email: form.email,
        phone: combinePhone(form.countryKey, form.localPhone),
        sourcePlatform: form.sourcePlatform,
        skinConcern: form.skinConcern,
        message: form.message,
        sourceType: prefill.sourceType || undefined,
        handle: prefill.handle || undefined,
        campaign: prefill.campaign || undefined,
        intentTag: prefill.intentTag || undefined,
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
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            You're registered — your results are waiting on Telegram
          </h2>
          <p className="text-gray-500 text-sm mb-6">
            We deliver your personalised skincare plan ONLY on Telegram for speed and privacy.
          </p>

          {telegramBotLink ? (
            <>
              <a
                href={telegramBotLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full block mb-4"
              >
                Open Telegram &amp; Get My Results
              </a>

              {showWarning && (
                <p className="text-amber-700 text-sm font-medium bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                  ⚠️ Your consultation will not be delivered unless you connect on Telegram
                </p>
              )}

              <button
                onClick={() => setShowNoTelegramModal(true)}
                className="text-sm text-gray-400 hover:text-gray-600 hover:underline mt-2 block w-full"
              >
                I don't have Telegram
              </button>
            </>
          ) : (
            <button
              onClick={onSuccess}
              className="text-sm text-gray-400 hover:text-gray-600 hover:underline mt-2 block w-full"
            >
              Continue
            </button>
          )}
        </div>

        {/* "No Telegram" download modal */}
        {showNoTelegramModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center shadow-xl">
              <div className="text-4xl mb-3">📱</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Download Telegram</h3>
              <p className="text-gray-500 text-sm mb-5">
                Takes 30 seconds. This is where your results will be sent.
              </p>
              <a
                href="https://play.google.com/store/apps/details?id=org.telegram.messenger"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full block mb-3"
              >
                Download for Android
              </a>
              <a
                href="https://apps.apple.com/app/telegram-messenger/id686449807"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full block mb-4"
              >
                Download for iPhone (iOS)
              </a>
              <button
                onClick={() => setShowNoTelegramModal(false)}
                className="text-sm text-gray-400 hover:text-gray-600 hover:underline"
              >
                Close
              </button>
            </div>
          </div>
        )}
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

        <h2 className="text-2xl font-bold text-gray-900 mb-1">Get Skincare Help</h2>
        <p className="text-gray-500 text-sm mb-8">
          Fill in the details below and we'll get back to you personally.
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
            <label className="form-label" htmlFor="email">Email Address</label>
            <input
              id="email"
              name="email"
              type="email"
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

          <div>
            <label className="form-label" htmlFor="skinConcern">Main Skin Concern *</label>
            <select
              id="skinConcern"
              name="skinConcern"
              required
              className="form-input"
              value={form.skinConcern}
              onChange={handleChange}
            >
              <option value="">Select your concern</option>
              {SKIN_CONCERNS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="message">Tell us more about your skin *</label>
            <textarea
              id="message"
              name="message"
              required
              rows={4}
              className="form-input resize-none"
              placeholder="Describe your skin concerns, how long you've had them, what you've tried..."
              value={form.message}
              onChange={handleChange}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Submitting…' : 'Send My Details'}
          </button>
        </form>
      </div>
    </section>
  )
}
