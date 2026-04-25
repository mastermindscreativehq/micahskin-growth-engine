import { useState, useEffect, useCallback } from 'react'
import {
  matchProductsForLead,
  generateProductQuote,
  fetchQuotesForLead,
  updateQuoteItem,
  reviewQuote,
  sendDiagnosisAndQuote,
} from '../api/index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (typeof n !== 'number' || n === 0) return '₦0'
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

const QUOTE_STATUS_STYLE = {
  pending_review: 'bg-amber-100 text-amber-700',
  approved:       'bg-blue-100 text-blue-700',
  sent:           'bg-green-100 text-green-700',
  cancelled:      'bg-gray-100 text-gray-500',
}

const PAYMENT_STATUS_STYLE = {
  pending:  'bg-gray-100 text-gray-500',
  paid:     'bg-green-100 text-green-700',
  failed:   'bg-red-100 text-red-600',
}

const FULFILLMENT_STATUS_STYLE = {
  pending_fulfillment: 'bg-amber-100 text-amber-700',
  packed:              'bg-blue-100 text-blue-700',
  delivered:           'bg-green-100 text-green-700',
  cancelled:           'bg-gray-100 text-gray-500',
}

// ── Match preview ─────────────────────────────────────────────────────────────

function MatchPreview({ match }) {
  if (!match) return null

  const all    = [...(match.morning || []), ...(match.night || []), ...(match.addons || [])]
  const unique = [...new Map(all.map(p => [p.id, p])).values()]

  if (unique.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        No products matched — add products to the catalog first, then re-open this panel.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wide">
        {unique.length} product{unique.length !== 1 ? 's' : ''} matched
        {match.concern && (
          <span className="ml-1.5 normal-case font-normal text-gray-400">
            for {match.concern.replace(/_/g, ' ')}
          </span>
        )}
        {match.priceBand && (
          <span className="ml-1.5 normal-case font-normal text-gray-400 capitalize">
            · {match.priceBand}
          </span>
        )}
      </p>

      {match.morning?.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Morning</p>
          {match.morning.map(p => <ProductRow key={p.id} p={p} />)}
        </div>
      )}
      {match.night?.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5 mt-1">Night</p>
          {match.night.map(p => <ProductRow key={p.id} p={p} />)}
        </div>
      )}
      {match.addons?.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5 mt-1">Add-ons</p>
          {match.addons.map(p => <ProductRow key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}

function ProductRow({ p }) {
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <span className="rounded bg-teal-50 border border-teal-100 px-1.5 py-0.5 text-[10px] text-teal-700 capitalize shrink-0">
        {p.category}
      </span>
      <span className="font-medium text-gray-800 flex-1 min-w-0 truncate">{p.productName}</span>
      <span className="text-gray-400 shrink-0">{p.brand}</span>
      {p.price != null && p.price > 0 && (
        <span className="text-gray-600 font-medium shrink-0">{fmt(p.price)}</span>
      )}
      {(!p.price || p.price === 0) && (
        <span className="text-amber-500 text-[10px] shrink-0">no price set</span>
      )}
    </div>
  )
}

// ── Editable quote item row ───────────────────────────────────────────────────

function QuoteItemRow({ quoteId, item, onSaved, readOnly }) {
  const [editing,        setEditing]        = useState(false)
  const [price,          setPrice]          = useState('')
  const [qty,            setQty]            = useState(item.quantity)
  const [saving,         setSaving]         = useState(false)
  const [localErr,       setLocalErr]       = useState(null)
  const [catalogUpdated, setCatalogUpdated] = useState(false)

  const effectivePrice = item.editedPrice != null ? item.editedPrice : item.unitPrice
  const subtotal = effectivePrice * item.quantity

  function startEdit() {
    setPrice(String(item.editedPrice != null ? item.editedPrice : item.unitPrice))
    setQty(item.quantity)
    setEditing(true)
    setCatalogUpdated(false)
  }

  async function handleSave() {
    setLocalErr(null)
    const p = Number(price)
    const q = Number(qty)
    if (isNaN(p) || p < 0) { setLocalErr('Invalid price'); return }
    if (isNaN(q) || q < 1) { setLocalErr('Invalid qty');   return }
    setSaving(true)
    try {
      const res = await updateQuoteItem(quoteId, item.id, { editedPrice: p, quantity: q })
      setEditing(false)
      if (item.productId) {
        setCatalogUpdated(true)
        setTimeout(() => setCatalogUpdated(false), 5000)
      }
      onSaved()
    } catch (err) {
      setLocalErr(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/40">
      <td className="py-1.5 pr-3 text-xs font-medium text-gray-800 max-w-[160px]">
        <span className="line-clamp-2">{item.productName}</span>
        {item.notes && <span className="block text-[10px] text-gray-400 truncate">{item.notes}</span>}
      </td>
      <td className="py-1.5 pr-3 text-[10px] text-gray-500 capitalize whitespace-nowrap">{item.routineStep || '—'}</td>
      <td className="py-1.5 pr-3 text-xs text-gray-400 text-right whitespace-nowrap">{fmt(item.unitPrice)}</td>
      <td className="py-1.5 pr-3 text-right">
        {editing ? (
          <input
            type="number"
            min="0"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="w-24 rounded border border-teal-200 px-1.5 py-0.5 text-xs text-right outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100"
            autoFocus
          />
        ) : (
          <span className={`text-xs block text-right ${item.editedPrice != null ? 'font-semibold text-teal-700' : 'text-gray-600'}`}>
            {fmt(effectivePrice)}
            {item.editedPrice != null && item.editedPrice !== item.unitPrice && (
              <span className="text-[10px] text-teal-500 ml-0.5">✎</span>
            )}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-center">
        {editing ? (
          <input
            type="number"
            min="1"
            value={qty}
            onChange={e => setQty(e.target.value)}
            className="w-12 rounded border border-teal-200 px-1 py-0.5 text-xs text-center outline-none focus:border-teal-400"
          />
        ) : (
          <span className="text-xs text-gray-600">{item.quantity}</span>
        )}
      </td>
      <td className="py-1.5 pr-1 text-xs font-semibold text-gray-800 text-right whitespace-nowrap">{fmt(subtotal)}</td>
      <td className="py-1.5 pl-2 whitespace-nowrap">
        {!readOnly && (
          editing ? (
            <div className="flex flex-col gap-0.5">
              <div className="flex gap-1">
                <button
                  disabled={saving}
                  onClick={handleSave}
                  className="rounded border border-green-200 px-2 py-0.5 text-[10px] text-green-700 hover:bg-green-50 disabled:opacity-50"
                >
                  {saving ? '…' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditing(false); setLocalErr(null) }}
                  className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50"
                >
                  ×
                </button>
              </div>
              {localErr && <span className="text-[10px] text-red-500">{localErr}</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 items-end">
              <button
                onClick={startEdit}
                className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50"
              >
                Edit
              </button>
              {catalogUpdated && (
                <span className="text-[10px] text-teal-600 font-medium whitespace-nowrap">Catalog price updated</span>
              )}
            </div>
          )
        )}
      </td>
    </tr>
  )
}

// ── Quote card ────────────────────────────────────────────────────────────────

function QuoteCard({ quote, onRefresh, leadId, lead }) {
  const [actioning, setActioning]   = useState(null)
  const [toast,     setToast]       = useState(null)
  const [sending,   setSending]     = useState(false)

  function showToast(msg, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4500)
  }

  async function handleReview(action) {
    setActioning(action)
    try {
      await reviewQuote(quote.id, action)
      showToast(action === 'send' ? 'Quote marked as sent' : 'Quote approved — ready to send')
      onRefresh()
    } catch (err) {
      showToast(err?.message || 'Action failed', false)
    } finally {
      setActioning(null)
    }
  }

  async function handleSendDiagnosisAndQuote() {
    if (!window.confirm(
      `Send the full Diagnosis + Quote to ${lead?.fullName || 'this lead'} via Telegram?\n\n` +
      `Total: ₦${quote.totalAmount?.toLocaleString('en-NG') || 0}\n\n` +
      `This will also generate a Paystack payment link if the lead has an email.`
    )) return

    setSending(true)
    try {
      const result = await sendDiagnosisAndQuote(leadId, quote.id)
      const linkNote = result.data?.paymentLink ? ' · Payment link included' : ' · WhatsApp link used'
      showToast(`Sent! Total ₦${result.data?.totalAmount?.toLocaleString('en-NG') || 0}${linkNote}`)
      onRefresh()
    } catch (err) {
      showToast(err?.message || 'Send failed', false)
    } finally {
      setSending(false)
    }
  }

  const readOnly = quote.status === 'sent' || quote.status === 'cancelled'
  const statusStyle = QUOTE_STATUS_STYLE[quote.status] || 'bg-gray-100 text-gray-500'

  // Recompute displayed total from items (reflects in-browser edits before save)
  const computedTotal = quote.items?.reduce((sum, i) => {
    const p = i.editedPrice != null ? i.editedPrice : i.unitPrice
    return sum + p * i.quantity
  }, 0) ?? quote.totalAmount

  return (
    <div className="rounded-lg border border-teal-100 bg-white px-3 py-2.5 space-y-2 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${statusStyle}`}>
          {quote.status.replace(/_/g, ' ')}
        </span>
        {quote.paymentStatus && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${PAYMENT_STATUS_STYLE[quote.paymentStatus] || 'bg-gray-100 text-gray-500'}`}>
            payment: {quote.paymentStatus}
          </span>
        )}
        {quote.fulfillmentStatus && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${FULFILLMENT_STATUS_STYLE[quote.fulfillmentStatus] || 'bg-gray-100 text-gray-500'}`}>
            {quote.fulfillmentStatus.replace(/_/g, ' ')}
          </span>
        )}
        <span className="text-gray-400 text-[10px]">created {fmtDate(quote.createdAt)}</span>
        {quote.paidAt && (
          <span className="text-green-600 text-[10px] font-semibold">paid {fmtDate(quote.paidAt)}</span>
        )}
        {quote.sentAt && !quote.paidAt && (
          <span className="text-green-600 text-[10px] font-medium">sent {fmtDate(quote.sentAt)}</span>
        )}
        {quote.paymentReference && (
          <span className="text-gray-400 text-[10px] font-mono">ref: {quote.paymentReference.slice(-10)}</span>
        )}
        {quote.reviewedBy && (
          <span className="text-gray-400 text-[10px]">· reviewed by {quote.reviewedBy}</span>
        )}
        {toast && (
          <span className={`ml-auto text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-500'}`}>
            {toast.msg}
          </span>
        )}
      </div>

      {/* Items table */}
      {quote.items && quote.items.length > 0 ? (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[480px]">
            <thead>
              <tr className="text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="pb-1 pr-3 text-left">Product</th>
                <th className="pb-1 pr-3 text-left">Step</th>
                <th className="pb-1 pr-3 text-right">List</th>
                <th className="pb-1 pr-3 text-right">Price</th>
                <th className="pb-1 pr-3 text-center">Qty</th>
                <th className="pb-1 pr-1 text-right">Subtotal</th>
                <th className="pb-1 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map(item => (
                <QuoteItemRow
                  key={item.id}
                  quoteId={quote.id}
                  item={item}
                  onSaved={onRefresh}
                  readOnly={readOnly}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">No items in this quote.</p>
      )}

      {/* Total + action row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-2">
        <div className="text-sm font-bold text-gray-800">
          Total: <span className="text-teal-700">{fmt(computedTotal)}</span>
          {computedTotal !== quote.totalAmount && (
            <span className="ml-1.5 text-[10px] text-amber-500 font-normal">(unsaved edits)</span>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {quote.status === 'pending_review' && (
              <button
                disabled={!!actioning || sending}
                onClick={() => handleReview('approve')}
                className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {actioning === 'approve' ? '…' : 'Approve Quote'}
              </button>
            )}

            {/* Send Diagnosis + Quote — primary CTA */}
            {(quote.status === 'pending_review' || quote.status === 'approved') && (
              <button
                disabled={!!actioning || sending}
                onClick={handleSendDiagnosisAndQuote}
                className="rounded border border-teal-300 bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending…' : 'Send Diagnosis + Quote'}
              </button>
            )}
          </div>
        )}

        {readOnly && quote.status === 'sent' && (
          <span className="text-xs text-green-600 font-medium">Sent to lead via Telegram</span>
        )}
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

/**
 * Per-lead Product Intelligence Panel.
 * Renders inside the expanded lead row in the Leads CRM tab.
 * Collapsible. Shows matched products, quote builder, and send button.
 */
export default function ProductQuotePanel({ lead }) {
  const [open,    setOpen]    = useState(false)
  const [match,   setMatch]   = useState(null)
  const [quotes,  setQuotes]  = useState([])
  const [loading, setLoading] = useState(false)
  const [genning, setGenning] = useState(false)
  const [error,   setError]   = useState(null)
  const [toast,   setToast]   = useState(null)

  function showToast(msg, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [matchRes, quotesRes] = await Promise.all([
        matchProductsForLead(lead.id).catch(() => null),
        fetchQuotesForLead(lead.id).catch(() => ({ data: [] })),
      ])
      setMatch(matchRes?.data || null)
      setQuotes(quotesRes?.data || [])
    } catch (err) {
      setError(err?.message || 'Failed to load product data')
    } finally {
      setLoading(false)
    }
  }, [lead.id])

  useEffect(() => {
    if (open) loadData()
  }, [open, loadData])

  async function handleGenerateQuote() {
    setGenning(true)
    setError(null)
    try {
      await generateProductQuote(lead.id)
      showToast('Quote generated — review prices below')
      await loadData()
    } catch (err) {
      showToast(err?.message || 'Failed to generate quote', false)
    } finally {
      setGenning(false)
    }
  }

  const activeQuotes    = quotes.filter(q => q.status !== 'cancelled')
  const hasSentQuote    = quotes.some(q => q.status === 'sent')
  const totalMatched    = match ? (match.morning?.length || 0) + (match.night?.length || 0) + (match.addons?.length || 0) : 0
  const canGenerate     = totalMatched > 0 && !genning

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/10">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-teal-700 uppercase tracking-wide">
            Product Intelligence
          </span>
          {activeQuotes.length > 0 && (
            <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
              {activeQuotes.length} quote{activeQuotes.length !== 1 ? 's' : ''}
            </span>
          )}
          {hasSentQuote && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              sent
            </span>
          )}
          {lead.primaryConcern && (
            <span className="text-[10px] text-gray-400 capitalize">
              {lead.primaryConcern.replace(/_/g, ' ')}
              {lead.telegramBudget && ` · ${lead.telegramBudget}`}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="border-t border-teal-100 px-3 py-2.5 space-y-4"
          onClick={e => e.stopPropagation()}
        >
          {loading && (
            <p className="text-xs text-gray-400 py-2">Loading product data…</p>
          )}
          {error && (
            <div className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
              {error}
              <button onClick={loadData} className="ml-2 underline hover:no-underline">Retry</button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Matched products section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">
                    Matched Products
                  </p>
                  <button
                    onClick={loadData}
                    className="text-[10px] text-gray-400 hover:text-gray-600 underline"
                  >
                    Refresh
                  </button>
                </div>
                <MatchPreview match={match} />
              </div>

              {/* Generate quote CTA */}
              <div className="flex flex-wrap items-center gap-3 border-t border-teal-100 pt-2">
                <button
                  disabled={!canGenerate}
                  onClick={handleGenerateQuote}
                  className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {genning ? 'Generating…' : 'Generate Quote from Matched Products'}
                </button>
                {!canGenerate && !genning && (
                  <span className="text-[10px] text-gray-400">
                    {totalMatched === 0 ? 'No matches — add products to the catalog first' : ''}
                  </span>
                )}
                {toast && (
                  <span className={`text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-500'}`}>
                    {toast.msg}
                  </span>
                )}
              </div>

              {/* Quotes */}
              {quotes.length > 0 && (
                <div className="space-y-3 border-t border-teal-100 pt-2">
                  <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">
                    Quotes ({quotes.length})
                  </p>
                  {quotes.map(q => (
                    <QuoteCard
                      key={q.id}
                      quote={q}
                      lead={lead}
                      leadId={lead.id}
                      onRefresh={loadData}
                    />
                  ))}
                </div>
              )}

              {quotes.length === 0 && totalMatched > 0 && (
                <p className="text-[10px] text-gray-400 italic">
                  No quotes yet — click "Generate Quote" to create one.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
