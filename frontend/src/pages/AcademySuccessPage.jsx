import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAcademyAccess } from '../api/index.js'

export default function AcademySuccessPage() {
  const navigate = useNavigate()
  // 'loading' | 'paid' | 'unpaid' | 'error'
  const [status, setStatus] = useState('loading')
  const [telegramBotLink, setTelegramBotLink] = useState(null)
  const [fullName, setFullName] = useState(null)
  const [showNoTelegramModal, setShowNoTelegramModal] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const registrationId = params.get('registrationId')
    if (!registrationId) {
      setStatus('error')
      return
    }
    fetchAcademyAccess(registrationId)
      .then((data) => {
        if (data.paid) {
          setTelegramBotLink(data.telegramBotLink || null)
          setFullName(data.fullName || null)
          setStatus('paid')
        } else {
          setStatus('unpaid')
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Verifying payment…</p>
      </div>
    )
  }

  // ── Payment not confirmed yet ────────────────────────────────────────────────
  if (status === 'unpaid') {
    return (
      <div className="min-h-screen bg-cream-50 px-6 py-20 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⏳</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Payment Not Confirmed Yet</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            Your payment hasn't been confirmed. If you completed the transaction, it may take a
            few seconds to process. Refresh this page shortly or contact us if the issue persists.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary mb-4"
          >
            Refresh
          </button>
          <div>
            <a
              href="mailto:mastermindscreativehq@gmail.com"
              className="text-sm text-brand-600 hover:underline"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Error / missing registration ID ─────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-cream-50 px-6 py-20 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Something Went Wrong</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            We couldn't verify your access. Contact us and we'll sort it out right away.
          </p>
          <a
            href="mailto:mastermindscreativehq@gmail.com"
            className="btn-primary inline-block"
          >
            Contact Support
          </a>
        </div>
      </div>
    )
  }

  // ── Paid — reveal Telegram access ────────────────────────────────────────────
  const firstName = fullName ? fullName.split(' ')[0] : null

  return (
    <div className="min-h-screen bg-cream-50 px-6 py-20">
      <div className="max-w-md mx-auto text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Payment Confirmed
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Welcome to MICAHSKIN Academy{firstName ? `, ${firstName}` : ''}!
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          Your spot is secured. Tap the button below to join the academy on Telegram and get immediate access to your content.
        </p>

        {telegramBotLink ? (
          <a
            href={telegramBotLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-base px-10 py-4 inline-block"
          >
            Join Academy on Telegram →
          </a>
        ) : (
          <p className="text-sm text-gray-400">
            Your Telegram access link is being prepared. Please contact us if it does not appear shortly.
          </p>
        )}

        <div className="mt-5">
          <button
            onClick={() => setShowNoTelegramModal(true)}
            className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
          >
            I don't have Telegram
          </button>
        </div>

        <div className="mt-8 text-xs text-gray-400">
          <button onClick={() => navigate('/')} className="hover:underline">
            Back to home
          </button>
        </div>
      </div>

      {showNoTelegramModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center shadow-xl">
            <div className="text-4xl mb-3">📱</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Download Telegram First</h3>
            <p className="text-gray-500 text-sm mb-5">
              Takes 30 seconds. Your academy content will be delivered through Telegram.
              Once installed, close this and tap the button above.
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
    </div>
  )
}
