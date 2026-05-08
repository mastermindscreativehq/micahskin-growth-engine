import { useState, useEffect, useCallback } from 'react'
import {
  fetchOutreachQueue,
  updateOutreachStatus,
  triggerAcquisitionRun,
} from '../api/index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDT(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function tempBadgeClass(t) {
  if (t === 'hot')  return 'bg-rose-100 text-rose-700 border-rose-200'
  if (t === 'warm') return 'bg-amber-100 text-amber-700 border-amber-200'
  if (t === 'cold') return 'bg-sky-100 text-sky-700 border-sky-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

function statusBadgeClass(s) {
  if (s === 'replied')   return 'bg-emerald-100 text-emerald-700'
  if (s === 'converted') return 'bg-violet-100 text-violet-700'
  if (s === 'skipped')   return 'bg-gray-100 text-gray-500'
  return 'bg-amber-50 text-amber-700'
}

async function copyToClipboard(text) {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// ── Atomic UI ────────────────────────────────────────────────────────────────

function Stat({ label, value, color = 'gray' }) {
  const cls = {
    gray:    'border-gray-200 text-gray-700',
    rose:    'border-rose-200 text-rose-700 bg-rose-50',
    amber:   'border-amber-200 text-amber-700 bg-amber-50',
    sky:     'border-sky-200 text-sky-700 bg-sky-50',
    emerald: 'border-emerald-200 text-emerald-700 bg-emerald-50',
    violet:  'border-violet-200 text-violet-700 bg-violet-50',
  }[color] || 'border-gray-200 text-gray-700'
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5 opacity-80">{label}</div>
    </div>
  )
}

function CopyButton({ label, text, disabled }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !text}
      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

