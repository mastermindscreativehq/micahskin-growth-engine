import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchStats,
  fetchLeads,
  fetchRegistrations,
  updateLeadStatus,
  updateRegistrationStatus,
  updateImplementationDelivery,
  updateImplementationTasks,
  sendInitialReply,
  sendFollowUp,
  importInstagramDataset,
  fetchScrapingDebugAuth,
  prepareInstagramComments,
  runInstagramComments,
  fetchCommentTargetStats,
  importInstagramCommentDataset,
  sendManualConversionAction,
  resendConversionPaymentLink,
  sendConversionCustomMessage,
  fetchConversionContext,
  academyOperatorAction,
  fetchProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
  ingestManualProducts,
  fetchIngestionLogs,
} from '../api/index.js'
import ProductQuotePanel from './ProductQuotePanel.jsx'
import FulfillmentPanel from './FulfillmentPanel.jsx'
import SkinImagesPanel from './SkinImagesPanel.jsx'

// ── Constants ────────────────────────────────────────────────────────────────

const LEAD_STATUSES = ['new', 'contacted', 'engaged', 'interested', 'closed']
const ACADEMY_STATUSES = ['new', 'contacted', 'paid', 'onboarded', 'closed']
const PLATFORMS = ['TikTok', 'Instagram', 'Other']
const SOURCE_TYPES = ['bio_form', 'dm', 'comment', 'story_reply', 'manual']
const PRIORITIES = ['high', 'medium', 'low']
// Statuses that block CRM-triggered sends (mirrors backend STOP_STATUSES)
const STOP_STATUSES = ['engaged', 'interested', 'closed']

// ── Premium delivery pipeline constants ──────────────────────────────────────
const IMPL_STAGES = [
  'paid',
  'onboarding_sent',
  'intake_pending',
  'intake_complete',
  'review_pending',
  'strategy_call_pending',
  'strategy_call_booked',
  'build_pending',
  'build_in_progress',
  'delivered',
  'active',
]

const IMPL_STAGE_STYLE = {
  paid:                   'bg-gray-100 text-gray-600',
  onboarding_sent:        'bg-blue-100 text-blue-700',
  intake_pending:         'bg-amber-100 text-amber-700',
  intake_complete:        'bg-yellow-100 text-yellow-800',
  review_pending:         'bg-orange-100 text-orange-700',
  strategy_call_pending:  'bg-purple-100 text-purple-700',
  strategy_call_booked:   'bg-violet-100 text-violet-700',
  build_pending:          'bg-indigo-100 text-indigo-700',
  build_in_progress:      'bg-blue-100 text-blue-800',
  delivered:              'bg-emerald-100 text-emerald-700',
  active:                 'bg-green-100 text-green-800',
}

const TASK_LABELS = [
  { key: 'taskIntakeReviewed',  label: 'Intake reviewed' },
  { key: 'taskScopeReady',      label: 'Scope prepared' },
  { key: 'taskCallBooked',      label: 'Strategy call booked' },
  { key: 'taskBuildStarted',    label: 'Build started' },
  { key: 'taskDeliveryComplete', label: 'Delivery complete' },
]

const SETUP_STATUS_STYLE = {
  not_started:  'bg-gray-100 text-gray-500',
  in_progress:  'bg-blue-100 text-blue-700',
  complete:     'bg-green-100 text-green-700',
}

// Readable intake question labels for CRM display
const INTAKE_LABELS = [
  { key: 'intakeBrandName',       label: 'Brand name' },
  { key: 'intakeBusinessType',    label: 'Business type' },
  { key: 'intakeBusinessStage',   label: 'Business stage' },
  { key: 'intakeProductsServices', label: 'Products / services' },
  { key: 'intakeSalesChannel',    label: 'Sales channel' },
  { key: 'intakeTopProblem',      label: 'Top problem' },
  { key: 'intakeMainGoal',        label: 'Main goal' },
  { key: 'intakeNeedsLeadGen',    label: 'Needs lead gen', bool: true },
  { key: 'intakeNeedsAutomation', label: 'Needs automation', bool: true },
  { key: 'intakeNeedsContent',    label: 'Needs content help', bool: true },
  { key: 'intakeSupportMethod',   label: 'Support preference' },
]

const STATUS_STYLE = {
  new: 'bg-gray-100 text-gray-700',
  contacted: 'bg-blue-100 text-blue-700',
  engaged: 'bg-yellow-100 text-yellow-800',
  interested: 'bg-green-100 text-green-700',
  // legacy statuses kept for existing data
  qualified: 'bg-yellow-100 text-yellow-800',
  converted: 'bg-green-100 text-green-700',
  paid: 'bg-emerald-100 text-emerald-700',
  onboarded: 'bg-purple-100 text-purple-700',
  closed: 'bg-red-100 text-red-600',
}

const PRIORITY_STYLE = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-500',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const label = priority || 'low'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${PRIORITY_STYLE[label] || 'bg-gray-100 text-gray-500'}`}>
      {label}
    </span>
  )
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function fmtDateTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Returns the earliest upcoming follow-up time, or null if all have passed. */
function nextFollowUp(lead) {
  const now = Date.now()
  return [lead.followUp1, lead.followUp2, lead.followUp3]
    .filter(Boolean)
    .map((t) => new Date(t))
    .filter((t) => t.getTime() > now)
    .sort((a, b) => a - b)[0] || null
}

/**
 * Returns follow-up status for the "Follow-up Due" column.
 * Checks sent flags so completed slots are not shown as overdue.
 * Returns { type: 'overdue'|'upcoming', time: Date } or null.
 */
