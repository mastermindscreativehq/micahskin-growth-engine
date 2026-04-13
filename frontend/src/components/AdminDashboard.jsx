import { useState, useEffect, useCallback } from 'react'
import {
  fetchStats,
  fetchLeads,
  fetchRegistrations,
  updateLeadStatus,
  updateRegistrationStatus,
  sendInitialReply,
  sendFollowUp,
  importInstagramDataset,
  fetchScrapingDebugAuth,
  prepareInstagramComments,
  runInstagramComments,
  fetchCommentTargetStats,
} from '../api/index.js'

// ── Constants ────────────────────────────────────────────────────────────────

const LEAD_STATUSES = ['new', 'contacted', 'engaged', 'interested', 'closed']
const ACADEMY_STATUSES = ['new', 'contacted', 'paid', 'onboarded', 'closed']
const PLATFORMS = ['TikTok', 'Instagram', 'Other']
const SOURCE_TYPES = ['bio_form', 'dm', 'comment', 'story_reply', 'manual']
const PRIORITIES = ['high', 'medium', 'low']
// Statuses that block CRM-triggered sends (mirrors backend STOP_STATUSES)
const STOP_STATUSES = ['engaged', 'interested', 'closed']

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

// ── Academy Tab ───────────────────────────────────────────────────────────────

function AcademyTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [sourceTypeFilter, setSourceTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ data: [], total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchRegistrations({ search, status: statusFilter, source: sourceFilter, sourceType: sourceTypeFilter, page, limit: 15 })
      .then(setResult)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [search, statusFilter, sourceFilter, sourceTypeFilter, page])

  useEffect(() => { load() }, [load])

  useEffect(() => { setPage(1) }, [search, statusFilter, sourceFilter, sourceTypeFilter])

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

  return (
    <div className="space-y-4">
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
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Enrollment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">Loading…</td>
              </tr>
            ) : result.data.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">No registrations found</td>
              </tr>
            ) : result.data.map((reg) => (
              <tr key={reg.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800">
                  {reg.fullName}
                  {reg.businessType && (
                    <div className="text-xs text-gray-400">{reg.businessType}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  <div>{reg.email}</div>
                  {reg.phone && <div className="text-xs">{reg.phone}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600 capitalize">{reg.experienceLevel}</td>
                <td className="px-4 py-3">
                  <div className="text-gray-600">{reg.sourcePlatform}</div>
                  {reg.sourceType && <div className="text-xs text-gray-400">{reg.sourceType.replace(/_/g, ' ')}</div>}
                  {reg.handle && <div className="text-xs text-gray-400">@{reg.handle}</div>}
                  {reg.campaign && <div className="text-xs text-gray-400">{reg.campaign}</div>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(reg.createdAt)}</td>
                <td className="px-4 py-3">
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
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                      reg.academyPackage === 'premium'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {reg.academyPackage}
                      {reg.academyAmount ? ` ₦${reg.academyAmount.toLocaleString()}` : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                  {reg.systemIncluded && (
                    <div className="text-xs text-green-600 mt-0.5">+ system</div>
                  )}
                  {reg.upgradeEligible && (
                    <div className="text-xs text-amber-600 mt-0.5">upgrade eligible</div>
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
                  {reg.academyStatus ? (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                      reg.academyStatus === 'enrolled'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {reg.academyStatus.replace(/_/g, ' ')}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
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

    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'leads',    label: 'Leads' },
  { id: 'academy',  label: 'Academy' },
  { id: 'scraping', label: 'Scraping' },
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
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'leads'    && <LeadsTab />}
        {activeTab === 'academy'  && <AcademyTab />}
        {activeTab === 'scraping' && <ScrapingTab />}
      </main>
    </div>
  )
}
