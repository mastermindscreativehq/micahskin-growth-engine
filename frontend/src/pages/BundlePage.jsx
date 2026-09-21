import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchPublicBundle, trackFunnelEvent } from '../api/index.js'

export default function BundlePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('loading') // loading | ready | notfound | error
  const [bundle, setBundle] = useState(null)
  const viewedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchPublicBundle(slug)
      .then(res => {
        if (cancelled) return
        setBundle(res.data)
        setStatus('ready')
      })
      .catch(err => {
        if (cancelled) return
        setStatus(err?.status === 404 || err?.message === 'Bundle not found' ? 'notfound' : 'error')
      })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (status === 'ready' && bundle && !viewedRef.current) {
      viewedRef.current = true
      trackFunnelEvent('bundle_viewed', { bundleId: bundle.id })
      document.title = `${bundle.seoTitle || bundle.title} — MICAHSKIN`
    }
  }, [status, bundle])

  function handleProductClick(item) {
    trackFunnelEvent('bundle_product_clicked', { bundleId: bundle.id, metadata: { productId: item.productId } })
    if (item.product?.purchaseUrl) {
      window.open(item.product.purchaseUrl, '_blank', 'noopener,noreferrer')
    }
  }

  // Reuses the existing home-page intake form as the contact mechanism — no new
  // checkout/contact system. campaign tags the resulting Lead so admin can see
  // it came from this bundle (Lead.campaign already exists for this purpose).
  function goToContact(eventType) {
    trackFunnelEvent(eventType, { bundleId: bundle.id })
    navigate(`/?campaign=${encodeURIComponent(`bundle:${bundle.slug}`)}`)
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (status === 'notfound') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">🔍</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Routine Not Found</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            This routine may have been unpublished or the link may be incorrect.
          </p>
          <button onClick={() => navigate('/')} className="btn-primary">Back to Home</button>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-5">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Something Went Wrong</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">Please try again shortly.</p>
        </div>
      </div>
    )
  }

  const items = bundle.items || []
  const hasSavings = bundle.compareAtPrice && bundle.compareAtPrice > bundle.price
  const savings = hasSavings ? bundle.compareAtPrice - bundle.price : 0

  return (
    <div className="min-h-screen bg-cream-50">
      {bundle.heroImageUrl && (
        <div className="w-full aspect-[16/9] sm:aspect-[21/9] overflow-hidden bg-gray-100">
          <img src={bundle.heroImageUrl} alt={bundle.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-12">
        {bundle.concern && (
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
            For: {bundle.concern.replace(/_/g, ' ')}
            {bundle.skinTypes?.length > 0 && ` · ${bundle.skinTypes.join(', ')} skin`}
          </p>
        )}

        <h1 className="text-3xl font-bold text-gray-900 mb-4">{bundle.title}</h1>

        {bundle.description && (
          <p className="text-gray-600 leading-relaxed mb-8">{bundle.description}</p>
        )}

        <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Inside the routine</h2>
        <div className="space-y-3 mb-8">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => handleProductClick(item)}
              className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-left hover:border-brand-200 transition-colors"
            >
              <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center">{i + 1}</span>
              {item.product?.imageUrl
                ? <img src={item.product.imageUrl} alt={item.product.productName} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                : <span className="w-14 h-14 rounded-lg bg-gray-100 shrink-0" />}
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-gray-900 text-sm truncate">{item.product?.productName}</span>
                <span className="block text-xs text-gray-400">{item.product?.brand}</span>
                {item.product?.description && (
                  <span className="block text-xs text-gray-400 mt-0.5 line-clamp-2">{item.product.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center mb-6">
          {hasSavings && (
            <p className="text-sm text-gray-400 line-through mb-1">₦{bundle.compareAtPrice.toLocaleString('en-NG')}</p>
          )}
          <p className="text-3xl font-bold text-gray-900 mb-1">₦{bundle.price.toLocaleString('en-NG')}</p>
          {hasSavings && (
            <p className="text-xs font-semibold text-green-600 mb-4">Save ₦{savings.toLocaleString('en-NG')}</p>
          )}

          <button onClick={() => goToContact('bundle_contact_clicked')} className="btn-primary w-full mb-3">
            {bundle.ctaText || 'Get This Routine'}
          </button>
          <button onClick={() => goToContact('bundle_contact_clicked')} className="btn-secondary w-full">
            {bundle.contactCtaText || 'Talk to Us'}
          </button>
        </div>

        <div className="bg-brand-50 rounded-2xl p-6 text-center">
          <p className="text-sm font-semibold text-gray-800 mb-1">Not sure which routine is right for you?</p>
          <p className="text-xs text-gray-500 mb-4">Get your personalized skin assessment and let us guide you.</p>
          <button onClick={() => goToContact('bundle_assessment_clicked')} className="btn-secondary w-full">
            Get My Personalized Skin Assessment
          </button>
        </div>
      </div>
    </div>
  )
}