function LinkButton({ href, label, disabled }) {
  if (!href || disabled) {
    return (
      <span className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-400 cursor-not-allowed">
        {label}
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
    >
      {label} ↗
    </a>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function QueueRow({ item, onStatusChange }) {
  const [busy, setBusy] = useState(false)

  const change = async (status) => {
    if (busy) return
    setBusy(true)
    try {
      await updateOutreachStatus(item.id, status)
      onStatusChange(item.id, status)
    } catch (err) {
      console.error('updateOutreachStatus failed', err)
    } finally {
      setBusy(false)
    }
  }

  // Pick the primary reply text in priority order
  const primaryReply = item.suggestedReply || item.consultCta || item.whatsappCta || ''

  return (
    <tr className="align-top border-b border-gray-100 hover:bg-gray-50">
      {/* User */}
      <td className="py-3 pl-3 pr-2 align-top w-44">
        <div className="text-xs font-semibold text-gray-800 truncate">@{item.username || 'unknown'}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">{fmtDT(item.postedAt || item.createdAt)}</div>
        {item.detectedCity && (
          <div className="mt-0.5 inline-block rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase">
            {item.detectedCity}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          <LinkButton href={item.profileUrl}      label="Profile" />
          <LinkButton href={item.sourceVideoUrl}  label="Video"   />
        </div>
      </td>

      {/* Comment */}
      <td className="py-3 px-2 align-top">
        <div className="text-xs text-gray-800 leading-snug whitespace-pre-wrap break-words">
          {item.commentText}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
          <span className="inline-block rounded bg-indigo-50 text-indigo-600 px-1.5 py-0.5 font-medium capitalize">
            {String(item.painCategory || 'general').replace(/_/g, ' ')}
          </span>
          {item.buyingStage && (
            <span className="inline-block rounded bg-sky-50 text-sky-600 px-1.5 py-0.5 font-medium capitalize">
              {item.buyingStage.replace(/_/g, ' ')}
            </span>
          )}
          {item.recommendedAction && (
            <span className="inline-block rounded bg-violet-50 text-violet-600 px-1.5 py-0.5 font-medium capitalize">
              {item.recommendedAction.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </td>

      {/* Score */}
      <td className="py-3 px-2 align-top text-center w-20">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${tempBadgeClass(item.temperature)}`}>
          {item.temperature || 'cold'}
        </span>
        <div className="mt-1 text-xs font-bold tabular-nums text-gray-700">
          {Math.round(Number(item.leadHeatScore) || 0)}
        </div>
        <div className="text-[9px] text-gray-400">
          buyer {Math.round(Number(item.buyerReadinessScore) || 0)}
        </div>
      </td>

      {/* Reply / CTAs */}
      <td className="py-3 px-2 align-top">
        <div className="text-[11px] text-gray-700 leading-snug bg-gray-50 border border-gray-100 rounded p-2 whitespace-pre-wrap break-words">
          {primaryReply || <span className="text-gray-400">— no reply generated —</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <CopyButton label="Copy reply"        text={primaryReply}   />
          <CopyButton label="Copy WhatsApp CTA" text={item.whatsappCta} />
          <CopyButton label="Copy consult CTA"  text={item.consultCta}  />
          {item.academyCta && (
            <CopyButton label="Copy academy CTA" text={item.academyCta} />
          )}
        </div>
      </td>

      {/* Status */}
      <td className="py-3 pr-3 pl-2 align-top w-32">
        <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusBadgeClass(item.outreachStatus)}`}>
          {item.outreachStatus || 'pending'}
        </span>
        <div className="mt-2 flex flex-col gap-1">
          <button
            type="button"
            disabled={busy || item.outreachStatus === 'replied'}
            onClick={() => change('replied')}
            className="rounded-md bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          >
            Mark replied
          </button>
          <button
            type="button"
            disabled={busy || item.outreachStatus === 'converted'}
            onClick={() => change('converted')}
            className="rounded-md bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          >
            Mark converted
          </button>
          <button
            type="button"
            disabled={busy || item.outreachStatus === 'skipped'}
            onClick={() => change('skipped')}
            className="rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          >
            Skip
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function OutreachQueuePanel() {
  const [filter, setFilter] = useState({ status: 'pending', temperature: 'all' })
  const [items, setItems]   = useState([])
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [scraping, setScraping] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchOutreachQueue({
        status:      filter.status,
        temperature: filter.temperature,
        commentsOnly: true,
        limit: 200,
      })
      setItems(res.data?.items || [])
      setCounts(res.data?.counts || null)
    } catch (err) {
      setError(err?.message || 'Failed to load outreach queue')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const onStatusChange = (id, newStatus) => {
    // Optimistic local update — drop row from current view if it no longer
    // matches the active filter.
    if (filter.status !== 'all' && filter.status !== newStatus) {
      setItems(prev => prev.filter(it => it.id !== id))
    } else {
      setItems(prev => prev.map(it =>
        it.id === id ? { ...it, outreachStatus: newStatus, outreachStatusUpdatedAt: new Date().toISOString() } : it,
      ))
    }
    // Refresh counts in background
    fetchOutreachQueue({ status: 'pending', limit: 1 })
      .then(r => setCounts(r.data?.counts || null))
      .catch(() => {})
  }

  const triggerScrape = async () => {
    if (scraping) return
    setScraping(true)
    try {
      await triggerAcquisitionRun()
      setTimeout(() => load(), 1500)
    } catch (err) {
      setError(err?.message || 'Failed to trigger scrape')
    } finally {
      setScraping(false)
    }
  }

  const c = counts || {
    readyToReply: 0, replied: 0, converted: 0, skipped: 0,
    pendingByTemperature: { hot: 0, warm: 0, cold: 0 },
    thresholds: { hot: 60, warm: 35, cold: 15 },
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">TikTok Outreach Queue</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Comment-sourced leads, scored and ready for human reply.
            Hot ≥ {c.thresholds.hot} · Warm ≥ {c.thresholds.warm} · Cold ≥ {c.thresholds.cold}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            className="rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-xs font-semibold"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={triggerScrape}
            disabled={scraping}
            className="rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {scraping ? '…' : '▶ Scrape comments now'}
          </button>
        </div>
      </div>

      {/* Conversion-focused stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Ready to reply" value={c.readyToReply} color="amber" />
        <Stat label="Replied"        value={c.replied}      color="emerald" />
        <Stat label="Converted"      value={c.converted}    color="violet" />
        <Stat label="Hot pending"    value={c.pendingByTemperature.hot}  color="rose" />
        <Stat label="Warm pending"   value={c.pendingByTemperature.warm} color="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Status:</span>
          {['pending', 'replied', 'converted', 'skipped', 'all'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(f => ({ ...f, status: s }))}
              className={`rounded-md border px-2 py-1 capitalize ${
                filter.status === s
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Temperature:</span>
          {['all', 'hot', 'warm', 'cold'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(f => ({ ...f, temperature: t }))}
              className={`rounded-md border px-2 py-1 capitalize ${
                filter.temperature === t
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        {error && (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <table className="min-w-full text-left">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="py-2 pl-3 pr-2 font-semibold w-44">User</th>
              <th className="py-2 px-2 font-semibold">Comment</th>
              <th className="py-2 px-2 font-semibold w-20 text-center">Score</th>
              <th className="py-2 px-2 font-semibold">Reply / CTAs</th>
              <th className="py-2 pr-3 pl-2 font-semibold w-32">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="py-8 text-center text-xs text-gray-400">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-xs text-gray-400">
                No leads in this view. Try lowering the threshold or running a scrape.
              </td></tr>
            )}
            {!loading && items.map((item) => (
              <QueueRow key={item.id} item={item} onStatusChange={onStatusChange} />
            ))}
          </tbody>
        </table>
        {!loading && items.length > 0 && (
          <div className="px-3 py-2 text-[11px] text-gray-400 border-t border-gray-100">
            Showing {items.length} {filter.status === 'all' ? 'lead' : filter.status} {items.length === 1 ? 'lead' : 'leads'}.
          </div>
        )}
      </div>
    </div>
  )
}
