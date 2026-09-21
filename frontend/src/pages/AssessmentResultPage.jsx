import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAssessmentResult, trackFunnelEvent } from '../api/index.js'

const POLL_MS = 1500
const MAX_POLLS = 30 // ~45s — the diagnosis engine is fast/synchronous, this is generous

export default function AssessmentResultPage() {
  const navigate = useNavigate()
  // checking | waiting | processing | ready | failed | error
  const [status, setStatus] = useState('checking')
  const [data, setData] = useState(null)
  const viewedRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) {
      setStatus('error')
      return
    }

    let cancelled = false
    let attempts = 0

    async function poll() {
      attempts += 1
      try {
        const res = await fetchAssessmentResult(token)
        if (cancelled) return
        const d = res.data
        setData(d)

        if (d.status === 'results_ready') {
          setStatus('ready')
          if (!viewedRef.current) {
            viewedRef.current = true
            trackFunnelEvent('assessment_viewed', { leadId: d.leadId })
            trackFunnelEvent('recommendation_viewed', { leadId: d.leadId })
          }
          return
        }

        if (d.status === 'payment_failed') {
          setStatus('failed')
          return
        }

        if (['unlocked', 'analysis_processing'].includes(d.status)) {
          setStatus('processing')
        } else {
          setStatus('waiting')
        }

        if (attempts < MAX_POLLS) {
          setTimeout(poll, POLL_MS)
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    poll()
    return () => { cancelled = true }
  }, [])

  // ── Checking / processing ───────────────────────────────────────────────────
  if (status === 'checking' || status === 'processing') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">🧪</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            {status === 'processing' ? 'Payment Received' : 'Verifying Your Payment…'}
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            {status === 'processing'
              ? "We're preparing your personalized skin assessment. This only takes a moment…"
              : 'Please wait while we confirm your payment.'}
          </p>
        </div>
      </div>
    )
  }

  // ── Still not confirmed after polling window ────────────────────────────────
  if (status === 'waiting') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⏳</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Still Confirming Payment</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            If you completed the payment, it may take a little longer to confirm. Refresh this page shortly,
            or contact us if this continues.
          </p>
          <button onClick={() => window.location.reload()} className="btn-primary mb-4">Refresh</button>
          <div>
            <a href="mailto:mastermindscreativehq@gmail.com" className="text-sm text-brand-600 hover:underline">
              Contact support
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Payment failed / abandoned ───────────────────────────────────────────────
  if (status === 'failed') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Payment Wasn't Completed</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            Your completed answers are saved — you can try the payment again whenever you're ready.
          </p>
          <button onClick={() => navigate('/assessment')} className="btn-primary">
            Try Payment Again
          </button>
        </div>
      </div>
    )
  }

  // ── Error / missing token ────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Something Went Wrong</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            We couldn't find this assessment. Contact us and we'll sort it out right away.
          </p>
          <a href="mailto:mastermindscreativehq@gmail.com" className="btn-primary inline-block">
            Contact Support
          </a>
        </div>
      </div>
    )
  }

  // ── Ready — show results ─────────────────────────────────────────────────────
  const firstName = data?.fullName ? data.fullName.split(' ')[0] : null
  const routine = data?.routine || {}
  const morning = Array.isArray(routine.morning) ? routine.morning : []
  const night = Array.isArray(routine.night) ? routine.night : []
  const rec = data?.productRecommendation || {}
  const hasRec = rec.cleanser || rec.treatment || rec.moisturizer || rec.sunscreen

  return (
    <div className="min-h-screen bg-cream-50 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">Payment Confirmed</p>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Your Personalized Skin Assessment{firstName ? `, ${firstName}` : ''}
          </h1>
          {data?.diagnosisSummary && (
            <p className="text-gray-500 text-sm leading-relaxed max-w-lg mx-auto">
              {data.diagnosisSummary}
            </p>
          )}
        </div>

        {(morning.length > 0 || night.length > 0) && (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Your Personalized Routine</h2>
            {morning.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">☀️ Morning</p>
                <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                  {morning.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
              </div>
            )}
            {night.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">🌙 Night</p>
                <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                  {night.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
              </div>
            )}
          </div>
        )}

        {hasRec && (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Personalized Recommendations</h2>
            <ul className="text-sm text-gray-600 space-y-2">
              {rec.cleanser && <li><span className="font-semibold text-gray-800">Cleanser:</span> {rec.cleanser}</li>}
              {rec.treatment && <li><span className="font-semibold text-gray-800">Treatment:</span> {rec.treatment}</li>}
              {rec.moisturizer && <li><span className="font-semibold text-gray-800">Moisturizer:</span> {rec.moisturizer}</li>}
              {rec.sunscreen && <li><span className="font-semibold text-gray-800">Sunscreen:</span> {rec.sunscreen}</li>}
            </ul>
            {Array.isArray(rec.notes) && rec.notes.length > 0 && (
              <ul className="text-xs text-gray-400 mt-4 space-y-1">
                {rec.notes.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 text-center leading-relaxed mb-8">
          This is a personalized skincare guide based on the information you provided — it is not a medical
          diagnosis. Always consult a qualified healthcare professional for medical concerns.
        </p>

        <div className="text-center">
          <button onClick={() => navigate('/contact')} className="btn-primary inline-block">
            Questions? Contact Us
          </button>
        </div>
      </div>
    </div>
  )
}