function followUpStatus(lead) {
  const now = Date.now()
  const slots = [
    { time: lead.followUp1, sent: lead.followUp1Sent || !!lead.followUp1SentAt },
    { time: lead.followUp2, sent: lead.followUp2Sent || !!lead.followUp2SentAt },
    { time: lead.followUp3, sent: lead.followUp3Sent || !!lead.followUp3SentAt },
  ]
  // Earliest overdue slot that hasn't been sent
  const overdue = slots
    .filter((s) => s.time && !s.sent && new Date(s.time).getTime() <= now)
    .sort((a, b) => new Date(a.time) - new Date(b.time))[0]
  if (overdue) return { type: 'overdue', time: overdue.time }
  // Next upcoming slot that hasn't been sent
  const upcoming = slots
    .filter((s) => s.time && !s.sent && new Date(s.time).getTime() > now)
    .sort((a, b) => new Date(a.time) - new Date(b.time))[0]
  if (upcoming) return { type: 'upcoming', time: upcoming.time }
  return null
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState(null)
  const [recentLeads, setRecentLeads] = useState([])
  const [recentAcademy, setRecentAcademy] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchStats(),
      fetchLeads({ limit: 5 }),
      fetchRegistrations({ limit: 5 }),
    ])
      .then(([s, l, a]) => {
        setStats(s.data)
        setRecentLeads(l.data)
        setRecentAcademy(a.data)
      })
      .catch(() => setError('Failed to load overview data'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
  if (error) return <div className="py-12 text-center text-red-500 text-sm">{error}</div>

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Leads" value={stats.leads.total} color="brand" />
        <StatCard label="Total Academy" value={stats.academy.total} color="purple" />
        <StatCard
          label="Leads Interested"
          value={(stats.leads.byStatus?.interested || 0) + (stats.leads.byStatus?.converted || 0)}
          color="green"
        />
        <StatCard
          label="Academy Paid"
          value={stats.academy.byStatus?.paid || 0}
          color="emerald"
        />
      </div>

      {/* Status breakdowns */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <StatusBreakdown
          title="Leads by Status"
          byStatus={stats.leads.byStatus}
          statuses={LEAD_STATUSES}
        />
        <StatusBreakdown
          title="Academy by Status"
          byStatus={stats.academy.byStatus}
          statuses={ACADEMY_STATUSES}
        />
      </div>

      {/* Recent entries */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <RecentList title="Latest Leads" items={recentLeads} type="lead" />
        <RecentList title="Latest Academy" items={recentAcademy} type="academy" />
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    brand: 'bg-brand-50 border-brand-200 text-brand-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
    green: 'bg-green-50 border-green-200 text-green-600',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-600',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.brand}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  )
}

function StatusBreakdown({ title, byStatus, statuses }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>
      <div className="space-y-2">
        {statuses.map((s) => {
          const count = byStatus?.[s] || 0
          return (
            <div key={s} className="flex items-center justify-between text-sm">
              <StatusBadge status={s} />
              <span className="font-medium text-gray-700">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecentList({ title, items, type }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">No entries yet</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{item.fullName}</p>
                  <p className="truncate text-xs text-gray-400">
                    {type === 'lead' ? item.skinConcern : item.experienceLevel} · {item.sourcePlatform}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-gray-400">{fmtDate(item.createdAt)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Leads Tab ────────────────────────────────────────────────────────────────

function LeadsTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [sourceTypeFilter, setSourceTypeFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [intentTagFilter, setIntentTagFilter] = useState('')
  const [engagementFilter, setEngagementFilter] = useState('')
  const [needsFollowUp, setNeedsFollowUp] = useState(false)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ data: [], total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState(null)
  const [sendingId, setSendingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchLeads({
      search,
      status: statusFilter,
      source: sourceFilter,
      sourceType: sourceTypeFilter,
      priority: priorityFilter,
      intentTag: intentTagFilter,
      engagementScore: engagementFilter || undefined,
      needsFollowUp: needsFollowUp ? 'true' : undefined,
      page,
      limit: 15,
    })
      .then(setResult)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [search, statusFilter, sourceFilter, sourceTypeFilter, priorityFilter, intentTagFilter, engagementFilter, needsFollowUp, page])

  useEffect(() => { load() }, [load])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, statusFilter, sourceFilter, sourceTypeFilter, priorityFilter, intentTagFilter, engagementFilter, needsFollowUp])

  async function handleStatusChange(id, status) {
    setUpdatingId(id)
    try {
      await updateLeadStatus(id, status)
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleSend(leadId, action) {
    const key = `${action}-${leadId}`
    setSendingId(key)
    try {
      if (action === 'initial') await sendInitialReply(leadId)
      else if (action === 'fu1') await sendFollowUp(leadId, 1)
      else if (action === 'fu2') await sendFollowUp(leadId, 2)
      else if (action === 'fu3') await sendFollowUp(leadId, 3)
      load()
    } catch (e) {
      console.error('[Send]', e?.message || e)
    } finally {
      setSendingId(null)
    }
  }

  function clearAll() {
    setPriorityFilter('')
    setStatusFilter('')
    setSourceFilter('')
    setSourceTypeFilter('')
    setIntentTagFilter('')
    setEngagementFilter('')
    setSearch('')
    setNeedsFollowUp(false)
  }

  return (
    <div className="space-y-4">
      {/* Quick-view buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setEngagementFilter('high'); setPriorityFilter(''); setStatusFilter(''); setNeedsFollowUp(false) }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${engagementFilter === 'high' ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
          🔥 Hot Leads
        </button>
        <button
          onClick={() => { setPriorityFilter('high'); setStatusFilter(''); setNeedsFollowUp(false); setEngagementFilter('') }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${priorityFilter === 'high' && !needsFollowUp && !engagementFilter ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
          High Priority
        </button>
        <button
          onClick={() => { setNeedsFollowUp(true); setStatusFilter(''); setPriorityFilter(''); setEngagementFilter('') }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${needsFollowUp ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
          Follow-up Due Now
        </button>
        <button
          onClick={clearAll}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-50 transition-colors"
        >
          Clear all
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 flex-1 min-w-[200px]"
        />
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={sourceTypeFilter}
          onChange={(e) => setSourceTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All source types</option>
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Intent tag…"
          value={intentTagFilter}
          onChange={(e) => setIntentTagFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 w-32"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Concern</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Follow-up Due</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">Loading…</td>
              </tr>
            ) : result.data.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">No leads found</td>
              </tr>
            ) : result.data.map((lead) => {
              const fup = followUpStatus(lead)
              const isExpanded = expandedId === lead.id
              const isHot = lead.engagementScore === 'high'
              return (
                <>
                  <tr
                    key={lead.id}
                    className={`transition-colors cursor-pointer ${
                      isHot
                        ? 'bg-orange-50/50 hover:bg-orange-50'
                        : fup?.type === 'overdue'
                          ? 'bg-red-50/30 hover:bg-red-50/50'
                          : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-1">
                        {isHot && <span title="High engagement">🔥</span>}
                        <span>{lead.fullName}</span>
                        {lead.suggestedReply && (
                          <span className="text-gray-300 text-xs" title="Has suggested reply">💬</span>
                        )}
                        {lead.telegramStarted && (
                          <span className="text-blue-300 text-xs" title="Telegram connected">✈</span>
                        )}
                      </div>
                      {lead.intentTag && <div className="text-xs text-gray-400 mt-0.5">{lead.intentTag}</div>}
                      {lead.intent && <div className="text-xs text-blue-500 mt-0.5 capitalize">{lead.intent.replace(/_/g, ' ')}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <div>{lead.email || '—'}</div>
                      {lead.phone && <div className="text-xs">{lead.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-600">{lead.sourcePlatform}</div>
                      {lead.sourceType && <div className="text-xs text-gray-400">{lead.sourceType.replace(/_/g, ' ')}</div>}
                      {lead.handle && <div className="text-xs text-gray-400">@{lead.handle}</div>}
                      {lead.campaign && <div className="text-xs text-gray-400">{lead.campaign}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{lead.skinConcern?.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3"><PriorityBadge priority={lead.priority} /></td>
                    <td className="px-4 py-3 text-xs">
                      {fup?.type === 'overdue' ? (
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          <span className="text-red-600 font-semibold">{fmtDateTime(fup.time)}</span>
                          <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold text-red-600 uppercase tracking-wide">overdue</span>
                        </span>
                      ) : fup?.type === 'upcoming' ? (
                        <span className="text-orange-500 font-medium">{fmtDateTime(fup.time)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(lead.createdAt)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={lead.status}
                        disabled={updatingId === lead.id}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-400 disabled:opacity-50"
                      >
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${lead.id}-detail`} className="bg-blue-50">
                      <td colSpan={8} className="px-4 py-3 space-y-3">
                        {/* Suggested Reply */}
                        {lead.suggestedReply ? (
                          <div className="flex items-start gap-3">
                            <span className="shrink-0 text-xs font-semibold text-blue-600 uppercase tracking-wide pt-0.5">Suggested Reply</span>
                            <p className="text-sm text-blue-900 leading-snug flex-1">{lead.suggestedReply}</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(lead.suggestedReply) }}
                              className="shrink-0 rounded border border-blue-200 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-100 transition-colors"
                            >
                              Copy Reply
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-blue-400 italic">No suggested reply for this lead</p>
                        )}

                        {/* Telegram Intake Panel */}
                        {lead.telegramStarted ? (
                          <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 space-y-2">
                            {/* Header row */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-blue-700 uppercase tracking-wide">Telegram Intake</span>
                              <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                ✓ Connected
                              </span>
                              {lead.telegramUsername && (
                                <span className="text-blue-500">@{lead.telegramUsername}</span>
                              )}
                              {lead.telegramFlowType && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  lead.telegramFlowType === 'routine'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-purple-100 text-purple-700'
                                }`}>
                                  {lead.telegramFlowType === 'routine' ? '✨ routine' : '💬 concern'}
                                </span>
                              )}
                              {lead.telegramStage && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  lead.telegramStage === 'intake_complete' || lead.telegramStage === 'awaiting_human_review'
                                    ? 'bg-green-100 text-green-700'
                                    : lead.telegramStage === 'connected'
                                      ? 'bg-blue-100 text-blue-600'
                                      : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {lead.telegramStage.replace(/_/g, ' ')}
                                </span>
                              )}
                              {lead.engagementScore && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                  lead.engagementScore === 'high'
                                    ? 'bg-orange-100 text-orange-700'
                                    : lead.engagementScore === 'medium'
                                      ? 'bg-yellow-100 text-yellow-700'
                                      : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {lead.engagementScore === 'high' ? '🔥 ' : ''}{lead.engagementScore} engagement
                                </span>
                              )}
                              {lead.intent && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                                  lead.intent === 'price' || lead.intent === 'urgent'
                                    ? 'bg-red-100 text-red-700'
                                    : lead.intent === 'routine'
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : 'bg-purple-100 text-purple-700'
                                }`}>
                                  {lead.intent.replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>

                            {/* Intake answers grid — rendered based on flow type */}
                            {lead.telegramFlowType === 'routine' ? (
                              (lead.telegramRoutineGoal || lead.telegramArea || lead.telegramSkinType ||
                               lead.telegramProductsUsed || lead.telegramSensitivity || lead.telegramBudget || lead.telegramRoutineLevel) && (
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  {[
                                    { label: 'Goal',          value: lead.telegramRoutineGoal },
                                    { label: 'Area',          value: lead.telegramArea },
                                    { label: 'Skin type',     value: lead.telegramSkinType },
                                    { label: 'Products used', value: lead.telegramProductsUsed },
                                    { label: 'Sensitivity',   value: lead.telegramSensitivity },
                                    { label: 'Budget',        value: lead.telegramBudget },
                                    { label: 'Routine level', value: lead.telegramRoutineLevel },
                                  ].filter(f => f.value).map(({ label, value }) => (
                                    <div key={label} className="flex gap-1.5">
                                      <span className="shrink-0 font-medium text-gray-500 w-24">{label}:</span>
                                      <span className="text-gray-700 italic truncate" title={value}>
                                        {value.length > 80 ? value.slice(0, 80) + '…' : value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )
                            ) : (
                              (lead.telegramConcern || lead.telegramDuration || lead.telegramArea ||
                               lead.telegramSkinType || lead.telegramProductsTried ||
                               lead.telegramSeverity || lead.telegramGoal) && (
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  {[
                                    { label: 'Concern',        value: lead.telegramConcern },
                                    { label: 'Duration',       value: lead.telegramDuration },
                                    { label: 'Area',           value: lead.telegramArea },
                                    { label: 'Skin type',      value: lead.telegramSkinType },
                                    { label: 'Products tried', value: lead.telegramProductsTried },
                                    { label: 'Severity',       value: lead.telegramSeverity },
                                    { label: 'Goal',           value: lead.telegramGoal },
                                  ].filter(f => f.value).map(({ label, value }) => (
                                    <div key={label} className="flex gap-1.5">
                                      <span className="shrink-0 font-medium text-gray-500 w-24">{label}:</span>
                                      <span className="text-gray-700 italic truncate" title={value}>
                                        {value.length > 80 ? value.slice(0, 80) + '…' : value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )
                            )}

                            {/* Last message */}
                            {lead.telegramLastMessage ? (
                              <div className="text-xs text-gray-600 border-t border-blue-100 pt-1.5">
                                <span className="font-medium text-gray-500">Last message: </span>
                                <span className="italic">
                                  "{lead.telegramLastMessage.slice(0, 200)}{lead.telegramLastMessage.length > 200 ? '…' : ''}"
                                </span>
                                {lead.telegramLastMessageAt && (
                                  <span className="ml-2 text-gray-400">{fmtDateTime(lead.telegramLastMessageAt)}</span>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-blue-400 italic">No reply yet — awaiting first message</p>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 italic">Telegram not connected</div>
                        )}

                        {/* Skin Images Panel — shown whenever image upload phase was entered */}
                        {(lead.imageUploadStatus || lead.imageUploadCount > 0) && (
                          <SkinImagesPanel
                            leadId={lead.id}
                            imageUploadStatus={lead.imageUploadStatus}
                            imageUploadCount={lead.imageUploadCount}
                            imageReviewStatus={lead.imageReviewStatus}
                          />
                        )}

                        {/* Diagnosis Panel */}
                        {lead.diagnosis && (
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2.5 space-y-2">
                            {/* Header */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-emerald-700 uppercase tracking-wide">Skin Diagnosis</span>
                              {lead.diagnosisGeneratedAt && (
                                <span className="text-emerald-500">{fmtDateTime(lead.diagnosisGeneratedAt)}</span>
                              )}
                              {/* Auto follow-up send status badges */}
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${lead.diagnosisSent ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                {lead.diagnosisSent ? `✓ Diagnosis sent${lead.diagnosisSentAt ? ` ${fmtDateTime(lead.diagnosisSentAt)}` : ''}` : 'Diagnosis pending'}
                              </span>
                              {lead.checkInSent !== undefined && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${lead.checkInSent ? 'bg-green-100 text-green-700' : lead.checkInSendAfter ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                                  {lead.checkInSent ? `✓ Check-in sent${lead.checkInSentAt ? ` ${fmtDateTime(lead.checkInSentAt)}` : ''}` : 'Check-in pending'}
                                </span>
                              )}
                              {lead.productRecoSent !== undefined && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${lead.productRecoSent ? 'bg-green-100 text-green-700' : lead.productRecoSendAfter ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                                  {lead.productRecoSent ? `✓ Products sent${lead.productRecoSentAt ? ` ${fmtDateTime(lead.productRecoSentAt)}` : ''}` : 'Products pending'}
                                </span>
                              )}
                            </div>

                            {/* Diagnosis text */}
                            <p className="text-xs text-emerald-900 leading-relaxed">
                              <span className="font-semibold">Assessment: </span>
                              {lead.diagnosis.text}
                            </p>

                            {/* Routine */}
                            {lead.routine && (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
                                {lead.routine.morning?.length > 0 && (
                                  <div>
                                    <p className="font-semibold text-emerald-700 mb-0.5">Morning</p>
                                    <ol className="list-decimal list-inside space-y-0.5 text-gray-700">
                                      {lead.routine.morning.map((step, i) => (
                                        <li key={i}>{step}</li>
                                      ))}
                                    </ol>
                                  </div>
                                )}
                                {lead.routine.night?.length > 0 && (
                                  <div>
                                    <p className="font-semibold text-emerald-700 mb-0.5">Night</p>
                                    <ol className="list-decimal list-inside space-y-0.5 text-gray-700">
                                      {lead.routine.night.map((step, i) => (
                                        <li key={i}>{step}</li>
                                      ))}
                                    </ol>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Product recommendations */}
                            {lead.products?.recommendations?.length > 0 && (
                              <div className="text-xs">
                                <p className="font-semibold text-emerald-700 mb-0.5">Product Recommendations</p>
                                <ul className="space-y-0.5 text-gray-700">
                                  {lead.products.recommendations.map((p, i) => (
                                    <li key={i} className="flex gap-1"><span className="text-emerald-500">•</span>{p}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Notes */}
                            {lead.diagnosis.notes?.length > 0 && (
                              <div className="text-xs border-t border-emerald-100 pt-1.5">
                                <p className="font-semibold text-emerald-700 mb-0.5">Clinical Notes</p>
                                <ul className="space-y-0.5 text-gray-600">
                                  {lead.diagnosis.notes.map((n, i) => (
                                    <li key={i} className="flex gap-1"><span className="text-emerald-400">→</span>{n}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Auto follow-up schedule */}
                            {(lead.diagnosisSendAfter || lead.checkInSendAfter || lead.productRecoSendAfter) && (
                              <div className="flex flex-wrap gap-3 text-xs border-t border-emerald-100 pt-1.5 text-gray-500">
                                <span className="font-medium text-emerald-600">Auto-send schedule:</span>
                                {lead.diagnosisSendAfter && (
                                  <span className={lead.diagnosisSent ? 'line-through text-gray-400' : 'text-emerald-700'}>
                                    Diagnosis → {fmtDateTime(lead.diagnosisSendAfter)}
                                  </span>
                                )}
                                {lead.checkInSendAfter && (
                                  <span className={lead.checkInSent ? 'line-through text-gray-400' : 'text-emerald-700'}>
                                    Check-in → {fmtDateTime(lead.checkInSendAfter)}
                                  </span>
                                )}
                                {lead.productRecoSendAfter && (
                                  <span className={lead.productRecoSent ? 'line-through text-gray-400' : 'text-emerald-700'}>
                                    Products → {fmtDateTime(lead.productRecoSendAfter)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Diagnosis Engine Panel */}
                        {(lead.diagnosisSummary || lead.primaryConcern) && (
                          <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 space-y-2">
                            {/* Header */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-indigo-700 uppercase tracking-wide">Diagnosis Engine</span>
                              {lead.diagnosisSource && (
                                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 capitalize">
                                  {lead.diagnosisSource.replace(/_/g, ' ')}
                                </span>
                              )}
                              {lead.confidenceScore != null && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  lead.confidenceScore >= 70 ? 'bg-green-100 text-green-700' :
                                  lead.confidenceScore >= 40 ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                  {lead.confidenceScore}% confidence
                                </span>
                              )}
                              {lead.diagnosedAt && (
                                <span className="text-indigo-400 text-[10px]">{fmtDateTime(lead.diagnosedAt)}</span>
                              )}
                            </div>

                            {/* Summary */}
                            {lead.diagnosisSummary && (
                              <p className="text-xs text-indigo-900 leading-relaxed font-medium">
                                {lead.diagnosisSummary}
                              </p>
                            )}

                            {/* Concern + intent grid */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                              {[
                                { label: 'Primary Concern',    value: lead.primaryConcern?.replace(/_/g, ' ') },
                                { label: 'Secondary Concern',  value: lead.secondaryConcern?.replace(/_/g, ' ') },
                                { label: 'Routine Type',       value: lead.routineType?.replace(/_/g, ' ') },
                                { label: 'Urgency',            value: lead.urgencyLevel },
                                { label: 'Conversion Intent',  value: lead.conversionIntent },
                                { label: 'Next Best Action',   value: lead.nextBestAction?.replace(/_/g, ' ') },
                              ].filter(f => f.value).map(({ label, value }) => (
                                <div key={label} className="flex gap-1.5">
                                  <span className="shrink-0 font-medium text-gray-500 w-28">{label}:</span>
                                  <span className={`capitalize font-semibold ${
                                    label === 'Urgency' && value === 'high' ? 'text-red-600' :
                                    label === 'Urgency' && value === 'medium' ? 'text-amber-600' :
                                    label === 'Next Best Action' && value === 'manual consult' ? 'text-red-600' :
                                    label === 'Next Best Action' && value === 'push academy' ? 'text-purple-700' :
                                    'text-indigo-800'
                                  }`}>{value}</span>
                                </div>
                              ))}
                              {lead.academyFitScore != null && (
                                <div className="flex gap-1.5">
                                  <span className="shrink-0 font-medium text-gray-500 w-28">Academy Fit:</span>
                                  <span className={`font-bold ${
                                    lead.academyFitScore >= 60 ? 'text-purple-700' :
                                    lead.academyFitScore >= 30 ? 'text-amber-600' :
                                    'text-gray-500'
                                  }`}>{lead.academyFitScore}/100</span>
                                </div>
                              )}
                            </div>

                            {/* Recommended products */}
                            {lead.recommendedProductsText && (
                              <div className="text-xs border-t border-indigo-100 pt-1.5">
                                <p className="font-semibold text-indigo-700 mb-0.5">Recommended Products</p>
                                <p className="text-gray-700 leading-relaxed">{lead.recommendedProductsText}</p>
                              </div>
                            )}

                            {/* Recommended reply draft */}
                            {lead.recommendedReply && (
                              <div className="border-t border-indigo-100 pt-1.5">
                                <div className="flex items-start gap-2">
                                  <div className="flex-1">
                                    <p className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide mb-0.5">Reply Draft (operator use)</p>
                                    <p className="text-xs text-gray-700 leading-relaxed italic">{lead.recommendedReply}</p>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(lead.recommendedReply) }}
                                    className="shrink-0 rounded border border-indigo-200 px-2 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-100 transition-colors"
                                  >
                                    Copy
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Conversion Status Panel — consult + course offers */}
                        {(lead.consultOfferSendAfter || lead.consultOfferSent ||
                          lead.courseOfferSendAfter  || lead.courseOfferSent  ||
                          lead.consultOfferStatus    || lead.courseOfferStatus) && (
                          <div className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5 space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-violet-700 uppercase tracking-wide">Conversion</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                              {[
                                {
                                  label:  'Consult Offer',
                                  status: lead.consultOfferStatus || (lead.consultOfferSent ? 'sent' : (lead.consultOfferSendAfter ? 'pending' : null)),
                                  sentAt: lead.consultOfferSentAt,
                                  due:    lead.consultOfferSendAfter,
                                },
                                {
                                  label:  'Course Offer',
                                  status: lead.courseOfferStatus  || (lead.courseOfferSent  ? 'sent' : (lead.courseOfferSendAfter  ? 'pending' : null)),
                                  sentAt: lead.courseOfferSentAt,
                                  due:    lead.courseOfferSendAfter,
                                },
                              ].filter(s => s.status).map(({ label, status, sentAt, due }) => {
                                const colorMap = {
                                  sent:    'text-green-700 bg-green-100',
                                  skipped: 'text-gray-500 bg-gray-100',
                                  failed:  'text-red-600 bg-red-100',
                                  blocked: 'text-amber-700 bg-amber-100',
                                  pending: 'text-blue-700 bg-blue-100',
                                }
                                return (
                                  <div key={label} className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-gray-500 w-24">{label}:</span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${colorMap[status] || 'text-gray-500 bg-gray-100'}`}
                                      title={sentAt ? fmtDateTime(sentAt) : (due ? `due ${fmtDateTime(due)}` : undefined)}
                                    >
                                      {status}{sentAt ? ' ✓' : ''}
                                    </span>
                                    {sentAt && (
                                      <span className="text-gray-400 text-[10px]">{fmtDateTime(sentAt)}</span>
                                    )}
                                    {!sentAt && due && status === 'pending' && (
                                      <span className="text-blue-400 text-[10px]">due {fmtDateTime(due)}</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Conversation Brain Panel — mode, intent state, suppression visibility */}
                        {lead.diagnosisSent && (
                          <ConversationBrainPanel lead={lead} />
                        )}

                        {/* Conversion Trigger Panel — manual controls + auto-conversion state */}
                        {(lead.telegramStarted || lead.diagnosisSent || lead.conversionStage) && (
                          <ConversionTriggerPanel lead={lead} onRefresh={load} />
                        )}

                        {/* Product Intelligence Panel — matched products, quote builder */}
                        {lead.primaryConcern && (
                          <ProductQuotePanel lead={lead} />
                        )}

                        {/* Fulfillment Panel — order packing/delivery for paid product quotes */}
                        {(lead.paymentStatus === 'paid' || lead.quoteStatus === 'paid') && (
                          <FulfillmentPanel lead={lead} />
                        )}

                        {/* Action Engine Status Panel */}
                        {(lead.diagnosisStatus || lead.checkInStatus || lead.productRecoStatus ||
                          lead.academyOfferStatus || lead.lastActionType || lead.actionBlockedReason ||
                          lead.diagnosisSent || lead.checkInSent || lead.productRecoSent) && (
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2.5 space-y-2">
                            {/* Header */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-emerald-700 uppercase tracking-wide">Action Engine</span>
                              {lead.lastActionType && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 capitalize">
                                  last: {lead.lastActionType.replace(/_/g, ' ')}
                                </span>
                              )}
                              {lead.lastActionAt && (
                                <span className="text-emerald-400 text-[10px]">{fmtDateTime(lead.lastActionAt)}</span>
                              )}
                            </div>

                            {/* Action status grid */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                              {[
                                {
                                  label: 'Diagnosis',
                                  status: lead.diagnosisStatus || (lead.diagnosisSent ? 'sent' : null),
                                  sentAt: lead.diagnosisSentAt,
                                },
                                {
                                  label: 'Check-in',
                                  status: lead.checkInStatus || (lead.checkInSent ? 'sent' : null),
                                  sentAt: lead.checkInSentAt,
                                },
                                {
                                  label: 'Product Reco',
                                  status: lead.productRecoStatus || (lead.productRecoSent ? 'sent' : null),
                                  sentAt: lead.productRecoSentAt,
                                },
                                {
                                  label: 'Academy Offer',
                                  status: lead.academyOfferStatus || (lead.academyOfferSent ? 'sent' : null),
                                  sentAt: lead.academyOfferSentAt,
                                  hide: !lead.academyFitScore || lead.academyFitScore < 65,
                                },
                              ].filter(s => !s.hide).map(({ label, status, sentAt }) => {
                                if (!status) return null
                                const colorMap = {
                                  sent:    'text-green-700 bg-green-100',
                                  skipped: 'text-gray-500 bg-gray-100',
                                  failed:  'text-red-600 bg-red-100',
                                  blocked: 'text-amber-700 bg-amber-100',
                                  pending: 'text-blue-700 bg-blue-100',
                                }
                                return (
                                  <div key={label} className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-gray-500 w-20">{label}:</span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${colorMap[status] || 'text-gray-500 bg-gray-100'}`}
                                      title={sentAt ? fmtDateTime(sentAt) : undefined}
                                    >
                                      {status}{sentAt ? ` ✓` : ''}
                                    </span>
                                    {sentAt && (
                                      <span className="text-gray-400 text-[10px]">{fmtDateTime(sentAt)}</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>

                            {/* Blocked reason */}
                            {lead.actionBlockedReason && (
                              <div className="flex items-center gap-1.5 text-xs border-t border-emerald-100 pt-1.5">
                                <span className="text-amber-600 font-semibold">⚠ Blocked:</span>
                                <span className="text-amber-700 capitalize">{lead.actionBlockedReason.replace(/_/g, ' ')}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Follow-up schedule with sent / overdue indicators */}
                        {(lead.followUp1 || lead.followUp2 || lead.followUp3) && (
                          <div className="flex flex-wrap gap-4 text-xs">
                            {[
                              { label: '1h',  time: lead.followUp1, sent: lead.followUp1Sent || !!lead.followUp1SentAt, sentAt: lead.followUp1SentAt },
                              { label: '6h',  time: lead.followUp2, sent: lead.followUp2Sent || !!lead.followUp2SentAt, sentAt: lead.followUp2SentAt },
                              { label: '24h', time: lead.followUp3, sent: lead.followUp3Sent || !!lead.followUp3SentAt, sentAt: lead.followUp3SentAt },
                            ].filter((s) => s.time).map(({ label, time, sent, sentAt }) => {
                              const isOverdue = !sent && new Date(time).getTime() <= Date.now()
                              return (
                                <span
                                  key={label}
                                  className={
                                    sent
                                      ? 'text-gray-400 line-through'
                                      : isOverdue
                                        ? 'text-red-600 font-semibold'
                                        : 'text-blue-700'
                                  }
                                >
                                  {label} → {fmtDateTime(time)}
                                  {sent
                                    ? ` ✓${sentAt ? ` (${fmtDateTime(sentAt)})` : ''}`
                                    : isOverdue ? ' ●' : ''}
                                </span>
                              )
                            })}
                          </div>
                        )}

                        {/* Last message sent info */}
                        {(lead.lastMessageSentAt || lead.initialReplySentAt) && (
                          <div className="text-xs text-gray-500 flex flex-wrap gap-3">
                            {lead.initialReplySentAt && (
                              <span>
                                <span className="font-medium text-gray-600">Initial sent:</span>{' '}
                                {fmtDateTime(lead.initialReplySentAt)}
                              </span>
                            )}
                            {lead.lastMessageSentAt && (
                              <span>
                                <span className="font-medium text-gray-600">Last sent:</span>{' '}
                                {fmtDateTime(lead.lastMessageSentAt)}
                                {lead.lastMessageChannel && (
                                  <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500 capitalize">
                                    {lead.lastMessageChannel}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Send Actions */}
                        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Send:</span>

                          {/* Send Initial */}
                          {(() => {
                            const isSent = !!(lead.initialReplySentAt || lead.initialMessageSent)
                            const isBlocked = STOP_STATUSES.includes(lead.status)
                            const isSending = sendingId === `initial-${lead.id}`
                            const disabled = isSent || isBlocked || isSending
                            return (
                              <button
                                disabled={disabled}
                                onClick={() => handleSend(lead.id, 'initial')}
                                title={
                                  isSent    ? `Sent ${fmtDateTime(lead.initialReplySentAt) || ''}` :
                                  isBlocked ? `Blocked — lead is ${lead.status}` :
                                  'Send initial reply via Telegram'
                                }
                                className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                                  isSent    ? 'border-green-200 bg-green-50 text-green-700 opacity-70' :
                                  isBlocked ? 'border-gray-200 text-gray-400 opacity-50' :
                                              'border-brand-300 text-brand-700 hover:bg-brand-50'
                                }`}
                              >
                                {isSending ? '…' : isSent ? '✓ Initial Sent' : 'Send Initial'}
                              </button>
                            )
                          })()}

                          {/* Send FU1 / FU2 / FU3 */}
                          {[
                            { key: 'fu1', label: 'FU1', num: 1, time: lead.followUp1, sentAt: lead.followUp1SentAt, boolSent: lead.followUp1Sent },
                            { key: 'fu2', label: 'FU2', num: 2, time: lead.followUp2, sentAt: lead.followUp2SentAt, boolSent: lead.followUp2Sent },
                            { key: 'fu3', label: 'FU3', num: 3, time: lead.followUp3, sentAt: lead.followUp3SentAt, boolSent: lead.followUp3Sent },
                          ].map(({ key, label, time, sentAt, boolSent }) => {
                            const isSent      = !!(sentAt || boolSent)
                            const isDue       = time && new Date(time).getTime() <= Date.now()
                            const isBlocked   = STOP_STATUSES.includes(lead.status)
                            const notScheduled = !time
                            const notDue      = time && !isDue
                            const isSending   = sendingId === `${key}-${lead.id}`
                            const disabled    = isSent || isBlocked || notScheduled || notDue || isSending

                            let btnLabel = `Send ${label}`
                            if (isSent)        btnLabel = `✓ ${label} Sent`
                            else if (notScheduled) btnLabel = `${label} N/A`
                            else if (notDue)   btnLabel = `${label} Not Due`
                            else if (isBlocked) btnLabel = `${label} Blocked`

                            return (
                              <button
                                key={key}
                                disabled={disabled}
                                onClick={() => handleSend(lead.id, key)}
                                title={
                                  isSent        ? `Sent ${fmtDateTime(sentAt)}` :
                                  notDue        ? `Due ${fmtDateTime(time)}` :
                                  isBlocked     ? `Blocked — lead is ${lead.status}` :
                                  notScheduled  ? 'No follow-up scheduled' :
                                  'Send via Telegram'
                                }
                                className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                                  isSent        ? 'border-green-200 bg-green-50 text-green-700 opacity-70' :
                                  disabled      ? 'border-gray-200 text-gray-400 opacity-50' :
                                                  'border-purple-300 text-purple-700 hover:bg-purple-50'
                                }`}
                              >
                                {isSending ? '…' : btnLabel}
                              </button>
                            )
                          })}
                        </div>

                        {/* Quick action buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs text-gray-400 font-medium">Quick action:</span>
                          {[
                            { s: 'contacted', label: 'Mark Contacted', cls: 'border-blue-200 text-blue-600 hover:bg-blue-100' },
                            { s: 'engaged', label: 'Mark Engaged', cls: 'border-yellow-200 text-yellow-700 hover:bg-yellow-50' },
                            { s: 'interested', label: 'Mark Interested', cls: 'border-green-200 text-green-700 hover:bg-green-50' },
                            { s: 'closed', label: 'Mark Closed', cls: 'border-red-200 text-red-500 hover:bg-red-50' },
                          ].map(({ s, label, cls }) => (
                            <button
                              key={s}
                              disabled={updatingId === lead.id || lead.status === s}
                              onClick={() => handleStatusChange(lead.id, s)}
                              className={`rounded border px-2 py-0.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        pages={result.pages}
        total={result.total}
        onPage={setPage}
      />
    </div>
  )
}

// ── Conversion Trigger Panel ─────────────────────────────────────────────────

const CONVERSION_STAGE_STYLE = {
  none:            'bg-gray-100 text-gray-500',
  interested:      'bg-blue-100 text-blue-700',
  offer_sent:      'bg-amber-100 text-amber-700',
  payment_pending: 'bg-orange-100 text-orange-700',
  converted:       'bg-green-100 text-green-700',
  declined:        'bg-red-100 text-red-500',
}

const CONVERSION_PATH_STYLE = {
  product_offer: 'bg-teal-100 text-teal-700',
  consult_offer: 'bg-purple-100 text-purple-700',
  academy_offer: 'bg-violet-100 text-violet-700',
  no_offer:      'bg-gray-100 text-gray-500',
}

/**
 * Panel showing conversion state + manual action buttons for a lead.
 * Accepts an onRefresh callback so the lead list reloads after each action.
 */
function ConversionTriggerPanel({ lead, onRefresh }) {
  const [sending, setSending]         = useState(null)       // action key being sent
  const [toast, setToast]             = useState(null)       // { type: 'ok'|'err', msg: string }
  const [showCustomModal, setShowCustomModal] = useState(false)

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleAction(actionType) {
    setSending(actionType)
    try {
      let result
      if (actionType === 'resend_payment') {
        result = await resendConversionPaymentLink(lead.id, 'admin')
      } else {
        result = await sendManualConversionAction(lead.id, actionType, 'admin')
      }
      showToast('ok', `Sent! Preview: ${result.sentPreview?.slice(0, 80) || '—'}`)
      onRefresh()
    } catch (err) {
      showToast('err', err?.message || 'Send failed')
    } finally {
      setSending(null)
    }
  }

  const hasConversionData =
    lead.conversionStage ||
    lead.conversionPath ||
    lead.lastConversionIntent ||
    lead.productOfferSent ||
    lead.productOfferStatus ||
    lead.conversionOfferSendAfter ||
    lead.lastManualActionType

  return (
    <div className="rounded-lg border border-rose-100 bg-rose-50/30 px-3 py-2.5 space-y-2.5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-rose-700 uppercase tracking-wide">Conversion Trigger</span>

        {lead.conversionStage && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${CONVERSION_STAGE_STYLE[lead.conversionStage] || 'bg-gray-100 text-gray-500'}`}>
            {lead.conversionStage.replace(/_/g, ' ')}
          </span>
        )}
        {lead.conversionPath && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${CONVERSION_PATH_STYLE[lead.conversionPath] || 'bg-gray-100 text-gray-500'}`}>
            {lead.conversionPath.replace(/_/g, ' ')}
          </span>
        )}
        {lead.conversionAttempts > 0 && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
            {lead.conversionAttempts} attempt{lead.conversionAttempts !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* State grid */}
      {hasConversionData && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {[
            { label: 'Last Intent',    value: lead.lastConversionIntent?.replace(/_/g, ' ') },
            { label: 'Triggered',      value: lead.lastConversionTriggerAt ? fmtDateTime(lead.lastConversionTriggerAt) : null },
            { label: 'Manual Action',  value: lead.lastManualActionType?.replace(/_/g, ' ') },
            { label: 'Manual By',      value: lead.lastManualActionBy },
            { label: 'Manual At',      value: lead.lastManualActionAt ? fmtDateTime(lead.lastManualActionAt) : null },
            { label: 'Queued Offer',   value: lead.conversionOfferPath ? `${lead.conversionOfferPath.replace(/_/g, ' ')} (${lead.conversionOfferStatus || 'pending'})` : null },
            { label: 'Queued At',      value: lead.conversionOfferSendAfter ? fmtDateTime(lead.conversionOfferSendAfter) : null },
          ].filter(f => f.value).map(({ label, value }) => (
            <div key={label} className="flex gap-1.5">
              <span className="shrink-0 font-medium text-gray-400 w-24">{label}:</span>
              <span className="text-gray-700 capitalize">{value}</span>
            </div>
          ))}

          {/* Offer send statuses */}
          {[
            { label: 'Product Offer', status: lead.productOfferStatus || (lead.productOfferSent ? 'sent' : null), sentAt: lead.productOfferSentAt },
          ].filter(s => s.status).map(({ label, status, sentAt }) => {
            const cm = { sent: 'text-green-700 bg-green-100', failed: 'text-red-600 bg-red-100', blocked: 'text-amber-700 bg-amber-100', pending: 'text-blue-700 bg-blue-100', skipped: 'text-gray-500 bg-gray-100' }
            return (
              <div key={label} className="flex items-center gap-1.5">
                <span className="shrink-0 text-gray-400 w-24">{label}:</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cm[status] || 'text-gray-500 bg-gray-100'}`}>
                  {status}{sentAt ? ' ✓' : ''}
                </span>
                {sentAt && <span className="text-gray-400 text-[10px]">{fmtDateTime(sentAt)}</span>}
              </div>
            )
          })}

          {/* Manual override note */}
          {lead.manualOverrideNote && (
            <div className="col-span-2 sm:col-span-3 flex gap-1.5 pt-0.5">
              <span className="shrink-0 font-medium text-gray-400 w-24">Note:</span>
              <span className="text-gray-600 italic">{lead.manualOverrideNote.slice(0, 120)}</span>
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`rounded px-3 py-1.5 text-xs font-medium ${toast.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.type === 'ok' ? '✓ ' : '✗ '}{toast.msg}
        </div>
      )}

      {/* Manual action buttons */}
      <div className="flex flex-wrap gap-1.5" onClick={e => e.stopPropagation()}>
        <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wide self-center">Manual Send:</span>

        {[
          { key: 'product_offer',  label: 'Product Offer',  color: 'border-teal-300 text-teal-700 hover:bg-teal-50',     sentFlag: lead.productOfferSent },
          { key: 'consult_offer',  label: 'Consult Offer',  color: 'border-purple-300 text-purple-700 hover:bg-purple-50', sentFlag: lead.consultOfferSent },
          { key: 'academy_offer',  label: 'Academy Offer',  color: 'border-violet-300 text-violet-700 hover:bg-violet-50', sentFlag: lead.academyOfferSent },
          { key: 'resend_payment', label: 'Resend Payment', color: 'border-orange-300 text-orange-700 hover:bg-orange-50', sentFlag: false },
        ].map(({ key, label, color, sentFlag }) => {
          const isSending = sending === key
          return (
            <button
              key={key}
              disabled={isSending || !lead.telegramChatId}
              onClick={() => handleAction(key)}
              title={
                !lead.telegramChatId ? 'Telegram not connected' :
                sentFlag ? `Already sent once — click to resend` :
                `Send ${label} now via Telegram`
              }
              className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                sentFlag ? `${color} opacity-70` : color
              }`}
            >
              {isSending ? '…' : sentFlag ? `↻ ${label}` : label}
            </button>
          )
        })}

        {/* Custom message button */}
        <button
          disabled={!lead.telegramChatId}
          onClick={e => { e.stopPropagation(); setShowCustomModal(true) }}
          title={!lead.telegramChatId ? 'Telegram not connected' : 'Write and send a custom message'}
          className="rounded border border-gray-300 text-gray-600 px-2 py-0.5 text-[11px] font-medium hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Custom Message
        </button>
      </div>

      {/* Custom message modal */}
      {showCustomModal && (
        <CustomMessageModal
          lead={lead}
          onClose={() => setShowCustomModal(false)}
          onSent={(preview) => {
            showToast('ok', `Sent! Preview: ${preview?.slice(0, 80) || '—'}`)
            setShowCustomModal(false)
            onRefresh()
          }}
          onError={(msg) => showToast('err', msg)}
        />
      )}
    </div>
  )
}

// ── Conversation Brain Panel ─────────────────────────────────────────────────

const CONV_MODE_STYLE = {
  intake:               'bg-gray-100 text-gray-600',
  diagnosis_sent:       'bg-blue-100 text-blue-700',
  checkin_active:       'bg-cyan-100 text-cyan-700',
  product_reco_active:  'bg-teal-100 text-teal-700',
  academy_pitch_active: 'bg-violet-100 text-violet-700',
  consult_active:       'bg-purple-100 text-purple-700',
  payment_pending:      'bg-orange-100 text-orange-700',
  human_manual_mode:    'bg-amber-100 text-amber-800',
  closed:               'bg-red-100 text-red-600',
}

const INTENT_STYLE = {
  greeting:               'bg-gray-100 text-gray-500',
  routine_feedback:       'bg-green-100 text-green-700',
  irritation_or_side_effect: 'bg-red-100 text-red-600',
  product_question:       'bg-teal-100 text-teal-700',
  product_buying_intent:  'bg-emerald-100 text-emerald-700',
  academy_interest:       'bg-violet-100 text-violet-700',
  academy_objection:      'bg-purple-100 text-purple-600',
  consult_interest:       'bg-indigo-100 text-indigo-700',
  payment_question:       'bg-orange-100 text-orange-700',
  thanks_acknowledgement: 'bg-gray-100 text-gray-500',
  stop_or_not_interested: 'bg-red-100 text-red-700',
  unclear:                'bg-gray-100 text-gray-400',
}

/**
 * Panel showing Conversation Brain state — mode, intent history, mute status,
 * suppression flags, and offer count metrics.
 * Read-only display — no actions.
 */
function ConversationBrainPanel({ lead }) {
  const hasBrainData =
    lead.conversationMode ||
    lead.lastUserIntent   ||
    lead.lastBotIntent    ||
    lead.botMutedUntil    ||
    lead.followupSuppressed ||
    (lead.academyPitchCount > 0) ||
    (lead.productOfferCount > 0) ||
    (lead.consultOfferCount > 0)

  if (!hasBrainData) return null

  const now          = new Date()
  const muteActive   = lead.botMutedUntil && new Date(lead.botMutedUntil) > now
  const muteMinutes  = muteActive
    ? Math.ceil((new Date(lead.botMutedUntil) - now) / 60000)
    : 0

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-2.5 space-y-2.5">

      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-indigo-700 uppercase tracking-wide">Conversation Brain</span>

        {lead.conversationMode && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${CONV_MODE_STYLE[lead.conversationMode] || 'bg-gray-100 text-gray-500'}`}>
            {lead.conversationMode.replace(/_/g, ' ')}
          </span>
        )}

        {/* Mute indicator */}
        {muteActive && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
            🔇 muted {muteMinutes}m remaining
          </span>
        )}
        {lead.followupSuppressed && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
            suppressed
          </span>
        )}
      </div>

      {/* State grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">

        {/* Last user intent */}
        {lead.lastUserIntent && (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">User intent:</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${INTENT_STYLE[lead.lastUserIntent] || 'bg-gray-100 text-gray-500'}`}>
              {lead.lastUserIntent.replace(/_/g, ' ')}
            </span>
          </div>
        )}
        {lead.lastMeaningfulUserAt && (
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">User at:</span>
            <span className="text-gray-600">{fmtDateTime(lead.lastMeaningfulUserAt)}</span>
          </div>
        )}

        {/* Last bot intent */}
        {lead.lastBotIntent && (
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">Bot intent:</span>
            <span className="text-gray-700 capitalize">{lead.lastBotIntent.replace(/_/g, ' ')}</span>
          </div>
        )}
        {lead.lastMeaningfulBotAt && (
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">Bot at:</span>
            <span className="text-gray-600">{fmtDateTime(lead.lastMeaningfulBotAt)}</span>
          </div>
        )}

        {/* Active offer + awaiting */}
        {lead.activeOffer && (
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">Active offer:</span>
            <span className="text-gray-700 capitalize font-medium">{lead.activeOffer}</span>
          </div>
        )}
        {lead.awaitingReplyFor && (
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">Awaiting:</span>
            <span className="text-gray-600 capitalize">{lead.awaitingReplyFor.replace(/_/g, ' ')}</span>
          </div>
        )}

        {/* Mute expiry */}
        {lead.botMutedUntil && (
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">Mute until:</span>
            <span className={muteActive ? 'text-amber-700 font-medium' : 'text-gray-400 line-through'}>
              {fmtDateTime(lead.botMutedUntil)}
            </span>
          </div>
        )}

        {/* Suppression reason */}
        {lead.actionBlockedReason && (
          <div className="col-span-2 sm:col-span-3 flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-24">Suppressed:</span>
            <span className="text-amber-700 font-mono text-[10px]">{lead.actionBlockedReason}</span>
          </div>
        )}
      </div>

      {/* Offer counter pills */}
      {((lead.academyPitchCount > 0) || (lead.productOfferCount > 0) || (lead.consultOfferCount > 0)) && (
        <div className="flex flex-wrap gap-1.5 border-t border-indigo-100 pt-2">
          <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide self-center mr-1">Pitches sent:</span>
          {lead.academyPitchCount > 0 && (
            <span className="rounded bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
              Academy ×{lead.academyPitchCount}
            </span>
          )}
          {lead.productOfferCount > 0 && (
            <span className="rounded bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">
              Product ×{lead.productOfferCount}
            </span>
          )}
          {lead.consultOfferCount > 0 && (
            <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
              Consult ×{lead.consultOfferCount}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Modal for composing and sending a custom conversion message.
 * Pre-fills the textarea with a context-aware draft fetched from the backend.
 */
function CustomMessageModal({ lead, onClose, onSent, onError }) {
  const [draft, setDraft]       = useState('')
  const [loading, setLoading]   = useState(true)
  const [sending, setSending]   = useState(false)
  const textareaRef             = useRef(null)

  useEffect(() => {
    fetchConversionContext(lead.id)
      .then(data => { setDraft(data.draft || ''); setLoading(false) })
      .catch(() => {
        // Fallback draft if fetch fails
        setDraft(`Hi ${lead.fullName.split(' ')[0]},\n\nFollowing up on your skincare journey — let me know if you have any questions or need guidance.`)
        setLoading(false)
      })
  }, [lead.id])

  useEffect(() => {
    if (!loading && textareaRef.current) textareaRef.current.focus()
  }, [loading])

  async function handleSend() {
    if (!draft.trim()) return
    setSending(true)
    try {
      const result = await sendConversionCustomMessage(lead.id, draft, 'admin')
      onSent(result.sentPreview)
    } catch (err) {
      onError(err?.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <p className="font-semibold text-gray-800 text-sm">Send Custom Message</p>
            <p className="text-xs text-gray-400">{lead.fullName} · {lead.telegramChatId ? `Telegram ${lead.telegramChatId}` : 'No channel'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {/* Context badge */}
        {(lead.primaryConcern || lead.followUpIntent || lead.diagnosisSummary) && (
          <div className="bg-gray-50 border-b border-gray-100 px-4 py-2 flex flex-wrap gap-2 text-xs text-gray-500">
            {lead.primaryConcern && <span className="rounded bg-indigo-100 text-indigo-700 px-1.5 py-0.5 font-medium capitalize">{lead.primaryConcern.replace(/_/g, ' ')}</span>}
            {lead.followUpIntent && <span className="rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 font-medium capitalize">Intent: {lead.followUpIntent.replace(/_/g, ' ')}</span>}
            {lead.urgencyLevel && <span className={`rounded px-1.5 py-0.5 font-medium capitalize ${lead.urgencyLevel === 'high' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>Urgency: {lead.urgencyLevel}</span>}
          </div>
        )}

        {/* Textarea */}
        <div className="px-4 py-3">
          {loading ? (
            <div className="text-center text-xs text-gray-400 py-6">Loading context draft…</div>
          ) : (
            <textarea
              ref={textareaRef}
              rows={8}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-1 focus:ring-rose-100 resize-none font-mono"
              placeholder="Write your message…"
            />
          )}
          <p className="text-[10px] text-gray-400 mt-1">{draft.length} chars · Sent via Telegram</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            disabled={sending || loading || !draft.trim() || !lead.telegramChatId}
            onClick={handleSend}
            className="rounded bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Premium helpers ───────────────────────────────────────────────────────────

/**
 * Inline editor for delivery notes + owner fields inside the premium pipeline panel.
 * Renders as read-only text with an Edit button; clicking Edit shows a mini form.
 */
function DeliveryNotesEditor({ regId, notes, owner, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draftNotes, setDraftNotes] = useState(notes)
  const [draftOwner, setDraftOwner] = useState(owner)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ deliveryNotes: draftNotes, deliveryOwner: draftOwner })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2 text-xs">
        <div className="flex-1 space-y-0.5">
          {owner && <p><span className="text-gray-400">Owner:</span> <span className="font-medium text-gray-700">{owner}</span></p>}
          {notes
            ? <p className="text-gray-500 italic">{notes.slice(0, 200)}{notes.length > 200 ? '…' : ''}</p>
            : <p className="text-gray-300 italic">No delivery notes yet</p>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
          className="shrink-0 rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50"
        >
          Edit notes
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 text-xs" onClick={e => e.stopPropagation()}>
      <input
        type="text"
        placeholder="Owner name…"
        value={draftOwner}
        onChange={e => setDraftOwner(e.target.value)}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs outline-none focus:border-amber-300"
      />
      <textarea
        rows={3}
        placeholder="Delivery notes…"
        value={draftNotes}
        onChange={e => setDraftNotes(e.target.value)}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs outline-none focus:border-amber-300 resize-none"
      />
      <div className="flex gap-2">
        <button
          disabled={saving}
          onClick={handleSave}
          className="rounded border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs text-green-700 hover:bg-green-100 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded border border-gray-200 px-2.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Academy Operator Control Panel ───────────────────────────────────────────

function AcademyOperatorPanel({ reg, actioningId, onAction }) {
  const now = new Date()

  // ── Routing decision for debug panel ────────────────────────────────────────
  let routingDecision
  if (reg.implementationClient) routingDecision = 'Premium onboarding (Tier 1)'
  else if (reg.academyStatus === 'revoked') routingDecision = 'Access revoked — blocked'
  else if (reg.academyStatus === 'enrolled' || reg.academyStatus === 'graduated') routingDecision = 'Academy lesson flow (Tier 2)'
  else routingDecision = 'Pre-enrollment — awaiting payment (Tier 3)'

  const nextLessonDue = reg.academyLessonStatus === 'lesson_unlocked' &&
    reg.nextLessonUnlockAt &&
    new Date(reg.nextLessonUnlockAt) <= now

  const nextLessonOverdue = nextLessonDue
    ? Math.round((now - new Date(reg.nextLessonUnlockAt)) / 60000)
    : null

  const nextLessonInMin = reg.nextLessonUnlockAt && new Date(reg.nextLessonUnlockAt) > now
    ? Math.round((new Date(reg.nextLessonUnlockAt) - now) / 60000)
    : null

  const lastOutbound = reg.currentLesson > 0
    ? `Lesson ${reg.currentLesson} sent`
    : reg.onboardingStatus
    ? `Onboarding (${reg.onboardingStatus})`
    : '—'

  // ── State inspection fields ──────────────────────────────────────────────────
  const STATE_FIELDS = [
    { label: 'Academy Status',    value: reg.academyStatus,         highlight: reg.academyStatus === 'revoked' ? 'red' : reg.academyStatus === 'graduated' ? 'green' : 'default' },
    { label: 'Lesson Status',     value: reg.academyLessonStatus,   highlight: reg.academyPaused ? 'amber' : 'default' },
    { label: 'Current Lesson',    value: reg.currentLesson > 0 ? `${reg.currentLesson} / 5` : 'not started' },
    { label: 'Completed',         value: `${reg.lessonsCompleted || 0} / 5` },
    { label: 'CTA Status',        value: reg.lessonCtaStatus || '—' },
    { label: 'Paused',            value: reg.academyPaused ? 'YES' : 'no', highlight: reg.academyPaused ? 'amber' : 'default' },
    { label: 'Last Sent',         value: reg.lastLessonSentAt ? fmtDateTime(reg.lastLessonSentAt) : '—' },
    { label: 'Last Completed',    value: reg.lastLessonCompletedAt ? fmtDateTime(reg.lastLessonCompletedAt) : '—' },
    { label: 'Next Unlock',       value: reg.nextLessonUnlockAt ? fmtDateTime(reg.nextLessonUnlockAt) : '—', highlight: nextLessonDue ? 'green' : 'default' },
    { label: 'Graduated At',      value: reg.academyCompletionAt ? fmtDateTime(reg.academyCompletionAt) : '—' },
    { label: 'Last Inbound',      value: reg.lastInboundAt ? fmtDateTime(reg.lastInboundAt) : '—' },
  ]

  const highlightClass = {
    red:     'text-red-700 font-bold',
    green:   'text-green-700 font-bold',
    amber:   'text-amber-700 font-bold',
    default: 'text-gray-700',
  }

  // ── Action buttons ───────────────────────────────────────────────────────────
  const ACTIONS = [
    {
      action: 'resend-lesson',
      label: `Resend Lesson ${reg.currentLesson || '—'}`,
      color: 'blue',
      disabled: !reg.currentLesson || reg.academyStatus === 'revoked',
    },
    {
      action: 'unlock-next',
      label: `Unlock Lesson ${(reg.currentLesson || 0) + 1}`,
      color: 'indigo',
      disabled: !reg.telegramChatId || reg.academyLessonStatus === 'graduated' || reg.academyStatus === 'revoked' || (reg.currentLesson || 0) >= 5,
    },
    {
      action: 'pause',
      label: 'Pause',
      color: 'amber',
      disabled: !!reg.academyPaused || reg.academyStatus === 'revoked',
    },
    {
      action: 'resume',
      label: 'Resume',
      color: 'emerald',
      disabled: !reg.academyPaused,
    },
    {
      action: 'complete-lesson',
      label: 'Complete Lesson',
      color: 'teal',
      disabled: reg.academyLessonStatus !== 'lesson_active' || reg.academyStatus === 'revoked',
    },
    {
      action: 'graduate',
      label: 'Graduate',
      color: 'purple',
      disabled: reg.academyLessonStatus === 'graduated' || reg.academyStatus === 'revoked',
      confirm: 'Graduate this member immediately? This sends the graduation message.',
    },
    {
      action: 'revoke',
      label: 'Revoke Access',
      color: 'red',
      disabled: reg.academyStatus === 'revoked',
      confirm: `Revoke ${reg.fullName}'s academy access? This blocks bot routing immediately.`,
    },
  ]

  const btnColor = {
    blue:    'border-blue-200 text-blue-700 hover:bg-blue-50',
    indigo:  'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
    amber:   'border-amber-200 text-amber-700 hover:bg-amber-50',
    emerald: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
    teal:    'border-teal-200 text-teal-700 hover:bg-teal-50',
    purple:  'border-purple-200 text-purple-700 hover:bg-purple-50',
    red:     'border-red-200 text-red-700 hover:bg-red-50',
  }

  return (
    <div className="rounded-xl border border-green-200 bg-white px-4 py-3 space-y-4" onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-green-800 uppercase tracking-wide">Academy Operator Controls</span>
        {reg.academyPaused && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">PAUSED</span>
        )}
        {reg.academyStatus === 'revoked' && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 uppercase tracking-wide">REVOKED</span>
        )}
      </div>

      {/* ── State inspection grid ─────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1.5">Member State</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          {STATE_FIELDS.map(({ label, value, highlight = 'default' }) => (
            <div key={label} className="flex gap-1.5">
              <span className="shrink-0 text-gray-400 w-28">{label}:</span>
              <span className={`capitalize ${highlightClass[highlight]}`}>
                {value || '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Action buttons ────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1.5">Actions</p>
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map(({ action, label, color, disabled, confirm: confirmMsg }) => {
            const isActioning = actioningId === `${reg.id}-op-${action}`
            return (
              <button
                key={action}
                disabled={disabled || !!actioningId}
                onClick={() => onAction(action, confirmMsg)}
                className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  disabled ? 'border-gray-200 text-gray-400' : btnColor[color]
                }`}
              >
                {isActioning ? '…' : label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Debug panel ──────────────────────────────────────────────────────── */}
      <div className="border-t border-green-100 pt-3">
        <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1.5">Debug</p>
        <div className="grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-32">Routing:</span>
            <span className={`font-semibold ${
              reg.academyStatus === 'revoked' ? 'text-red-700' :
              reg.implementationClient ? 'text-amber-700' :
              reg.academyStatus === 'enrolled' || reg.academyStatus === 'graduated' ? 'text-green-700' :
              'text-gray-500'
            }`}>{routingDecision}</span>
          </div>
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-32">Academy mode:</span>
            <span className={`font-semibold ${
              reg.academyStatus === 'enrolled' || reg.academyStatus === 'graduated' ? 'text-green-700' : 'text-gray-400'
            }`}>
              {reg.academyStatus === 'enrolled' || reg.academyStatus === 'graduated' ? 'active' : 'inactive'}
            </span>
          </div>
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-32">Automation:</span>
            <span className={`font-semibold ${reg.academyPaused ? 'text-amber-700' : 'text-green-700'}`}>
              {reg.academyPaused ? 'paused' : 'running'}
            </span>
          </div>
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-32">Next lesson:</span>
            <span className={`font-semibold ${nextLessonDue ? 'text-orange-600' : 'text-gray-600'}`}>
              {nextLessonDue
                ? `overdue by ${nextLessonOverdue}m`
                : nextLessonInMin !== null
                ? `in ${nextLessonInMin < 60 ? `${nextLessonInMin}m` : `${Math.round(nextLessonInMin / 60)}h`}`
                : '—'
              }
            </span>
          </div>
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-32">Last inbound:</span>
            <span className="text-gray-600">{reg.lastInboundAt ? fmtDateTime(reg.lastInboundAt) : '—'}</span>
          </div>
          <div className="flex gap-1.5">
            <span className="shrink-0 text-gray-400 w-32">Last outbound:</span>
            <span className="text-gray-600">{lastOutbound}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Academy Tab ───────────────────────────────────────────────────────────────

function AcademyTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [sourceTypeFilter, setSourceTypeFilter] = useState('')
  const [premiumFilter, setPremiumFilter] = useState(false)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ data: [], total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [actioningId, setActioningId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchRegistrations({ search, status: statusFilter, source: sourceFilter, sourceType: sourceTypeFilter, page, limit: 15 })
      .then(setResult)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [search, statusFilter, sourceFilter, sourceTypeFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter, sourceFilter, sourceTypeFilter, premiumFilter])

  async function handleStatusChange(id, status) {
    setUpdatingId(id)
    try {
      await updateRegistrationStatus(id, status)
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleDeliveryUpdate(id, fields) {
    setActioningId(id)
    try {
      await updateImplementationDelivery(id, fields)
      load()
    } catch (e) {
      console.error('[DeliveryUpdate]', e)
    } finally {
      setActioningId(null)
    }
  }

  async function handleTaskToggle(id, key, currentValue) {
    setActioningId(`${id}-${key}`)
    try {
      await updateImplementationTasks(id, { [key]: !currentValue })
      load()
    } catch (e) {
      console.error('[TaskToggle]', e)
    } finally {
      setActioningId(null)
    }
  }

  async function handleOperatorAction(id, action, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setActioningId(`${id}-op-${action}`)
    try {
      await academyOperatorAction(id, action)
      load()
    } catch (e) {
      console.error('[OperatorAction]', e)
      alert(e.message || 'Action failed')
    } finally {
      setActioningId(null)
    }
  }

  // Apply client-side premium filter on top of server results
  const displayRows = premiumFilter
    ? result.data.filter(r => r.implementationClient === true)
    : result.data

  return (
    <div className="space-y-4">
      {/* Quick-view buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setPremiumFilter(v => !v)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${premiumFilter ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
          💎 Premium clients only
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 flex-1 min-w-[200px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All statuses</option>
          {ACADEMY_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={sourceTypeFilter}
          onChange={(e) => setSourceTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          <option value="">All source types</option>
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Pipeline</th>
              <th className="px-4 py-3">Onboarding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">Loading…</td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">No registrations found</td>
              </tr>
            ) : displayRows.map((reg) => {
              const isPremium   = reg.implementationClient === true
              const isExpanded  = expandedId === reg.id
              const tasksTotal  = TASK_LABELS.length
              const tasksDone   = TASK_LABELS.filter(t => reg[t.key]).length
              return (
                <>
                  <tr
                    key={reg.id}
                    onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                    className={`transition-colors cursor-pointer ${
                      isPremium
                        ? 'bg-amber-50/60 hover:bg-amber-50 border-l-4 border-l-amber-400'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-1.5">
                        {isPremium && <span title="Premium implementation client">💎</span>}
                        <span>{reg.fullName}</span>
                        {reg.telegramStarted && (
                          <span className="text-blue-300 text-xs" title="Telegram connected">✈</span>
                        )}
                      </div>
                      {reg.businessType && (
                        <div className="text-xs text-gray-400">{reg.businessType}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <div>{reg.email}</div>
                      {reg.phone && <div className="text-xs">{reg.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-600">{reg.sourcePlatform}</div>
                      {reg.sourceType && <div className="text-xs text-gray-400">{reg.sourceType.replace(/_/g, ' ')}</div>}
                      {reg.handle && <div className="text-xs text-gray-400">@{reg.handle}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(reg.createdAt)}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <select
                        value={reg.status}
                        disabled={updatingId === reg.id}
                        onChange={(e) => handleStatusChange(reg.id, e.target.value)}
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-400 disabled:opacity-50"
                      >
                        {ACADEMY_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {reg.academyPackage ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold capitalize ${
                          isPremium ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {reg.academyPackage}
                          {reg.academyAmount ? ` ₦${reg.academyAmount.toLocaleString()}` : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {reg.paymentStatus ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                          reg.paymentStatus === 'paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {reg.paymentStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isPremium && reg.implementationStage ? (
                        <div>
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold capitalize ${IMPL_STAGE_STYLE[reg.implementationStage] || 'bg-gray-100 text-gray-600'}`}>
                            {reg.implementationStage.replace(/_/g, ' ')}
                          </span>
                          <div className="mt-1 text-[10px] text-amber-600 font-medium">
                            {tasksDone}/{tasksTotal} tasks
                          </div>
                        </div>
                      ) : reg.academyStatus ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                          reg.academyStatus === 'enrolled' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {reg.academyStatus.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {reg.onboardingStatus ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                          reg.onboardingStatus === 'sent'
                            ? 'bg-purple-100 text-purple-700'
                            : reg.onboardingStatus === 'failed'
                            ? 'bg-red-100 text-red-600'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {reg.onboardingStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                      {reg.onboardingSentAt && (
                        <div className="text-xs text-gray-400">{fmtDateTime(reg.onboardingSentAt)}</div>
                      )}
                    </td>
                  </tr>

                  {/* ── Expanded detail row ──────────────────────────────── */}
                  {isExpanded && (
                    <tr key={`${reg.id}-detail`} className={isPremium ? 'bg-amber-50/40' : 'bg-blue-50/30'}>
                      <td colSpan={9} className="px-4 py-4 space-y-4">

                        {/* ── Premium Pipeline Panel ─────────────────────── */}
                        {isPremium && (
                          <div className="rounded-xl border border-amber-200 bg-white px-4 py-3 space-y-4">
                            {/* Header */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-amber-800 uppercase tracking-wide">💎 Implementation Pipeline</span>
                              {reg.implementationStatus && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  reg.implementationStatus === 'active'    ? 'bg-green-100 text-green-700' :
                                  reg.implementationStatus === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                  reg.implementationStatus === 'paused'    ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                  {reg.implementationStatus}
                                </span>
                              )}
                              {reg.deliveryOwner && (
                                <span className="text-xs text-gray-500">Owner: <span className="font-medium text-gray-700">{reg.deliveryOwner}</span></span>
                              )}
                            </div>

                            {/* Stage progress bar */}
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap gap-1">
                                {IMPL_STAGES.map((s) => {
                                  const idx        = IMPL_STAGES.indexOf(s)
                                  const currentIdx = IMPL_STAGES.indexOf(reg.implementationStage)
                                  const isDone     = idx < currentIdx
                                  const isCurrent  = idx === currentIdx
                                  return (
                                    <span
                                      key={s}
                                      title={s.replace(/_/g, ' ')}
                                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                                        isCurrent ? (IMPL_STAGE_STYLE[s] || 'bg-gray-200 text-gray-700') + ' ring-1 ring-offset-1 ring-current' :
                                        isDone    ? 'bg-gray-100 text-gray-400 line-through' :
                                                    'bg-gray-50 text-gray-300'
                                      }`}
                                    >
                                      {isCurrent ? '▶ ' : isDone ? '✓ ' : ''}{s.replace(/_/g, ' ')}
                                    </span>
                                  )
                                })}
                              </div>
                            </div>

                            {/* Key state row */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
                              {[
                                { label: 'Intake',      value: reg.premiumIntakeStatus,  completedAt: reg.premiumIntakeCompletedAt },
                                { label: 'Call booked', value: reg.implementationCallBooked ? 'yes' : 'no',
                                  completedAt: reg.implementationCallBookedAt },
                                { label: 'System setup', value: reg.systemSetupStatus?.replace(/_/g, ' ') },
                                { label: 'Delivered',   value: reg.deliveryCompletedAt ? 'yes' : '—',
                                  completedAt: reg.deliveryCompletedAt },
                              ].map(({ label, value, completedAt }) => (
                                <div key={label} className="flex gap-1.5">
                                  <span className="shrink-0 text-gray-400 w-20">{label}:</span>
                                  <span className={`font-semibold capitalize ${
                                    value === 'complete' || value === 'yes' ? 'text-green-700' :
                                    value === 'in_progress' || value === 'in progress' ? 'text-blue-700' :
                                    value === 'no' || value === '—' ? 'text-gray-400' :
                                    'text-amber-700'
                                  }`}>
                                    {value || '—'}
                                  </span>
                                  {completedAt && (
                                    <span className="text-gray-400 text-[10px] self-center">{fmtDateTime(completedAt)}</span>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Task checklist */}
                            <div className="border-t border-amber-100 pt-3">
                              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">Operational Checklist</p>
                              <div className="flex flex-wrap gap-2">
                                {TASK_LABELS.map(({ key, label }) => {
                                  const done      = !!reg[key]
                                  const isActioning = actioningId === `${reg.id}-${key}`
                                  return (
                                    <button
                                      key={key}
                                      disabled={isActioning}
                                      onClick={(e) => { e.stopPropagation(); handleTaskToggle(reg.id, key, done) }}
                                      className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                                        done
                                          ? 'border-green-300 bg-green-50 text-green-700 line-through'
                                          : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                      }`}
                                    >
                                      {isActioning ? '…' : done ? `✓ ${label}` : label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>

                            {/* Stage advance controls */}
                            <div className="border-t border-amber-100 pt-3 space-y-2" onClick={e => e.stopPropagation()}>
                              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Advance Stage</p>
                              <div className="flex flex-wrap gap-2">
                                {[
                                  { stage: 'review_pending',         label: 'Mark: Review pending' },
                                  { stage: 'strategy_call_pending',  label: 'Mark: Call pending' },
                                  { stage: 'strategy_call_booked',   label: 'Mark: Call booked',
                                    extra: { implementationCallBooked: true } },
                                  { stage: 'build_pending',          label: 'Mark: Build pending' },
                                  { stage: 'build_in_progress',      label: 'Mark: Build started' },
                                  { stage: 'delivered',              label: 'Mark: Delivered' },
                                  { stage: 'active',                 label: 'Mark: Active' },
                                ].map(({ stage, label, extra }) => {
                                  const isCurrent = reg.implementationStage === stage
                                  const isActioning_ = actioningId === reg.id
                                  return (
                                    <button
                                      key={stage}
                                      disabled={isCurrent || isActioning_}
                                      onClick={() => handleDeliveryUpdate(reg.id, { implementationStage: stage, ...extra })}
                                      className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                                        isCurrent
                                          ? 'border-amber-300 bg-amber-100 text-amber-800 font-bold'
                                          : 'border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40'
                                      }`}
                                    >
                                      {isActioning_ ? '…' : label}
                                    </button>
                                  )
                                })}
                              </div>

                              {/* System setup + delivery notes */}
                              <div className="flex flex-wrap gap-2 pt-1">
                                {['not_started', 'in_progress', 'complete'].map(s => (
                                  <button
                                    key={s}
                                    disabled={reg.systemSetupStatus === s || actioningId === reg.id}
                                    onClick={() => handleDeliveryUpdate(reg.id, { systemSetupStatus: s })}
                                    className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed capitalize ${
                                      reg.systemSetupStatus === s
                                        ? (SETUP_STATUS_STYLE[s] || 'bg-gray-100 text-gray-500') + ' font-bold'
                                        : 'border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40'
                                    }`}
                                  >
                                    Setup: {s.replace(/_/g, ' ')}
                                  </button>
                                ))}
                              </div>

                              {/* Delivery notes inline edit */}
                              <DeliveryNotesEditor
                                regId={reg.id}
                                notes={reg.deliveryNotes || ''}
                                owner={reg.deliveryOwner || ''}
                                onSave={(fields) => handleDeliveryUpdate(reg.id, fields)}
                              />
                            </div>

                            {/* Intake answers */}
                            {reg.premiumIntakeStatus === 'complete' && (
                              <div className="border-t border-amber-100 pt-3">
                                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
                                  Intake Answers
                                  {reg.premiumIntakeCompletedAt && (
                                    <span className="ml-2 text-[10px] font-normal text-gray-400">{fmtDateTime(reg.premiumIntakeCompletedAt)}</span>
                                  )}
                                </p>
                                <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-2 text-xs">
                                  {INTAKE_LABELS.map(({ key, label, bool }) => {
                                    const val = reg[key]
                                    if (val === null || val === undefined) return null
                                    const display = bool
                                      ? (val ? 'Yes' : 'No')
                                      : String(val)
                                    return (
                                      <div key={key} className="flex gap-1.5">
                                        <span className="shrink-0 font-medium text-gray-500 w-32">{label}:</span>
                                        <span className={`text-gray-700 italic ${bool && val ? 'text-green-700 not-italic font-semibold' : bool && !val ? 'text-gray-400' : ''}`}>
                                          {display.length > 120 ? display.slice(0, 120) + '…' : display}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Intake in-progress indicator */}
                            {reg.premiumIntakeStatus === 'in_progress' && (
                              <div className="border-t border-amber-100 pt-2">
                                <p className="text-xs text-amber-600 italic">
                                  Intake in progress — stage:{' '}
                                  <span className="font-semibold">{(reg.premiumIntakeStage || '').replace(/_/g, ' ')}</span>
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── Basic onboarding info (non-premium) ─────────── */}
                        {!isPremium && (
                          <div className="text-xs text-gray-500 space-y-1">
                            <div className="flex flex-wrap gap-4">
                              {reg.enrollmentStatus && (
                                <span><span className="font-medium text-gray-600">Enrollment:</span> {reg.enrollmentStatus}</span>
                              )}
                              {reg.onboardingPath && (
                                <span><span className="font-medium text-gray-600">Path:</span> {reg.onboardingPath}</span>
                              )}
                              {reg.onboardingSentAt && (
                                <span><span className="font-medium text-gray-600">Onboarded:</span> {fmtDateTime(reg.onboardingSentAt)}</span>
                              )}
                            </div>
                            {reg.goals && (
                              <p><span className="font-medium text-gray-600">Goals:</span> <span className="italic">{reg.goals}</span></p>
                            )}
                          </div>
                        )}

                        {/* ── Academy Operator Control Panel ───────────────── */}
                        {!isPremium && (reg.academyStatus === 'enrolled' || reg.academyStatus === 'graduated' || reg.academyStatus === 'revoked') && (
                          <AcademyOperatorPanel
                            reg={reg}
                            actioningId={actioningId}
                            onAction={(action, confirmMsg) => handleOperatorAction(reg.id, action, confirmMsg)}
                          />
                        )}

                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        pages={result.pages}
        total={result.total}
        onPage={setPage}
      />
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, pages, total, onPage }) {
  if (pages <= 1) return (
    <p className="text-xs text-gray-400">{total} record{total !== 1 ? 's' : ''}</p>
  )
  return (
    <div className="flex items-center justify-between text-sm">
      <p className="text-xs text-gray-400">{total} record{total !== 1 ? 's' : ''}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="text-xs text-gray-500">
          {page} / {pages}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}

// ── Scraping Tab ─────────────────────────────────────────────────────────────

const IMPORT_METRICS = [
  { label: 'Raw Fetched',      key: 'rawFetched',          color: 'text-gray-900' },
  { label: 'Dupes Skipped',    key: 'duplicatesSkipped',   color: 'text-gray-500' },
  { label: 'Sent to Pipeline', key: 'sentToProcessing',    color: 'text-blue-700' },
  { label: 'Processed',        key: 'processed',           color: 'text-gray-900' },
  { label: 'Qualified Leads',  key: 'qualifiedLeads',      color: 'text-green-700' },
  { label: 'Hot',              key: 'hot',                 color: 'text-red-600' },
  { label: 'Warm',             key: 'warm',                color: 'text-orange-500' },
  { label: 'Cold',             key: 'cold',                color: 'text-blue-500' },
  { label: 'Rejected',         key: 'rejected',            color: 'text-gray-400' },
  { label: 'No Text',          key: 'droppedMissingText',  color: 'text-yellow-600' },
  { label: 'Bad Shape',        key: 'droppedInvalidShape', color: 'text-yellow-600' },
  { label: 'Errors',           key: 'errors',              color: 'text-red-700' },
]

const DIAGNOSTICS_ROWS = [
  { label: 'Raw Fetched',              key: 'rawFetched' },
  { label: 'Dropped — invalid shape',  key: 'droppedInvalidShape' },
  { label: 'Duplicates skipped',       key: 'duplicatesSkipped' },
  { label: 'Dropped — missing text',   key: 'droppedMissingText' },
  { label: 'Sent to processing',       key: 'sentToProcessing' },
  { label: 'Processed (total)',        key: 'processed' },
  { label: '↳ Qualified leads',        key: 'qualifiedLeads' },
  { label: '  ↳ Hot',                  key: 'hot' },
  { label: '  ↳ Warm',                 key: 'warm' },
  { label: '↳ Rejected',               key: 'rejected' },
  { label: '↳ Cold (rejected tier)',   key: 'cold' },
  { label: 'Errors (item-level)',      key: 'errors' },
]

function ScrapingTab() {
  // ── Phase 15: Post discovery import ──────────────────────────────────────
  const [datasetId, setDatasetId]   = useState('')
  const [platform, setPlatform]     = useState('instagram')
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState(null)
  const [authStatus, setAuthStatus] = useState(null)

  // ── Phase 16: Comment target pipeline ────────────────────────────────────
  const [commentDatasetId, setCommentDatasetId]   = useState('')
  const [prepareLoading, setPrepareLoading]       = useState(false)
  const [prepareResult, setPrepareResult]         = useState(null)
  const [prepareError, setPrepareError]           = useState(null)

  const [harvestLimit, setHarvestLimit]   = useState('50')
  const [harvestLoading, setHarvestLoading] = useState(false)
  const [harvestResult, setHarvestResult]   = useState(null)
  const [harvestError, setHarvestError]     = useState(null)

  // ── Phase 16: Stage 4 — Import Comment Leads ──────────────────────────────
  const [commentImportDatasetId, setCommentImportDatasetId] = useState('')
  const [commentImportLoading, setCommentImportLoading]     = useState(false)
  const [commentImportResult, setCommentImportResult]       = useState(null)
  const [commentImportError, setCommentImportError]         = useState(null)

  const [targetStats, setTargetStats]   = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)

  useEffect(() => {
    fetchScrapingDebugAuth()
      .then(setAuthStatus)
      .catch(() => setAuthStatus({ routeLive: false, authenticated: false, adminSessionPresent: false }))
    loadTargetStats()
  }, [])

  function loadTargetStats() {
    setStatsLoading(true)
    fetchCommentTargetStats()
      .then(d => setTargetStats(d.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }

  async function handleImport() {
    if (!datasetId.trim()) {
      setError('Dataset ID is required.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await importInstagramDataset(datasetId.trim(), platform)
      setResult(data.data)
    } catch (err) {
      setError(err.message || 'Import failed. Check the server logs.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePrepare() {
    if (!commentDatasetId.trim()) {
      setPrepareError('Dataset ID is required.')
      return
    }
    setPrepareLoading(true)
    setPrepareError(null)
    setPrepareResult(null)
    try {
      const data = await prepareInstagramComments(commentDatasetId.trim())
      setPrepareResult(data.data)
      loadTargetStats()
    } catch (err) {
      setPrepareError(err.message || 'Prepare failed. Check the server logs.')
    } finally {
      setPrepareLoading(false)
    }
  }

  async function handleHarvest() {
    const limit = parseInt(harvestLimit) || 50
    setHarvestLoading(true)
    setHarvestError(null)
    setHarvestResult(null)
    try {
      const data = await runInstagramComments(limit)
      setHarvestResult(data.data)
      loadTargetStats()
    } catch (err) {
      setHarvestError(err.message || 'Harvest failed. Check the server logs.')
    } finally {
      setHarvestLoading(false)
    }
  }

  async function handleCommentImport() {
    if (!commentImportDatasetId.trim()) {
      setCommentImportError('Dataset ID is required.')
      return
    }
    setCommentImportLoading(true)
    setCommentImportError(null)
    setCommentImportResult(null)
    try {
      const data = await importInstagramCommentDataset(commentImportDatasetId.trim())
      setCommentImportResult(data.data)
    } catch (err) {
      setCommentImportError(err.message || 'Import failed. Check the server logs.')
    } finally {
      setCommentImportLoading(false)
    }
  }

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Instagram Scraping Pipeline</h2>
        <p className="text-sm text-gray-500 mt-1">
          Import discovery datasets, extract comment targets, and trigger harvests — no terminal required.
        </p>
      </div>

      {/* ── Route / auth health pill ── */}
      {authStatus && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
          authStatus.authenticated
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${
            authStatus.authenticated ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span>
            Route:&nbsp;<strong>{authStatus.routeLive ? 'live' : 'unreachable'}</strong>
            &nbsp;&middot;&nbsp;
            Auth:&nbsp;<strong>{authStatus.authenticated ? 'authenticated' : 'not authenticated'}</strong>
            &nbsp;&middot;&nbsp;
            Session:&nbsp;<strong>{authStatus.adminSessionPresent ? 'present' : 'missing'}</strong>
          </span>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          STAGE 1 — Post Discovery Import
          ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stage 1 — Import Discovery Dataset</h3>
          <p className="text-xs text-gray-400 mt-1">Fetch posts/hashtag data from an Apify dataset and ingest them as CRM leads.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Apify Dataset ID</label>
            <input
              type="text"
              value={datasetId}
              onChange={(e) => { setDatasetId(e.target.value); setError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleImport()}
              placeholder="e.g. abc123xyz456"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="instagram">Instagram</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleImport}
          disabled={loading || !datasetId.trim()}
          className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {loading ? 'Importing…' : 'Import Dataset'}
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {IMPORT_METRICS.map(({ label, key, color }) => (
                <div key={key} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-center">
                  <div className={`text-2xl font-bold ${color}`}>{result[key] ?? 0}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Diagnostics</h4>
              <dl className="space-y-1">
                {DIAGNOSTICS_ROWS.map(({ label, key }) => (
                  <div key={key} className="flex justify-between text-sm">
                    <dt className="text-gray-600 font-mono">{label}</dt>
                    <dd className={`font-semibold tabular-nums ${
                      key === 'errors' && (result[key] ?? 0) > 0 ? 'text-red-600' :
                      key === 'qualifiedLeads' && (result[key] ?? 0) > 0 ? 'text-green-700' :
                      'text-gray-900'
                    }`}>
                      {result[key] ?? 0}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-400 font-mono space-y-0.5">
                <div>rawFetched = droppedInvalidShape + duplicatesSkipped + droppedMissingText + sentToProcessing</div>
                <div>sentToProcessing = processed + errors</div>
                <div>processed = qualifiedLeads + rejected</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STAGE 2 — Prepare Comment Targets
          ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stage 2 — Prepare Comment Targets</h3>
          <p className="text-xs text-gray-400 mt-1">
            Extract valid post/reel URLs from a discovery dataset and queue them for comment scraping.
            Rejects hashtag explore and profile URLs. Deduplicates by shortcode.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Discovery Dataset ID</label>
          <input
            type="text"
            value={commentDatasetId}
            onChange={(e) => { setCommentDatasetId(e.target.value); setPrepareError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && !prepareLoading && handlePrepare()}
            placeholder="e.g. abc123xyz456 (same as Stage 1)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400"
          />
        </div>

        <button
          onClick={handlePrepare}
          disabled={prepareLoading || !commentDatasetId.trim()}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {prepareLoading ? 'Preparing…' : 'Prepare Comment Targets'}
        </button>

        {prepareError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Error:</strong> {prepareError}
          </div>
        )}

        {prepareResult && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Prepare Results</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Raw Items Seen',    key: 'rawItemsSeen',       color: 'text-gray-900' },
                { label: 'Valid Candidates',  key: 'validCandidates',    color: 'text-indigo-700' },
                { label: 'New Saved',         key: 'newTargetsSaved',    color: 'text-green-700' },
                { label: 'Dupes Skipped',     key: 'duplicatesSkipped',  color: 'text-gray-500' },
                { label: 'Invalid / Skipped', key: 'invalidSkipped',     color: 'text-yellow-600' },
                { label: 'Bad Shape',         key: 'droppedInvalidShape',color: 'text-yellow-600' },
              ].map(({ label, key, color }) => (
                <div key={key} className="rounded-lg border border-indigo-100 bg-white px-4 py-3 text-center">
                  <div className={`text-2xl font-bold ${color}`}>{prepareResult[key] ?? 0}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-indigo-500 font-mono">
              rawItemsSeen = droppedInvalidShape + invalidSkipped + duplicatesSkipped + validCandidates
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STAGE 3 — Run Comment Harvest
          ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stage 3 — Run Comment Harvest</h3>
          <p className="text-xs text-gray-400 mt-1">
            Send pending targets to Apify's Instagram Comment Scraper. Targets are marked
            <em> running</em> until the Apify run completes (check console for results).
          </p>
        </div>

        {/* Pipeline status bar */}
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Target Pipeline Status</span>
            <button
              onClick={loadTargetStats}
              disabled={statsLoading}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
            >
              {statsLoading ? 'Refreshing…' : '↺ Refresh'}
            </button>
          </div>
          {targetStats ? (
            <div className="grid grid-cols-5 gap-2 text-center">
              {[
                { label: 'Total',   value: targetStats.total,   color: 'text-gray-900' },
                { label: 'Pending', value: targetStats.pending, color: 'text-yellow-600' },
                { label: 'Running', value: targetStats.running, color: 'text-blue-600' },
                { label: 'Done',    value: targetStats.done,    color: 'text-green-600' },
                { label: 'Failed',  value: targetStats.failed,  color: 'text-red-600'  },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <div className={`text-xl font-bold ${color}`}>{value ?? 0}</div>
                  <div className="text-xs text-gray-400">{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-400">Loading stats…</div>
          )}
        </div>

        <div className="flex items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Batch Limit</label>
            <input
              type="number"
              min="1"
              max="200"
              value={harvestLimit}
              onChange={(e) => setHarvestLimit(e.target.value)}
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <button
            onClick={handleHarvest}
            disabled={harvestLoading || (targetStats && targetStats.pending === 0)}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {harvestLoading ? 'Triggering…' : 'Run Comment Harvest'}
          </button>
        </div>

        {harvestError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Error:</strong> {harvestError}
          </div>
        )}

        {harvestResult && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Harvest Triggered</h4>
            {harvestResult.targetsQueued === 0 ? (
              <p className="text-sm text-gray-600">{harvestResult.message}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-emerald-100 bg-white px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-emerald-700">{harvestResult.targetsQueued}</div>
                    <div className="text-xs text-gray-500">Targets Queued</div>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-white px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-gray-900">{harvestResult.pendingFound}</div>
                    <div className="text-xs text-gray-500">Pending Found</div>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-white px-4 py-3 text-center">
                    <div className="text-xs font-bold text-blue-700 break-all leading-tight pt-1">{harvestResult.apifyRunId ?? '—'}</div>
                    <div className="text-xs text-gray-500 mt-1">Apify Run ID</div>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-white px-4 py-3 text-center">
                    <div className="text-sm font-bold text-gray-700">{harvestResult.apifyRunStatus ?? '—'}</div>
                    <div className="text-xs text-gray-500">Run Status</div>
                  </div>
                </div>
                {harvestResult.apifyRunUrl && (
                  <a
                    href={harvestResult.apifyRunUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-emerald-700 underline hover:text-emerald-900"
                  >
                    View run in Apify console →
                  </a>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STAGE 4 — Import Comment Leads
          ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stage 4 — Import Comment Leads</h3>
          <p className="text-xs text-gray-400 mt-1">
            Ingest a completed Apify comment-scrape dataset. Commenters are normalised and
            inserted as leads. Duplicates (by username) are skipped.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Comment Dataset ID</label>
          <input
            type="text"
            value={commentImportDatasetId}
            onChange={(e) => { setCommentImportDatasetId(e.target.value); setCommentImportError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && !commentImportLoading && handleCommentImport()}
            placeholder="e.g. abc123xyz456 (Apify output dataset)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        <button
          onClick={handleCommentImport}
          disabled={commentImportLoading || !commentImportDatasetId.trim()}
          className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700 active:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {commentImportLoading ? 'Importing…' : 'Import Comment Leads'}
        </button>

        {commentImportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {commentImportError}
          </div>
        )}

        {commentImportResult && (
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-5 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-violet-700">Import Results</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: 'Raw Items',       key: 'rawItems',        color: 'text-gray-900'    },
                { label: 'Normalised',      key: 'normalizedCount', color: 'text-violet-700'  },
                { label: 'Skipped Invalid', key: 'skippedInvalid',  color: 'text-yellow-600'  },
                { label: 'Inserted',        key: 'inserted',        color: 'text-emerald-700' },
                { label: 'Duplicates',      key: 'duplicates',      color: 'text-gray-400'    },
              ].map(({ label, key, color }) => (
                <div key={key} className="rounded-lg border border-violet-100 bg-white px-4 py-3 text-center">
                  <div className={`text-2xl font-bold ${color}`}>{commentImportResult[key] ?? 0}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

// ── Products Tab ──────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  '', 'cleanser', 'toner', 'serum', 'moisturizer', 'sunscreen',
  'spot_treatment', 'oil', 'exfoliant', 'mask', 'body', 'other',
]
const CONCERN_OPTIONS = [
  '', 'acne', 'hyperpigmentation', 'dry_skin', 'oily_skin',
  'sensitivity', 'stretch_marks', 'body_care', 'routine_building',
]
const PRICE_BAND_OPTIONS = ['', 'budget', 'mid-range', 'premium']

const BLANK_PRODUCT = {
  productName: '', brand: '', category: '', subcategory: '',
  concernsSupported: '', skinTypesSupported: '',
  sensitivityFriendly: false, routineStep: '',
  description: '', keyIngredients: '', contraindications: '',
  price: '', currency: 'NGN', purchaseUrl: '', imageUrl: '',
  sourceStore: 'manual', country: 'NG', market: 'nigeria',
  availabilityStatus: 'available', stockStatus: 'in_stock',
}

function ProductFormModal({ onClose, onSaved }) {
  const [form,    setForm]    = useState(BLANK_PRODUCT)
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState(null)

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.productName.trim() || !form.brand.trim() || !form.category) {
      setErr('Product name, brand, and category are required')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const payload = {
        ...form,
        price:              form.price ? Number(form.price) : null,
        concernsSupported:  form.concernsSupported.split(',').map(s => s.trim()).filter(Boolean),
        skinTypesSupported: form.skinTypesSupported.split(',').map(s => s.trim()).filter(Boolean),
        keyIngredients:     form.keyIngredients.split(',').map(s => s.trim()).filter(Boolean),
        contraindications:  form.contraindications.split(',').map(s => s.trim()).filter(Boolean),
      }
      await createProduct(payload)
      onSaved()
      onClose()
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const field = (label, key, type = 'text', opts) => (
    <div key={key}>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{label}</label>
      {opts ? (
        <select
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300"
        >
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={form[key]}
          onChange={e => set(key, type === 'checkbox' ? e.target.checked : e.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300"
        />
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <p className="font-semibold text-gray-800 text-sm">Add Product to Catalog</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {field('Product Name *', 'productName')}
            {field('Brand *', 'brand')}
            {field('Category *', 'category', 'text', CATEGORY_OPTIONS.slice(1).map(c => ({ value: c, label: c || '— select —' })))}
            {field('Sub-category', 'subcategory')}
            {field('Price (₦)', 'price', 'number')}
            {field('Currency', 'currency')}
            {field('Routine Step', 'routineStep', 'text', [
              { value: '', label: '— auto from category —' },
              ...CATEGORY_OPTIONS.slice(1).map(c => ({ value: c, label: c })),
            ])}
            {field('Source Store', 'sourceStore')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Concerns (comma-separated)</label>
              <input value={form.concernsSupported} onChange={e => set('concernsSupported', e.target.value)} placeholder="acne, hyperpigmentation…" className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300" />
              <p className="text-[10px] text-gray-400 mt-0.5">Options: acne, hyperpigmentation, dry_skin, oily_skin, sensitivity, stretch_marks, body_care</p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Skin Types (comma-separated)</label>
              <input value={form.skinTypesSupported} onChange={e => set('skinTypesSupported', e.target.value)} placeholder="oily, dry, all…" className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Key Ingredients (comma-separated)</label>
              <input value={form.keyIngredients} onChange={e => set('keyIngredients', e.target.value)} placeholder="niacinamide, salicylic acid…" className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Contraindications (comma-separated)</label>
              <input value={form.contraindications} onChange={e => set('contraindications', e.target.value)} placeholder="avoid with retinol…" className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {field('Purchase URL', 'purchaseUrl')}
            {field('Image URL', 'imageUrl')}
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Description</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300 resize-none" />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="sf" checked={form.sensitivityFriendly} onChange={e => set('sensitivityFriendly', e.target.checked)} className="rounded border-gray-300" />
            <label htmlFor="sf" className="text-xs text-gray-600">Sensitivity-friendly</label>
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={onClose} className="rounded border border-gray-200 px-4 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProductsTab() {
  const [products, setProducts] = useState([])
  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [concernFilter, setConcernFilter] = useState('')
  const [priceBandFilter, setPriceBandFilter] = useState('')
  const [page,     setPage]     = useState(1)
  const [total,    setTotal]    = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [toast,    setToast]    = useState(null)
  const [deactivating, setDeactivating] = useState(null)
  const LIMIT = 20

  function showToast(msg, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(() => {
    setLoading(true)
    fetchProducts({ search, category: catFilter, concern: concernFilter, priceBand: priceBandFilter, page, limit: LIMIT })
      .then(res => { setProducts(res.data || []); setTotal(res.total || 0) })
      .catch(e => showToast(e?.message || 'Failed to load products', false))
      .finally(() => setLoading(false))
  }, [search, catFilter, concernFilter, priceBandFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, catFilter, concernFilter, priceBandFilter])

  async function handleDeactivate(id, name) {
    if (!window.confirm(`Deactivate "${name}"? It will no longer appear in matches.`)) return
    setDeactivating(id)
    try {
      await deactivateProduct(id)
      showToast(`${name} deactivated`)
      load()
    } catch (e) {
      showToast(e?.message || 'Deactivate failed', false)
    } finally {
      setDeactivating(null)
    }
  }

  async function loadLogs() {
    try {
      const res = await fetchIngestionLogs()
      setLogs(res.data || [])
      setShowLogs(true)
    } catch (e) {
      showToast(e?.message || 'Failed to load logs', false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-800">Product Catalog</h2>
          <p className="text-xs text-gray-400">{total} product{total !== 1 ? 's' : ''} in catalog</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadLogs}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Ingestion Logs
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
          >
            + Add Product
          </button>
        </div>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${toast.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 flex-1 min-w-[200px]"
        />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400">
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.slice(1).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={concernFilter} onChange={e => setConcernFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400">
          <option value="">All concerns</option>
          {CONCERN_OPTIONS.slice(1).map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={priceBandFilter} onChange={e => setPriceBandFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400">
          {PRICE_BAND_OPTIONS.map(p => <option key={p} value={p}>{p || 'All price bands'}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Concerns</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Band</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-gray-400">Loading…</td></tr>
            )}
            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                  No products yet — click "+ Add Product" to add your first.
                </td>
              </tr>
            )}
            {!loading && products.map(p => (
              <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-gray-800 text-xs">{p.productName}</p>
                  {p.sensitivityFriendly && (
                    <span className="text-[10px] text-green-600">✓ sensitivity-safe</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{p.brand}</td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 capitalize">{p.category}</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(p.concernsSupported || []).slice(0, 3).map(c => (
                      <span key={c} className="rounded bg-teal-50 border border-teal-100 px-1 py-0.5 text-[10px] text-teal-700 capitalize">
                        {c.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {(p.concernsSupported || []).length > 3 && (
                      <span className="text-[10px] text-gray-400">+{p.concernsSupported.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs font-medium text-gray-700">
                  {p.price ? `₦${p.price.toLocaleString('en-NG')}` : <span className="text-amber-500">no price</span>}
                </td>
                <td className="px-4 py-2.5">
                  {p.priceBand && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                      p.priceBand === 'budget' ? 'bg-green-100 text-green-700' :
                      p.priceBand === 'mid-range' ? 'bg-blue-100 text-blue-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>{p.priceBand}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${
                    p.stockStatus === 'in_stock' ? 'bg-green-50 text-green-700' :
                    p.stockStatus === 'out_of_stock' ? 'bg-red-50 text-red-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>{(p.stockStatus || '').replace(/_/g, ' ')}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    disabled={deactivating === p.id}
                    onClick={() => handleDeactivate(p.id, p.productName)}
                    className="text-[10px] text-red-500 hover:underline disabled:opacity-40"
                  >
                    {deactivating === p.id ? '…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{total} total</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">←</button>
            <span className="px-2 py-1">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">→</button>
          </div>
        </div>
      )}

      {/* Ingestion logs modal */}
      {showLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowLogs(false)}>
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="font-semibold text-gray-800 text-sm">Ingestion Logs</p>
              <button onClick={() => setShowLogs(false)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="p-4 space-y-2">
              {logs.length === 0 && <p className="text-sm text-gray-400">No ingestion logs yet.</p>}
              {logs.map(log => (
                <div key={log.id} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-700">{log.source}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${log.status === 'complete' ? 'bg-green-100 text-green-700' : log.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>{log.status}</span>
                    <span className="text-gray-400 ml-auto">{new Date(log.startedAt).toLocaleString('en-GB')}</span>
                  </div>
                  <div className="flex gap-4 text-gray-500">
                    <span>Found: <b>{log.productsFound}</b></span>
                    <span className="text-green-600">Inserted: <b>{log.inserted}</b></span>
                    <span className="text-blue-600">Updated: <b>{log.updated}</b></span>
                    <span>Skipped: <b>{log.skipped}</b></span>
                    {log.failed > 0 && <span className="text-red-600">Failed: <b>{log.failed}</b></span>}
                  </div>
                  {log.error && <p className="text-red-500 mt-1 text-[10px]">{log.error}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add product modal */}
      {showForm && (
        <ProductFormModal onClose={() => setShowForm(false)} onSaved={() => { load(); showToast('Product added') }} />
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'leads',     label: 'Leads' },
  { id: 'academy',   label: 'Academy' },
  { id: 'scraping',  label: 'Scraping' },
  { id: 'products',  label: 'Products' },
]

export default function AdminDashboard({ onBack, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">MICAHSKIN <span className="text-brand-600">CRM</span></h1>
            <p className="text-xs text-gray-400">Internal dashboard</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onBack}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs sm:text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={onLogout}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs sm:text-sm text-gray-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="mx-auto max-w-6xl px-4 overflow-x-auto">
          <nav className="flex gap-1 min-w-max">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-brand-500 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-3 sm:px-4 py-5 sm:py-8">
        {activeTab === 'overview'  && <OverviewTab />}
        {activeTab === 'leads'     && <LeadsTab />}
        {activeTab === 'academy'   && <AcademyTab />}
        {activeTab === 'scraping'  && <ScrapingTab />}
        {activeTab === 'products'  && <ProductsTab />}
      </main>
    </div>
  )
}
