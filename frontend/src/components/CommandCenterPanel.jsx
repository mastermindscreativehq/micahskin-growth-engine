import { useState, useEffect, useCallback } from 'react'
import { fetchCommandCenter, pauseFollowUps, resumeFollowUps, triggerAcquisitionRun } from '../api/index.js'

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

// ── Lead Sources section ──────────────────────────────────────────────────────

function LeadSourcesSection({ leadSources, onRefresh }) {
  const [acquiring, setAcquiring] = useState(false)
  const [triggered, setTriggered] = useState(false)

  const trigger = async () => {
    setAcquiring(true)
    try {
      await triggerAcquisitionRun()
      setTriggered(true)
      setTimeout(() => setTriggered(false), 6000)
      onRefresh()
    } catch {
      // swallow — stale state, refresh fixes it
    } finally {
      setAcquiring(false)
    }
  }

  const isRunning = leadSources?.engineStatus === 'running'

  const stats = [
    { label: 'Scraped Today',     value: leadSources?.scrapedToday   ?? 0, color: 'teal'   },
    { label: 'High Intent Today', value: leadSources?.highIntentToday ?? 0, color: 'violet' },
    { label: 'Pending Outreach',  value: leadSources?.pendingOutreach ?? 0, color: 'amber'  },
    { label: 'Total Injected',    value: leadSources?.processedTotal  ?? 0, color: 'indigo' },
  ]

  return (
    <SectionBox title="Lead Sources — TikTok Acquisition" color="teal">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 transition-colors ${
            isRunning ? 'bg-amber-400 animate-pulse' : 'bg-teal-400'
          }`} />
          <span className="text-xs font-semibold text-gray-700">
            {isRunning ? 'Scrape in progress…' : 'Engine idle'}
          </span>
          <span className="text-xs text-gray-400 tabular-nums">
            {(leadSources?.totalScraped ?? 0).toLocaleString()} total scraped
          </span>
        </div>
        <button
          type="button"
          onClick={trigger}
          disabled={acquiring || isRunning}
          className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {acquiring ? '…' : '▶ Run Now'}
        </button>
      </div>

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

      <p className="mt-3 text-[11px] text-gray-400 leading-snug">
        Targets 8 TikTok hashtags · Runs every 30 min · High-intent leads (score ≥ 70) auto-appear in Hot Leads queue
      </p>
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

  const { revenue, leadQueue, fulfillment, consults, alerts, followUps, leadSources } = data

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
