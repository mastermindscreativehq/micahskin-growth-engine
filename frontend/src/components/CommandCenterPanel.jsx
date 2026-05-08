import { useState, useEffect, useCallback } from 'react'
import { fetchCommandCenter, pauseFollowUps, resumeFollowUps, triggerAcquisitionRun } from '../api/index.js'
import FunnelConversionPanel from './mce/FunnelConversionPanel.jsx'
import WhatsAppClickPanel    from './mce/WhatsAppClickPanel.jsx'
import TopObjectionsPanel    from './mce/TopObjectionsPanel.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount) {
  if (!amount || amount === 0) return '₦0'
  return `₦${Number(amount).toLocaleString('en-NG')}`
}

function fmtDT(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function badgeClass(n, warn, crit) {
  if (n === 0)    return 'bg-green-100 text-green-700'
  if (n >= crit)  return 'bg-red-100 text-red-700'
  if (n >= warn)  return 'bg-amber-100 text-amber-700'
  return 'bg-green-100 text-green-700'
}

// ── Atomic display components ─────────────────────────────────────────────────

function SectionBox({ title, color = 'gray', sectionError, children }) {
  const header = {
    gray:   'border-gray-200 text-gray-600',
    teal:   'border-teal-200 text-teal-700',
    red:    'border-red-200 text-red-700',
    amber:  'border-amber-200 text-amber-700',
    violet: 'border-violet-200 text-violet-700',
    indigo: 'border-indigo-200 text-indigo-700',
  }[color] || 'border-gray-200 text-gray-600'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className={`flex items-center gap-2 border-b pb-2 mb-4 ${header}`}>
        <h2 className={`text-xs font-bold uppercase tracking-wider ${header.split(' ')[1]}`}>{title}</h2>
        {sectionError && (
          <span className="ml-auto shrink-0 rounded bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold" title={sectionError}>
            ⚠ partial data
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function RevStat({ label, value, sub, color = 'gray' }) {
  const cls = {
    gray:   'bg-gray-50 border-gray-200 text-gray-700',
    teal:   'bg-teal-50 border-teal-200 text-teal-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  }[color] || 'bg-gray-50 border-gray-200 text-gray-700'

  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`}>
      <div className="text-base font-bold tabular-nums truncate">{value}</div>
      <div className="text-[11px] font-medium mt-0.5 leading-tight">{label}</div>
      {sub && <div className="text-[10px] mt-0.5 opacity-60">{sub}</div>}
    </div>
  )
}

function FulfillStat({ label, value, active = false }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-center ${active ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className={`text-2xl font-bold tabular-nums ${active ? 'text-amber-700' : 'text-gray-600'}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function LeadRow({ lead }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0 text-xs">
      <span className="font-medium text-gray-800 flex-1 truncate min-w-0">{lead.fullName}</span>
      {lead.telegramChatId && (
        <span className="shrink-0 text-[10px] font-semibold text-sky-500">TG</span>
      )}
      {lead.primaryConcern && (
        <span className="shrink-0 rounded bg-indigo-50 text-indigo-600 px-1.5 py-0.5 text-[10px] font-medium capitalize max-w-[80px] truncate">
          {lead.primaryConcern.replace(/_/g, ' ')}
        </span>
      )}
      {lead.currentFlow && (
        <span className="shrink-0 rounded bg-gray-100 text-gray-400 px-1.5 py-0.5 text-[10px] font-mono max-w-[100px] truncate">
          {lead.currentFlow.replace(/_/g, ' ')}
        </span>
      )}
    </div>
  )
}

function ConsultRow({ consult }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0 text-xs">
      <span className="font-medium text-gray-800 flex-1 truncate min-w-0">
        {consult.lead?.fullName || '—'}
      </span>
      {consult.lead?.telegramChatId && (
        <span className="shrink-0 text-[10px] font-semibold text-sky-500">TG</span>
      )}
      <span className="shrink-0 rounded bg-gray-100 text-gray-400 px-1.5 py-0.5 text-[10px] font-mono">
        Stage {consult.currentStage}
      </span>
      {consult.needsHumanReview && (
        <span className="shrink-0 rounded bg-red-100 text-red-600 px-1.5 py-0.5 text-[10px] font-semibold">
          ⚠ Human
        </span>
      )}
      {consult.redFlags?.length > 0 && (
        <span className="shrink-0 rounded bg-orange-100 text-orange-600 px-1.5 py-0.5 text-[10px] font-semibold">
          🚩 {consult.redFlags.length}
        </span>
      )}
    </div>
  )
}

function QuoteRow({ quote }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0 text-xs">
      <span className="font-medium text-gray-800 flex-1 truncate min-w-0">{quote.lead?.fullName || '—'}</span>
      <span className="shrink-0 text-amber-700 font-semibold">{fmt(quote.totalAmount)}</span>
      <span className="shrink-0 text-gray-400 text-[10px]">{fmtDT(quote.createdAt)}</span>
    </div>
  )
}

// ── QueueCard: collapsible card for lead/consult lists ────────────────────────

function QueueCard({ label, count, warn = 1, crit = 5, color = 'gray', children }) {
  const [open, setOpen] = useState(false)

  const border = {
    gray:   'border-gray-200 bg-gray-50',
    red:    'border-red-100 bg-red-50',
    amber:  'border-amber-100 bg-amber-50',
    teal:   'border-teal-100 bg-teal-50',
    violet: 'border-violet-100 bg-violet-50',
    indigo: 'border-indigo-100 bg-indigo-50',
  }[color] || 'border-gray-200 bg-gray-50'

  const cnt = typeof count === 'number' ? count : 0

  return (
    <div className={`rounded-lg border overflow-hidden ${border}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass(cnt, warn, crit)}`}>
            {cnt}
          </span>
          <span className="text-gray-300 text-[10px]">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3 py-2 bg-white max-h-52 overflow-y-auto">
          {cnt === 0 ? (
            <p className="text-xs text-gray-400 py-1 text-center">None</p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}

// ── AlertRow: traffic-light alert rows ───────────────────────────────────────

function AlertRow({ label, count, warn = 1, crit = 5, children }) {
  const [open, setOpen] = useState(false)
  const n = typeof count === 'number' ? count : 0

  const style = n === 0
    ? { dot: 'bg-green-400', badge: 'bg-green-100 text-green-700', row: 'border-green-100 bg-green-50/30' }
    : n >= crit
      ? { dot: 'bg-red-400', badge: 'bg-red-100 text-red-700', row: 'border-red-100 bg-red-50/30' }
      : { dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700', row: 'border-amber-100 bg-amber-50/30' }

  const hasDetail = children && n > 0

  return (
    <div className={`rounded-lg border overflow-hidden ${style.row}`}>
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => hasDetail && setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="flex-1 text-xs text-gray-700">{label}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${style.badge}`}>{n}</span>
        {hasDetail && (
          <span className="text-gray-300 text-[10px]">{open ? '▲' : '▼'}</span>
        )}
      </button>
      {open && hasDetail && (
        <div className="border-t border-gray-100 px-3 py-2 bg-white max-h-52 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  )
}

// ── MAIE intelligence sub-components (Phase 33) ───────────────────────────────

function MAIEStatCard({ label, value, color = 'gray', sub }) {
  const cls = {
    gray:    'bg-gray-50 border-gray-200 text-gray-700',
    teal:    'bg-teal-50 border-teal-200 text-teal-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
    violet:  'bg-violet-50 border-violet-200 text-violet-700',
    sky:     'bg-sky-50 border-sky-200 text-sky-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
  }[color] || 'bg-gray-50 border-gray-200 text-gray-700'

  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`}>
      <div className="text-base font-bold tabular-nums truncate">{value}</div>
      <div className="text-[11px] font-medium mt-0.5 leading-tight">{label}</div>
      {sub && <div className="text-[10px] mt-0.5 opacity-60">{sub}</div>}
    </div>
  )
}

function MAIEBreakdownBar({ items, keyField, valueField = 'count', emptyLabel = 'No data yet', barColor = 'bg-teal-400' }) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-gray-400 py-2 text-center">{emptyLabel}</p>
  }
  const max = Math.max(...items.map(i => i[valueField] || 0), 1)
  return (
    <div className="space-y-1.5">
      {items.map((item, idx) => {
        const v = item[valueField] || 0
        const pct = Math.round((v / max) * 100)
        const label = item[keyField] || '—'
        return (
          <div key={`${label}-${idx}`} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-gray-700 capitalize" title={label}>
              {String(label).replace(/_/g, ' ')}
            </span>
            <div className="flex-1 h-1.5 rounded bg-gray-100 overflow-hidden">
              <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-gray-600 text-[11px]">{v}</span>
          </div>
        )
      })}
    </div>
  )
}

function MAIEBreakdownCard({ title, items, keyField, barColor, emptyLabel }) {
  const [open, setOpen] = useState(true)
  const total = (items || []).reduce((s, it) => s + (it.count || 0), 0)
  return (
    <div className="rounded-lg border border-gray-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-gray-50 border-b border-gray-100"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] tabular-nums text-gray-500">{total} total</span>
          <span className="text-gray-300 text-[10px]">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 py-3">
          <MAIEBreakdownBar items={items} keyField={keyField} barColor={barColor} emptyLabel={emptyLabel} />
        </div>
      )}
    </div>
  )
}

// ── Lead Sources section ──────────────────────────────────────────────────────

function LeadSourcesSection({ leadSources, onRefresh }) {
  const [acquiring, setAcquiring] = useState(false)
  const [triggered, setTriggered] = useState(false)
  const [country, setCountry] = useState(
    leadSources?.acquisitionStatus?.selectedCountry || 'NG'
  )

  const trigger = async () => {
    setAcquiring(true)
    try {
      await triggerAcquisitionRun(country)
      setTriggered(true)
      setTimeout(() => setTriggered(false), 6000)
      onRefresh()
    } catch {
      // swallow — stale state, refresh fixes it
    } finally {
      setAcquiring(false)
    }
  }

  // Default to idle — never infer "running" from a lingering pendingRunId alone.
  const status = leadSources?.acquisitionStatus ?? {
    state: 'idle', running: false, pendingRunId: null,
    runStartedAt: null, lastRunAt: null, lastRunFinishedAt: null,
    lastStatus: null, stale: false,
    mode: 'manual', manualMode: true,
    selectedCountry: 'NG', countryLabel: 'Nigeria',
    supportedCountries: [
      { code: 'NG', label: 'Nigeria' }, { code: 'GH', label: 'Ghana' },
      { code: 'KE', label: 'Kenya' },   { code: 'ZA', label: 'South Africa' },
    ],
    maxVideosPerQuery: 3, maxCommentsPerVideo: 10, maxAcceptedLeads: 15,
    injectThreshold: { buyer: 45, pain: 35 },
    nextRunAt: null, itemsThisCycle: 0, acceptedThisCycle: 0,
    acceptanceCapReached: false,
    lastBatch: null, lastVerification: null, recentBatchesBlocked: 0,
  }
  const isRunning = status.running === true || !!status.pendingRunId

  // ── Phase 37 — Manual mode + Africa-first display ────────────────────────
  const supportedCountries = status.supportedCountries?.length
    ? status.supportedCountries
    : [
        { code: 'NG', label: 'Nigeria' }, { code: 'GH', label: 'Ghana' },
        { code: 'KE', label: 'Kenya' },   { code: 'ZA', label: 'South Africa' },
      ]
  const maxVideos        = status.maxVideosPerQuery   ?? 3
  const maxComments      = status.maxCommentsPerVideo ?? 10
  const maxAccepted      = status.maxAcceptedLeads    ?? 15
  const injectBuyer      = status.injectThreshold?.buyer ?? 45
  const injectPain       = status.injectThreshold?.pain  ?? 35
  const itemsThisCycle   = status.itemsThisCycle ?? 0
  const acceptedThisCycle = status.acceptedThisCycle ?? 0
  const recentBlocked    = status.recentBatchesBlocked ?? 0
  const lastBatch        = status.lastBatch
  const lastBatchPhrases = lastBatch?.phrases?.length
    ? lastBatch.phrases
    : (lastBatch?.hashtags || [])
  const lastVerif        = status.lastVerification

  const dotClass = isRunning
    ? 'bg-amber-400 animate-pulse'
    : status.state === 'failed'
      ? 'bg-red-400'
      : status.state === 'completed'
        ? 'bg-emerald-400'
        : 'bg-teal-400'

  const stateLabel = isRunning
    ? 'Scrape in progress…'
    : status.state === 'failed'
      ? `Last run failed${status.lastStatus ? ` (${status.lastStatus})` : ''}`
      : status.state === 'completed'
        ? 'Last run completed'
        : 'Engine idle'

  // ── Phase 36 — Conversion-focused headline ───────────────────────────────
  const oc = leadSources?.outreachCounts || {
    readyToReply: 0, replied: 0, converted: 0, skipped: 0,
    pendingByTemperature: { hot: 0, warm: 0, cold: 0 },
  }
  const stats = [
    { label: 'Ready to reply', value: oc.readyToReply, color: 'amber'   },
    { label: 'Replied',        value: oc.replied,      color: 'teal'    },
    { label: 'Converted',      value: oc.converted,    color: 'violet'  },
    { label: 'Hot pending',    value: oc.pendingByTemperature?.hot ?? 0, color: 'indigo' },
  ]

  return (
    <SectionBox title="Lead Sources — Africa-First Buyer Intent" color="teal">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 transition-colors ${dotClass}`} />
          <span className="text-xs font-semibold text-gray-700">{stateLabel}</span>
          <span className="text-xs text-gray-400 tabular-nums">
            {(leadSources?.totalScraped ?? 0).toLocaleString()} total scraped
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-500 font-semibold">Country:</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={isRunning || acquiring}
            className="rounded-lg border border-gray-200 bg-white text-gray-700 px-2 py-1 text-xs font-semibold disabled:opacity-50"
          >
            {supportedCountries.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={trigger}
            disabled={acquiring || isRunning}
            className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {acquiring ? '…' : '▶ Run Now'}
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500 sm:grid-cols-4">
        <span>Last run: <span className="text-gray-700 tabular-nums">{status.lastRunAt ? fmtDT(status.lastRunAt) : '—'}</span></span>
        <span>Finished: <span className="text-gray-700 tabular-nums">{status.lastRunFinishedAt ? fmtDT(status.lastRunFinishedAt) : '—'}</span></span>
        <span>Last status: <span className="text-gray-700">{status.lastStatus ?? '—'}</span></span>
        <span>Total injected: <span className="text-gray-700 tabular-nums">{(leadSources?.processedTotal ?? 0).toLocaleString()}</span></span>
      </div>

      {/* ── Phase 37 — Manual-mode panel ────────────────────────────────── */}
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="inline-flex items-center rounded-full border border-emerald-300 bg-white text-emerald-700 px-2 py-0.5 text-[11px] font-bold">
            Manual Mode Enabled
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-white text-gray-700 px-2 py-0.5 text-[11px] font-semibold">
            Country: {status.countryLabel || 'Nigeria'}
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-white text-gray-700 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
            ≤ {maxVideos} videos / query
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-white text-gray-700 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
            ≤ {maxComments} comments / video
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-white text-gray-700 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
            Stop after {maxAccepted} accepted
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-white text-gray-700 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
            Inject if buyer ≥ {injectBuyer} OR pain ≥ {injectPain}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-emerald-800/80 sm:grid-cols-4">
          <span>Items this cycle: <span className="text-emerald-900 tabular-nums">{itemsThisCycle}</span></span>
          <span>Accepted this cycle: <span className="text-emerald-900 tabular-nums">{acceptedThisCycle}</span></span>
          <span>24h blocked batches: <span className="text-emerald-900 tabular-nums">{recentBlocked}</span></span>
          <span>Acceptance cap reached: <span className="text-emerald-900">{status.acceptanceCapReached ? 'yes' : 'no'}</span></span>
        </div>

        <div className="mt-2 text-[11px] text-emerald-800/80">
          Last query batch:{' '}
          {lastBatchPhrases.length === 0 ? (
            <span className="text-emerald-700/60">— (no run yet)</span>
          ) : (
            <span className="text-emerald-900">{lastBatchPhrases.slice(0, 10).join(' · ')}</span>
          )}
        </div>
      </div>

      {/* ── Phase 37 — Last-run verification (accepted/rejected samples) ── */}
      {lastVerif && (lastVerif.accepted_samples?.length || lastVerif.rejected_samples?.length) ? (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white px-3 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Last-run verification
            </span>
            <span className="text-[10px] text-gray-400 tabular-nums">
              accepted={lastVerif.accepted ?? 0} · rejected={lastVerif.rejected ?? 0}
            </span>
          </div>
          {lastVerif.accepted_samples?.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] font-semibold text-emerald-700 mb-1">Accepted (passed filters)</div>
              <ul className="space-y-1">
                {lastVerif.accepted_samples.slice(0, 6).map((s, i) => (
                  <li key={i} className="text-[11px] text-gray-700 leading-snug">
                    <span className="font-mono text-emerald-700">@{s.username || 'unknown'}</span>{' '}
                    <span className="tabular-nums text-gray-500">[buyer={s.buyer} pain={s.pain} heat={s.heat}{s.city ? ` ${s.city}` : ''}{s.country ? ` ${s.country}` : ''}{s.isHot ? ' HOT' : ''}]</span>{' '}
                    <span className="text-gray-600">"{s.text}"</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastVerif.rejected_samples?.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-rose-700 mb-1">Rejected (filter reasons)</div>
              <ul className="space-y-1">
                {lastVerif.rejected_samples.slice(0, 6).map((s, i) => (
                  <li key={i} className="text-[11px] text-gray-700 leading-snug">
                    <span className="font-mono text-rose-700">@{s.username || 'unknown'}</span>{' '}
                    <span className="tabular-nums text-gray-500">[{s.reason}]</span>{' '}
                    <span className="text-gray-600">"{s.text}"</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {status.stale && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Last run exceeded the 15-minute failsafe and was auto-reset to idle.
        </div>
      )}

      {triggered && (
        <div className="mb-3 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-700">
          Scrape cycle triggered — results will appear on next refresh.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(({ label, value, color }) => (
          <RevStat key={label} label={label} value={value} color={color} />
        ))}
      </div>

      <p className="mt-3 text-[11px] text-gray-500 leading-snug">
        ▸ Open the <span className="font-semibold text-brand-600">Outreach Queue</span> tab to reply.
      </p>

      {/* ── Phase 37 — Conversion-focused tiles only ──────────────────────── */}
      <div className="mt-5 pt-5 border-t border-dashed border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
            Conversion Focus
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MAIEStatCard
            label="Ready to reply"
            value={(oc.readyToReply ?? 0).toLocaleString()}
            color="amber"
            sub="awaiting first DM"
          />
          <MAIEStatCard
            label="Nigerian leads"
            value={(leadSources?.nigerianTotal ?? 0).toLocaleString()}
            color="emerald"
            sub="confidence ≥ 30"
          />
          <MAIEStatCard
            label="Buyer intent"
            value={(leadSources?.buyerReadyLeads ?? 0).toLocaleString()}
            color="teal"
            sub={`readiness ≥ ${injectBuyer}`}
          />
          <MAIEStatCard
            label="WhatsApp CTA clicks"
            value={(leadSources?.outreachCounts?.whatsappClicks ?? 0).toLocaleString()}
            color="sky"
            sub="from outreach replies"
          />
          <MAIEStatCard
            label="Replied"
            value={(oc.replied ?? 0).toLocaleString()}
            color="indigo"
            sub="lead responded"
          />
          <MAIEStatCard
            label="Converted"
            value={(oc.converted ?? 0).toLocaleString()}
            color="violet"
            sub="paid / academy"
          />
        </div>
        <p className="mt-3 text-[11px] text-gray-500 leading-snug">
          Phase 37 — strict Africa-first manual mode. Only leads with buyer intent ≥ {injectBuyer} or
          pain signal ≥ {injectPain} reach the Outreach Queue; everything else is stored silently.
        </p>
      </div>
    </SectionBox>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

function FollowUpControlSection({ followUps, onToggle }) {
  const [acting, setActing] = useState(false)

  const toggle = async () => {
    setActing(true)
    try {
      if (followUps.paused) await resumeFollowUps()
      else await pauseFollowUps()
      onToggle()
    } catch {
      // swallow — user sees stale state, refresh fixes it
    } finally {
      setActing(false)
    }
  }

  const rows = [
    { label: 'Unpaid quotes due',       value: followUps.quoteDue    ?? 0, warn: 1, crit: 5  },
    { label: 'Pending review notices',  value: followUps.pendingDue  ?? 0, warn: 1, crit: 3  },
    { label: 'Consult nudges due',      value: followUps.consultDue  ?? 0, warn: 1, crit: 3  },
    { label: 'Diagnosis no-action',     value: followUps.diagnosisDue ?? 0, warn: 1, crit: 5 },
    { label: 'Re-engagement due',       value: followUps.abandonedDue ?? 0, warn: 3, crit: 10 },
  ]

  return (
    <SectionBox title="Auto Follow-Up Engine" color="amber">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${followUps.paused ? 'bg-gray-400' : 'bg-green-400'}`} />
          <span className="text-xs font-semibold text-gray-700">
            {followUps.paused ? 'Engine Paused' : 'Engine Active'}
          </span>
          {!followUps.paused && (followUps.total ?? 0) > 0 && (
            <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-bold">
              {followUps.total} due
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={acting}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
            followUps.paused
              ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
              : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          }`}
        >
          {acting ? '…' : followUps.paused ? '▶ Resume Follow-ups' : '⏸ Pause Follow-ups'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map(({ label, value, warn, crit }) => (
          <div
            key={label}
            className={`rounded-lg border px-3 py-2.5 text-center ${
              value === 0
                ? 'border-gray-100 bg-gray-50'
                : value >= crit
                  ? 'border-red-200 bg-red-50'
                  : value >= warn
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-100 bg-gray-50'
            }`}
          >
            <div className={`text-2xl font-bold tabular-nums ${
              value === 0 ? 'text-gray-400' : value >= crit ? 'text-red-700' : 'text-amber-700'
            }`}>{value}</div>
            <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{label}</div>
          </div>
        ))}
      </div>
    </SectionBox>
  )
}

export default function CommandCenterPanel() {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetchCommandCenter()
      setData(res.data)
    } catch (e) {
      setError(e?.message || 'Failed to load command center')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div className="py-16 text-center text-gray-400 text-sm">Loading command center…</div>
  }

  if (error) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          type="button"
          onClick={() => load()}
          className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const { revenue, leadQueue, fulfillment, consults, alerts, followUps, leadSources, mce } = data

  // Total actionable items — defensive in case a section returned defaults on error
  const totalAction =
    (leadQueue?.hotProductLeads?.count  ?? 0) +
    (leadQueue?.humanReviewNeeded       ?? 0) +
    (leadQueue?.abandonedPayment?.count ?? 0) +
    (alerts?.failedTelegramSends        ?? 0) +
    (alerts?.quotePendingTooLong?.count ?? 0)

  return (
    <div className="space-y-6">

      {/* ── Critical error banner (whole-service failure, extremely rare) ── */}
      {data._criticalError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <span className="font-semibold">Dashboard error — showing fallback data.</span>{' '}
          {data._criticalError}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
            Operator Command Center
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Snapshot at {fmtDT(data.generatedAt)}
            {totalAction > 0 && (
              <span className="ml-2 rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-bold">
                {totalAction} items need attention
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {refreshing ? 'Refreshing…' : '↺ Refresh'}
        </button>
      </div>

      {/* ── 1. Revenue Snapshot ── */}
      <SectionBox title="Revenue Snapshot" color="teal" sectionError={revenue?.error}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <RevStat label="Product Revenue"       value={fmt(revenue.productRevenue)}              color="teal"   />
          <RevStat label="Academy Revenue"       value={fmt(revenue.academyRevenue)}              color="violet" />
          <RevStat label="Consult Revenue"       value="External" sub="WhatsApp bookings"          color="gray"   />
          <RevStat label="Unpaid Quote Total"    value={fmt(revenue.unpaidQuoteTotal)}     sub="Sent, awaiting payment" color="amber" />
          <RevStat label="Paid → Pending Ship"   value={fmt(revenue.paidPendingFulfillmentTotal)} sub="Paid, not fulfilled"    color="indigo" />
        </div>
      </SectionBox>

      {/* ── 2. Lead Priority Queue ── */}
      <SectionBox title="Lead Priority Queue" color="red" sectionError={leadQueue?.error}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">

          <QueueCard label="Hot Product Leads"      count={leadQueue.hotProductLeads.count}  warn={1} crit={4} color="teal">
            {leadQueue.hotProductLeads.leads.map(l => <LeadRow key={l.id} lead={l} />)}
          </QueueCard>

          <QueueCard label="Deep Consult Active"    count={leadQueue.deepConsultActive}       warn={1} crit={5} color="violet">
            {consults.activeDeepConsults.items.slice(0, 5).map(c => <ConsultRow key={c.id} consult={c} />)}
          </QueueCard>

          <QueueCard label="Human Review Needed"    count={leadQueue.humanReviewNeeded}       warn={1} crit={3} color="red">
            {consults.completedNeedingReview.items.slice(0, 5).map(c => <ConsultRow key={c.id} consult={c} />)}
          </QueueCard>

          <QueueCard label="Abandoned Payment"      count={leadQueue.abandonedPayment.count} warn={1} crit={3} color="amber">
            {leadQueue.abandonedPayment.leads.map(l => <LeadRow key={l.id} lead={l} />)}
          </QueueCard>

          <QueueCard label="Academy Locked"         count={leadQueue.academyLocked.count}    warn={1} crit={5} color="indigo">
            {leadQueue.academyLocked.leads.map(l => <LeadRow key={l.id} lead={l} />)}
          </QueueCard>

          <QueueCard label="Stuck Flows (48h+)"     count={leadQueue.stuckFlows.count}       warn={3} crit={8} color="gray">
            {leadQueue.stuckFlows.leads.map(l => <LeadRow key={l.id} lead={l} />)}
          </QueueCard>
        </div>
      </SectionBox>

      {/* ── 3. Fulfillment Queue ── */}
      <SectionBox title="Fulfillment Queue" color="indigo" sectionError={fulfillment?.error}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <FulfillStat label="Awaiting Address"  value={fulfillment.awaitingAddress}    active={fulfillment.awaitingAddress > 0}    />
          <FulfillStat label="Pending Packing"   value={fulfillment.pendingFulfillment} active={fulfillment.pendingFulfillment > 0} />
          <FulfillStat label="Packed"            value={fulfillment.packed}             active={fulfillment.packed > 0}             />
          <FulfillStat label="Delivered"         value={fulfillment.delivered}                                                      />
          <FulfillStat label="Cancelled"         value={fulfillment.cancelled}          active={fulfillment.cancelled > 0}          />
        </div>
      </SectionBox>

      {/* ── 4. Consult Queue ── */}
      <SectionBox title="Consult Queue" color="violet" sectionError={consults?.error}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

          <QueueCard label="Active Deep Consults"         count={consults.activeDeepConsults.count}     warn={1} crit={5} color="violet">
            {consults.activeDeepConsults.items.map(c => <ConsultRow key={c.id} consult={c} />)}
          </QueueCard>

          <QueueCard label="Completed → Human Review"     count={consults.completedNeedingReview.count} warn={1} crit={3} color="red">
            {consults.completedNeedingReview.items.map(c => <ConsultRow key={c.id} consult={c} />)}
          </QueueCard>

          <QueueCard label="Red Flag Leads"               count={consults.redFlagLeads.count}           warn={1} crit={2} color="red">
            {consults.redFlagLeads.items.map(c => <ConsultRow key={c.id} consult={c} />)}
          </QueueCard>

          <QueueCard label="Consult Done, No Quote Yet"   count={consults.completedNoProductAction}     warn={1} crit={5} color="amber">
            <p className="text-xs text-gray-400 py-2 text-center">
              Search by name in the Leads tab to send product quotes.
            </p>
          </QueueCard>
        </div>
      </SectionBox>

      {/* ── 5. Lead Sources — TikTok Acquisition ── */}
      {leadSources !== undefined && (
        <LeadSourcesSection leadSources={leadSources} onRefresh={() => load(true)} />
      )}

      {/* ── 5b. MCE — Funnel Conversion Stats (Phase 34) ── */}
      {mce?.funnel && <FunnelConversionPanel data={mce.funnel} />}

      {/* ── 5c. MCE — WhatsApp Click Rate (Phase 34) ── */}
      {mce?.whatsapp && <WhatsAppClickPanel data={mce.whatsapp} />}

      {/* ── 5d. MCE — Top Objections (Phase 34) ── */}
      {mce?.objections && <TopObjectionsPanel data={mce.objections} />}

      {/* ── 6. Auto Follow-Up Engine ── */}
      {followUps && (
        <FollowUpControlSection followUps={followUps} onToggle={() => load(true)} />
      )}

      {/* ── 6. System Alerts ── */}
      <SectionBox title="System Alerts" color="red" sectionError={alerts?.error}>
        <div className="space-y-2">

          <AlertRow
            label="Failed Telegram Sends — last 24h"
            count={alerts.failedTelegramSends}
            warn={1} crit={5}
          />

          <AlertRow
            label="Quotes Stuck in Pending Review (>24h)"
            count={alerts.quotePendingTooLong.count}
            warn={1} crit={4}
          >
            {alerts.quotePendingTooLong.quotes.slice(0, 5).map(q => <QuoteRow key={q.id} quote={q} />)}
          </AlertRow>

          <AlertRow
            label="Diagnosis Pending >24h (Telegram connected)"
            count={alerts.diagnosisPendingTooLong.count}
            warn={2} crit={6}
          >
            {alerts.diagnosisPendingTooLong.leads.slice(0, 5).map(l => <LeadRow key={l.id} lead={l} />)}
          </AlertRow>

          <AlertRow
            label="Diagnosis Sent — No Product Matches Generated"
            count={alerts.noProductMatches.count}
            warn={1} crit={4}
          >
            {alerts.noProductMatches.leads.slice(0, 5).map(l => <LeadRow key={l.id} lead={l} />)}
          </AlertRow>

          <AlertRow
            label="Stuck Current Flow (48h+ no interaction)"
            count={alerts.stuckCurrentFlow.count}
            warn={3} crit={8}
          >
            {alerts.stuckCurrentFlow.leads.slice(0, 5).map(l => <LeadRow key={l.id} lead={l} />)}
          </AlertRow>
        </div>
      </SectionBox>

    </div>
  )
}
