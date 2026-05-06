// LeadTimelinePanel.jsx — Phase 34 (MCE)
// Per-lead append-only timeline. Embed this inside the lead detail drawer
// or use the standalone /mce/timeline/:leadId for debugging.

import { useEffect, useState } from 'react'
import { fetchLeadTimeline } from '../../api/index.js'

const EVENT_LABELS = {
  route_assigned: { label: 'Route assigned',  color: 'bg-emerald-100 text-emerald-700', icon: '↻' },
  whatsapp_click: { label: 'WhatsApp click',  color: 'bg-green-100 text-green-700',     icon: '💬' },
  reply_received: { label: 'Reply received',  color: 'bg-sky-100 text-sky-700',         icon: '↩' },
  objection:      { label: 'Objection',       color: 'bg-rose-100 text-rose-700',       icon: '⚠' },
  offer_viewed:   { label: 'Offer viewed',    color: 'bg-indigo-100 text-indigo-700',   icon: '👁' },
  followup_sent:  { label: 'Follow-up sent',  color: 'bg-amber-100 text-amber-700',     icon: '📤' },
  conversion:    { label: 'Conversion',       color: 'bg-violet-100 text-violet-700',   icon: '✓' },
}

function fmtDT(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function PayloadPreview({ payload }) {
  if (!payload || typeof payload !== 'object') return null
  const entries = Object.entries(payload).slice(0, 6)
  if (entries.length === 0) return null
  return (
    <div className="mt-1 space-y-0.5 text-[10px] text-gray-500">
      {entries.map(([k, v]) => (
        <div key={k} className="truncate">
          <span className="font-mono text-gray-400">{k}</span>:{' '}
          <span className="text-gray-600">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  )
}

export default function LeadTimelinePanel({ leadId }) {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchLeadTimeline(leadId)
      .then(res => { if (!cancelled) setEvents(res.data || []) })
      .catch(e   => { if (!cancelled) setError(e?.message || 'Failed to load timeline') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [leadId])

  if (!leadId) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 border-b pb-2 mb-4 border-violet-200 text-violet-700">
        <h2 className="text-xs font-bold uppercase tracking-wider">
          Lead Timeline
        </h2>
        <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{events.length} events</span>
      </div>

      {loading && <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>}
      {error   && <p className="text-xs text-red-500 py-4 text-center">{error}</p>}

      {!loading && !error && events.length === 0 && (
        <p className="text-xs text-gray-400 py-4 text-center">No timeline events yet.</p>
      )}

      {!loading && !error && events.length > 0 && (
        <ol className="space-y-2 max-h-[480px] overflow-y-auto">
          {events.map(ev => {
            const meta = EVENT_LABELS[ev.eventType] || { label: ev.eventType, color: 'bg-gray-100 text-gray-700', icon: '•' }
            return (
              <li key={ev.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
                    <span className="mr-1">{meta.icon}</span>{meta.label}
                  </span>
                  {ev.funnelType && (
                    <span className="rounded bg-white border border-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 capitalize">
                      {ev.funnelType}
                    </span>
                  )}
                  {ev.channel && (
                    <span className="rounded bg-white border border-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 capitalize">
                      {ev.channel}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{fmtDT(ev.createdAt)}</span>
                </div>
                <PayloadPreview payload={ev.payload} />
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
